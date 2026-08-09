"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";
import {
  buildTemplateComponents,
  extractVariables,
  validateTemplateDraft,
  type TemplateButton,
  type TemplateDraft,
} from "@/lib/templates/builder";
import { getProvider } from "@/lib/whatsapp";

export interface CreateTemplateState {
  error?: string;
  /** Field-level problems, keyed by field name, shown inline. */
  issues?: Record<string, string>;
  success?: string;
  templateId?: string;
}

export async function createTemplateAction(
  _prev: CreateTemplateState,
  formData: FormData,
): Promise<CreateTemplateState> {
  try {
    const user = await requireApiAuth("template:create");

    const bodyText = String(formData.get("bodyText") ?? "");

    // Example values arrive as example_1, example_2, ... one per variable.
    const examples: Record<string, string> = {};
    for (const index of extractVariables(bodyText)) {
      examples[index] = String(formData.get(`example_${index}`) ?? "");
    }

    // Buttons arrive as JSON. Malformed input is treated as "no buttons"
    // rather than failing the whole submission on a parse error.
    let buttons: TemplateButton[] = [];
    try {
      const raw = String(formData.get("buttons") ?? "[]");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) buttons = parsed as TemplateButton[];
    } catch {
      buttons = [];
    }

    const draft: TemplateDraft = {
      name: String(formData.get("name") ?? "").trim().toLowerCase(),
      language: String(formData.get("language") ?? "en"),
      category: String(formData.get("category") ?? "UTILITY") as
        | "MARKETING"
        | "UTILITY",
      headerText: String(formData.get("headerText") ?? "").trim() || undefined,
      bodyText,
      footerText: String(formData.get("footerText") ?? "").trim() || undefined,
      examples,
      buttons,
    };

    const issues = validateTemplateDraft(draft);
    if (issues.length > 0) {
      return {
        issues: Object.fromEntries(issues.map((i) => [i.field, i.message])),
        error: "Please fix the problems below before submitting.",
      };
    }

    // A name is unique per language across the whole account, and Meta's
    // duplicate error is unhelpful.
    const existing = await prisma.template.findUnique({
      where: {
        name_language: { name: draft.name, language: draft.language },
      },
      select: { id: true, status: true },
    });

    if (existing) {
      return {
        error: `A template called "${draft.name}" already exists in that language.`,
      };
    }

    const provider = await getProvider();
    if (!provider) {
      return {
        error:
          "WhatsApp is not connected, so templates cannot be submitted for approval.",
      };
    }

    const components = buildTemplateComponents(draft);

    let created;
    try {
      created = await provider.createTemplate({
        name: draft.name,
        language: draft.language,
        category: draft.category,
        components,
      });
    } catch (error) {
      // Meta's rejection text is usually the most useful thing available, so
      // it is surfaced rather than replaced with something generic.
      return {
        error:
          error instanceof Error
            ? `WhatsApp did not accept this template: ${error.message}`
            : "WhatsApp did not accept this template.",
      };
    }

    const template = await prisma.template.create({
      data: {
        metaTemplateId: created.id,
        name: draft.name,
        language: draft.language,
        // Meta decides the final category and may reclassify it during
        // review, so its answer wins over what was requested.
        category: created.category ?? draft.category,
        status: created.status ?? "PENDING",
        components: components as never,
        variableCount: extractVariables(draft.bodyText).length,
        lastSyncedAt: new Date(),
      },
    });

    await audit(user, "template.create", {
      entityType: "Template",
      entityId: template.id,
      metadata: { name: draft.name, category: draft.category },
    });

    revalidatePath("/templates");

    return {
      success:
        "Submitted to WhatsApp for approval. This usually takes a few minutes, and the status here updates automatically.",
      templateId: template.id,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to create templates." };
    }
    return { error: "Could not submit the template. Please try again." };
  }
}
