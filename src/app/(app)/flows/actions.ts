"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import {
  createFlow,
  deprecateFlow,
  publishFlow,
  sendFlowToContact,
} from "@/lib/flows/service";
import {
  toFieldName,
  type FlowDefinition,
  type FlowField,
  type FieldType,
} from "@/lib/flows/builder";
import type { FlowCategory } from "@/lib/whatsapp/providers/meta/flows";
import { ForbiddenError } from "@/lib/rbac";

export interface FlowState {
  error?: string;
  success?: string;
  /** Problems with the form itself, shown as a list. */
  problems?: string[];
  flowId?: string;
}

const FIELD_TYPES: FieldType[] = [
  "short_text",
  "long_text",
  "single_choice",
  "multiple_choice",
  "dropdown",
  "date",
];

/**
 * Reads the question rows out of the form.
 *
 * The browser posts them as parallel arrays, so a missing label would silently
 * shift every later answer onto the wrong question. Rows are therefore read by
 * index and any row without a label is dropped whole.
 */
function parseFields(formData: FormData): FlowField[] {
  const labels = formData.getAll("fieldLabel").map(String);
  const types = formData.getAll("fieldType").map(String);
  const required = formData.getAll("fieldRequired").map(String);
  const options = formData.getAll("fieldOptions").map(String);

  const fields: FlowField[] = [];

  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i]?.trim();
    if (!label) continue;

    const type = FIELD_TYPES.includes(types[i] as FieldType)
      ? (types[i] as FieldType)
      : "short_text";

    fields.push({
      name: toFieldName(label),
      label,
      type,
      required: required[i] === "on",
      options: options[i]
        ? options[i].split(",").map((o) => o.trim()).filter(Boolean)
        : undefined,
    });
  }

  return fields;
}

export async function createFlowAction(
  _prev: FlowState,
  formData: FormData,
): Promise<FlowState> {
  try {
    const user = await requireApiAuth("flow:manage");

    const definition: FlowDefinition = {
      title: String(formData.get("title") ?? "").trim(),
      heading: String(formData.get("heading") ?? "").trim() || undefined,
      submitLabel: String(formData.get("submitLabel") ?? "").trim() || "Submit",
      fields: parseFields(formData),
    };

    const result = await createFlow({
      definition,
      category: (String(formData.get("category") ?? "OTHER") as FlowCategory),
      createdById: user.id,
    });

    if (!result.ok) {
      return { error: result.error, problems: result.validationErrors };
    }

    await audit(user, "flow.create", {
      entityType: "Flow",
      entityId: result.flowId,
      metadata: { title: definition.title, fields: definition.fields.length },
    });

    revalidatePath("/flows");

    return {
      flowId: result.flowId,
      success:
        "Created as a draft. Test it on your own number, then publish it when you are happy.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to create forms." };
    }
    return { error: "Could not create that form. Please try again." };
  }
}

export async function publishFlowAction(
  _prev: FlowState,
  formData: FormData,
): Promise<FlowState> {
  try {
    const user = await requireApiAuth("flow:manage");
    const id = String(formData.get("id") ?? "");

    const result = await publishFlow(id);
    if (!result.ok) return { error: result.error };

    // Publishing cannot be undone at WhatsApp, so it is worth being able to
    // say later who did it and when.
    await audit(user, "flow.publish", { entityType: "Flow", entityId: id });

    revalidatePath("/flows");
    return { success: "Published. This form can no longer be changed — make a new version instead." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to publish forms." };
    }
    return { error: "Could not publish that form." };
  }
}

export async function retireFlowAction(
  _prev: FlowState,
  formData: FormData,
): Promise<FlowState> {
  try {
    const user = await requireApiAuth("flow:manage");
    const id = String(formData.get("id") ?? "");

    const result = await deprecateFlow(id);
    if (!result.ok) return { error: result.error };

    await audit(user, "flow.retire", { entityType: "Flow", entityId: id });

    revalidatePath("/flows");
    return { success: "Retired. Answers already collected are kept." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to retire forms." };
    }
    return { error: "Could not retire that form." };
  }
}

export async function sendFlowAction(
  _prev: FlowState,
  formData: FormData,
): Promise<FlowState> {
  try {
    const user = await requireApiAuth("flow:manage");

    const result = await sendFlowToContact({
      flowId: String(formData.get("flowId") ?? ""),
      contactId: String(formData.get("contactId") ?? ""),
      body: String(formData.get("body") ?? "").trim() || "We would love your feedback.",
      buttonText: String(formData.get("buttonText") ?? "").trim() || "Open form",
    });

    if (!result.ok) return { error: result.error };

    await audit(user, "flow.send", {
      entityType: "Flow",
      entityId: String(formData.get("flowId") ?? ""),
    });

    revalidatePath("/flows");
    return { success: "Sent." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to send forms." };
    }
    return { error: "Could not send that form." };
  }
}
