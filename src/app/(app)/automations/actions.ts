"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import {
  createAutomation,
  deleteAutomation,
  setAutomationActive,
} from "@/lib/automations/service";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";

export interface AutomationState {
  error?: string;
  success?: string;
}

export async function createAutomationAction(
  _prev: AutomationState,
  formData: FormData,
): Promise<AutomationState> {
  try {
    const user = await requireApiAuth("automation:manage");

    const replyKind = formData.get("replyKind") === "template" ? "template" : "text";

    const keywords = String(formData.get("keywords") ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const result = await createAutomation({
      name: String(formData.get("name") ?? ""),
      keywords,
      matchType: formData.get("matchType") === "contains" ? "contains" : "exact",
      reply:
        replyKind === "template"
          ? { kind: "template", templateId: String(formData.get("templateId") ?? "") }
          : { kind: "text", body: String(formData.get("body") ?? "") },
      createdById: user.id,
    });

    if (!result.ok) return { error: result.error };

    await audit(user, "automation.create", {
      entityType: "Automation",
      entityId: result.automationId,
      metadata: { keywords, replyKind },
    });

    revalidatePath("/automations");
    return {
      success:
        "Created, and switched off. Read it back, then turn it on when you are happy.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to create automations." };
    }
    return { error: "Could not create that. Please try again." };
  }
}

export async function toggleAutomationAction(
  _prev: AutomationState,
  formData: FormData,
): Promise<AutomationState> {
  try {
    const user = await requireApiAuth("automation:manage");

    const id = String(formData.get("id") ?? "");
    const isActive = formData.get("isActive") === "on";

    const automation = await prisma.automation.findUnique({
      where: { id },
      select: { name: true },
    });

    if (!automation) return { error: "That automation no longer exists." };

    await setAutomationActive(id, isActive);

    // Switching one on starts messaging customers unattended, which is exactly
    // the kind of change that needs to be attributable later.
    await audit(user, isActive ? "automation.enable" : "automation.disable", {
      entityType: "Automation",
      entityId: id,
      metadata: { name: automation.name },
    });

    revalidatePath("/automations");

    return {
      success: isActive
        ? `"${automation.name}" is now live and will reply to customers.`
        : `"${automation.name}" is switched off.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change automations." };
    }
    return { error: "Could not change that. Please try again." };
  }
}

export async function deleteAutomationAction(
  _prev: AutomationState,
  formData: FormData,
): Promise<AutomationState> {
  try {
    const user = await requireApiAuth("automation:manage");
    const id = String(formData.get("id") ?? "");

    const automation = await prisma.automation.findUnique({
      where: { id },
      select: { name: true },
    });

    if (!automation) return { error: "That automation no longer exists." };

    await deleteAutomation(id);

    await audit(user, "automation.delete", {
      entityType: "Automation",
      entityId: id,
      metadata: { name: automation.name },
    });

    revalidatePath("/automations");
    return { success: `"${automation.name}" deleted.` };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to delete automations." };
    }
    return { error: "Could not delete that. Please try again." };
  }
}
