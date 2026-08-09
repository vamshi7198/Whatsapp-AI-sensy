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
import { estimateCampaignCost } from "@/lib/campaigns/pricing";
import {
  cancelCampaign,
  createCampaign,
} from "@/lib/campaigns/service";
import { runCampaign } from "@/lib/campaigns/sender";
import { normalizePhone } from "@/lib/contacts/phone";
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
  cost?: {
    total: number | null;
    currency: string;
    perMessage: number | null;
    usedFallbackRate: boolean;
  };
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

    // Costed on who will actually receive it, not on who matched the
    // audience — Meta bills for messages sent, not contacts considered.
    const sendablePhones = resolved.eligible
      .filter((m) => resolveVariables(m, mapping).missing.length === 0)
      .map((m) => m.phoneE164);

    const cost = await estimateCampaignCost(sendablePhones, template.category);

    return {
      totalMatched: resolved.totalMatched,
      eligible: resolved.eligible.length - missingVariableCount,
      skipped,
      samples,
      variableProblems,
      cost: {
        total: cost.totalCost,
        currency: cost.currency,
        perMessage: cost.ratePerMessage,
        usedFallbackRate: cost.usedFallbackRate,
      },
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to create campaigns." };
    }
    return { error: "Could not work out the audience. Please check your choices." };
  }
}

export interface ContactSearchResult {
  id: string;
  name: string | null;
  phoneE164: string;
  optedIn: boolean;
  tags: string[];
}

/**
 * Type-ahead search for the "choose people yourself" audience option.
 *
 * Capped at 25 so a broad search cannot pull the whole contact list into the
 * browser, which is both slow and an unnecessary spread of customer data.
 */
export async function searchContactsForCampaign(
  query: string,
): Promise<ContactSearchResult[]> {
  await requireApiAuth("campaign:create");

  const term = query.trim();
  if (term.length < 2) return [];

  const digits = term.replace(/[^\d]/g, "");

  const contacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phoneE164: { contains: digits } }] : []),
      ],
    },
    take: 25,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      phoneE164: true,
      optInStatus: true,
      marketingOptOut: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
  });

  return contacts.map((c) => ({
    id: c.id,
    name: c.name,
    phoneE164: c.phoneE164,
    optedIn: c.optInStatus === "OPTED_IN" && !c.marketingOptOut,
    tags: c.tags.map((t) => t.tag.name),
  }));
}

export interface CsvAudienceResult {
  error?: string;
  matched?: number;
  notFound?: number;
  invalid?: number;
  contactIds?: string[];
  /** First few numbers that matched nothing, so the user can check them. */
  notFoundSamples?: string[];
}

/**
 * Turns an uploaded CSV of phone numbers into a list of existing contacts.
 *
 * Deliberately does NOT create contacts. A campaign audience file is not a
 * consent record, and silently importing new people from it would mean
 * messaging someone whose opt-in status nobody ever established.
 */
export async function resolveCsvAudience(
  _prev: CsvAudienceResult,
  formData: FormData,
): Promise<CsvAudienceResult> {
  try {
    await requireApiAuth("campaign:create");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose a CSV file." };
    }

    if (file.size > 5 * 1024 * 1024) {
      return { error: "That file is too large. Keep it under 5 MB." };
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return { error: "That file is empty." };

    // Tolerate a header row, and files that are just a column of numbers.
    const header = lines[0].toLowerCase();
    const hasHeader = /phone|mobile|number|contact/.test(header);
    const rows = hasHeader ? lines.slice(1) : lines;

    const phones: string[] = [];
    let invalid = 0;

    for (const row of rows) {
      // Take the first cell that looks like a phone number, so a full contact
      // export works as well as a bare list.
      const cells = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      let found = false;

      for (const cell of cells) {
        const result = normalizePhone(cell);
        if (result.ok) {
          phones.push(result.e164);
          found = true;
          break;
        }
      }

      if (!found) invalid += 1;
    }

    if (phones.length === 0) {
      return {
        error:
          "No valid phone numbers were found in that file. Check it has a column of numbers.",
        invalid,
      };
    }

    const unique = [...new Set(phones)];

    const contacts = await prisma.contact.findMany({
      where: { phoneE164: { in: unique }, deletedAt: null },
      select: { id: true, phoneE164: true },
    });

    const foundNumbers = new Set(contacts.map((c) => c.phoneE164));
    const missing = unique.filter((p) => !foundNumbers.has(p));

    return {
      matched: contacts.length,
      notFound: missing.length,
      invalid,
      contactIds: contacts.map((c) => c.id),
      notFoundSamples: missing.slice(0, 5),
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to create campaigns." };
    }
    return { error: "Could not read that file. Please try again." };
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
      headerMediaUrl: String(formData.get("headerMediaUrl") ?? "") || undefined,
      headerMediaType:
        String(formData.get("headerMediaType") ?? "") || undefined,
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
