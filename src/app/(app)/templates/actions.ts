"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/rbac";
import { syncTemplates } from "@/lib/templates/service";

export interface SyncState {
  error?: string;
  success?: string;
}

export async function runTemplateSync(): Promise<SyncState> {
  try {
    const user = await requireApiAuth("template:sync");
    const result = await syncTemplates();

    if (!result.ok) {
      return { error: result.error ?? "Could not load templates from WhatsApp." };
    }

    await audit(user, "template.sync", {
      metadata: {
        created: result.created,
        updated: result.updated,
        disabled: result.disabled,
      },
    });

    revalidatePath("/templates");

    const parts: string[] = [];
    if (result.created) parts.push(`${result.created} new`);
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.disabled) parts.push(`${result.disabled} no longer available`);

    return {
      success: parts.length
        ? `Templates synced — ${parts.join(", ")}.`
        : `Templates are up to date (${result.total} found).`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to sync templates." };
    }
    return { error: "Could not sync templates. Please try again." };
  }
}
