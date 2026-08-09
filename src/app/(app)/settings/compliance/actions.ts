"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";
import { SETTING_KEYS, setSetting } from "@/lib/settings";

export interface ComplianceState {
  error?: string;
  success?: string;
}

export async function saveComplianceSettings(
  _prev: ComplianceState,
  formData: FormData,
): Promise<ComplianceState> {
  try {
    const user = await requireApiAuth("settings:compliance");

    const defaultOptIn = formData.get("defaultOptIn") === "on";
    const inboundOptIn = formData.get("inboundOptIn") === "on";

    const keywords = String(formData.get("optOutKeywords") ?? "")
      .split(",")
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean);

    if (keywords.length === 0) {
      return {
        error:
          "Keep at least one opt-out keyword. Customers must have a way to stop marketing messages.",
      };
    }

    await setSetting(
      SETTING_KEYS.DEFAULT_OPT_IN,
      defaultOptIn ? "true" : "false",
      user.id,
    );
    await setSetting(
      SETTING_KEYS.INBOUND_OPT_IN,
      inboundOptIn ? "true" : "false",
      user.id,
    );
    await setSetting(
      SETTING_KEYS.OPT_OUT_KEYWORDS,
      keywords.join(","),
      user.id,
    );

    // Consent settings are exactly the kind of change that needs to be
    // attributable later.
    await audit(user, "settings.compliance", {
      metadata: { defaultOptIn, inboundOptIn, keywords },
    });

    revalidatePath("/settings/compliance");
    return { success: "Saved." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change this." };
    }
    return { error: "Could not save. Please try again." };
  }
}

export interface BulkOptInState {
  error?: string;
  success?: string;
}

/**
 * Marks existing unconfirmed contacts as opted in.
 *
 * Applies only to contacts whose status was never established — it will not
 * silently re-enrol anyone who explicitly opted out, whose decision stands.
 */
export async function optInExistingContacts(
  _prev: BulkOptInState,
  formData: FormData,
): Promise<BulkOptInState> {
  try {
    const user = await requireApiAuth("settings:compliance");

    if (formData.get("confirm") !== "on") {
      return { error: "Tick the confirmation box first." };
    }

    const result = await prisma.contact.updateMany({
      where: {
        deletedAt: null,
        optInStatus: "UNKNOWN",
        marketingOptOut: false,
      },
      data: {
        optInStatus: "OPTED_IN",
        optInAt: new Date(),
        optInSource: "bulk_admin_action",
      },
    });

    await audit(user, "compliance.bulk_opt_in", {
      metadata: { count: result.count },
    });

    revalidatePath("/settings/compliance");
    revalidatePath("/contacts");

    return {
      success: `${result.count} contact${result.count === 1 ? "" : "s"} marked as opted in. Anyone who had opted out was left alone.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to do that." };
    }
    return { error: "Could not update the contacts." };
  }
}
