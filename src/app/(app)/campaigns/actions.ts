"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import {
  resolveAudience,
  resolveVariables,
  validateVariableValue,
  type AudienceFilter,
  type VariableMapping,
} from "@/lib/campaigns/audience";
import {
  cancelCampaign,
  createCampaign,
} from "@/lib/campaigns/service";
import { runCampaign } from "@/lib/campaigns/sender";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";
import { renderTemplateBody, getTemplateBody } from "@/lib/templates/service";

export interface AudiencePreview {
  error?: string;
  totalMatched?: number;
  eligible?: number;
  skipped?: Array<{ reason: string; count: number; label: string }>;
  samples?: Array<{
    name: string | null;
    phoneE164: string;
    rendered: string;
    missing: string[];
  }>;
  variableProblems?: Array<{ name: string | null; problem: string }>;
}

const audienceSchema = z.object({
  type: z.enum(["ALL_CONTACTS", "TAG", "TAGS", "SELECTED", "CSV_UPLOAD"]),
  tagIds: z.array(z.string()).optional(),
  match: z.enum(["any", "all"]).optional(),
  contactIds: z.array(z.string()).optional(),
});

/**
 * Step 5 of the wizard: shows exactly who will receive the campaign, who will
 * not, and what five real recipients will actually read.
 *
 * The preview uses the same resolveAudience and resolveVariables the send path
 * uses, so what is shown here is what happens — not an approximation.
 */
export async function previewCampaign(
  _prev: AudiencePreview,
  formData: FormData,
): Promise<AudiencePreview> {
  try {
    await requireApiAuth("campaign:create");

    const templateId = String(formData.get("templateId") ?? "");
    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });

    if (!template) return { error: "Choose a template first." };
    if (template.status !== "APPROVED") {
      return {
        error: "That template is not approved by WhatsApp and cannot be sent.",
      };
    }

    const audience = audienceSchema.parse(
      JSON.parse(String(formData.get("audience") ?? "{}")),
    ) as AudienceFilter;

    const mapping = JSON.parse(
      String(formData.get("mapping") ?? "{}"),
    ) as VariableMapping;

    const resolved = await resolveAudience(audience, template.category);

    // Group skips so the operator sees "47 not opted in" rather than 47 rows.
    const skipCounts = new Map<string, number>();
    for (const { reason } of resolved.skipped) {
      skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);
    }

    const SKIP_LABELS: Record<string, string> = {
      not_opted_in: "Have not agreed to receive marketing messages",
      marketing_opted_out: "Asked to stop receiving marketing messages",
      invalid_number: "Number is not on WhatsApp",
    };

    const body = getTemplateBody(template.components);
    const samples: NonNullable<AudiencePreview["samples"]> = [];
    const variableProblems: NonNullable<AudiencePreview["variableProblems"]> = [];
    let missingVariableCount = 0;

    for (const member of resolved.eligible) {
      const { values, missing } = resolveVariables(member, mapping);

      if (missing.length > 0) missingVariableCount += 1;

      // Meta rejects these at send time; catching them here means one warning
      // instead of every message failing identically.
      for (const value of Object.values(values)) {
        const problem = validateVariableValue(value);
        if (problem && variableProblems.length < 10) {
          variableProblems.push({ name: member.name, problem });
        }
      }

      if (samples.length < 5) {
        samples.push({
          name: member.name,
          phoneE164: member.phoneE164,
          rendered: renderTemplateBody(body, values),
          missing,
        });
      }
    }

    const skipped = [...skipCounts.entries()].map(([reason, count]) => ({
      reason,
      count,
      label: SKIP_LABELS[reason] ?? reason,
    }));

    if (missingVariableCount > 0) {
      skipped.push({
        reason: "missing_variable",
        count: missingVariableCount,
        label: "Missing a value needed by the template",
      });
    }

    return {
      totalMatched: resolved.totalMatched,
      eligible: resolved.eligible.length - missingVariableCount,
      skipped,
      samples,
      variableProblems,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to create campaigns." };
    }
    return { error: "Could not work out the audience. Please check your choices." };
  }
}

export interface SendState {
  error?: string;
  campaignId?: string;
  started?: boolean;
}

const sendSchema = z.object({
  name: z.string().trim().min(1, "Give the campaign a name").max(120),
  templateId: z.string().min(1, "Choose a template"),
  idempotencyKey: z.string().min(8),
  confirmed: z.literal("on", {
    message: "Please tick the confirmation box before sending",
  }),
});

/**
 * Creates and starts the campaign.
 *
 * Sending runs in the background so a large campaign does not block the
 * request. The idempotency key means a double-click, a refresh, or a
 * resubmitted form all resolve to the same campaign.
 */
export async function sendCampaign(
  _prev: SendState,
  formData: FormData,
): Promise<SendState> {
  try {
    const user = await requireApiAuth("campaign:send");

    const parsed = sendSchema.safeParse({
      name: formData.get("name"),
      templateId: formData.get("templateId"),
      idempotencyKey: formData.get("idempotencyKey"),
      confirmed: formData.get("confirmed"),
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid campaign" };
    }

    const audience = audienceSchema.parse(
      JSON.parse(String(formData.get("audience") ?? "{}")),
    ) as AudienceFilter;

    const mapping = JSON.parse(
      String(formData.get("mapping") ?? "{}"),
    ) as VariableMapping;

    const result = await createCampaign({
      name: parsed.data.name,
      idempotencyKey: parsed.data.idempotencyKey,
      templateId: parsed.data.templateId,
      audience,
      mapping,
      createdById: user.id,
    });

    if (!result.ok || !result.campaignId) {
      return { error: result.error ?? "Could not create the campaign." };
    }

    if (result.wasDuplicate) {
      // Already created by an earlier click; go to it rather than send again.
      return { campaignId: result.campaignId, started: false };
    }

    await audit(user, "campaign.send", {
      entityType: "Campaign",
      entityId: result.campaignId,
      metadata: { name: parsed.data.name, template: parsed.data.templateId },
    });

    // Fire and forget: the campaign continues after this response returns.
    void runCampaign(result.campaignId).catch(() => undefined);

    revalidatePath("/campaigns");
    return { campaignId: result.campaignId, started: true };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to send campaigns." };
    }
    return { error: "The campaign could not be started. Please try again." };
  }
}

export interface CancelState {
  error?: string;
  success?: string;
}

export async function cancelCampaignAction(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  try {
    const user = await requireApiAuth("campaign:cancel");
    const id = String(formData.get("id") ?? "");

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true, name: true },
    });

    if (!campaign) return { error: "That campaign no longer exists." };

    if (!["QUEUED", "RUNNING", "SCHEDULED"].includes(campaign.status)) {
      return { error: "This campaign has already finished." };
    }

    const cancelled = await cancelCampaign(id);

    await audit(user, "campaign.cancel", {
      entityType: "Campaign",
      entityId: id,
      metadata: { cancelled },
    });

    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");

    return {
      success: `Cancelled. ${cancelled} message${cancelled === 1 ? "" : "s"} will not be sent. Messages already delivered cannot be recalled.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to cancel campaigns." };
    }
    return { error: "Could not cancel the campaign." };
  }
}
