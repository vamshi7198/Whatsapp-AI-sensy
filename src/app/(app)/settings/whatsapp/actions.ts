"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/rbac";
import {
  SETTING_KEYS,
  deleteSetting,
  getMetaConfig,
  setSecret,
  setSetting,
} from "@/lib/settings";
import { MetaCloudProvider } from "@/lib/whatsapp/providers/meta";
import { env } from "@/lib/env";

export interface WhatsAppSettingsState {
  error?: string;
  success?: string;
  connection?: {
    ok: boolean;
    businessName?: string;
    phoneNumber?: string;
    verifiedName?: string;
    qualityRating?: string;
    messagingTier?: string;
    message: string;
  };
}

const settingsSchema = z.object({
  wabaId: z
    .string()
    .trim()
    .regex(/^\d+$/, "The WhatsApp Business Account ID should be numbers only"),
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d+$/, "The Phone Number ID should be numbers only"),
  apiVersion: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/, 'API version should look like "v23.0"'),
  // Blank means "keep the existing token" — the field is write-only, so the
  // form cannot echo the current value back for resubmission.
  accessToken: z.string().trim(),
});

export async function saveWhatsAppSettings(
  _prev: WhatsAppSettingsState,
  formData: FormData,
): Promise<WhatsAppSettingsState> {
  try {
    const user = await requireApiAuth("settings:whatsapp");

    const parsed = settingsSchema.safeParse({
      wabaId: formData.get("wabaId"),
      phoneNumberId: formData.get("phoneNumberId"),
      apiVersion: formData.get("apiVersion"),
      accessToken: formData.get("accessToken") ?? "",
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
    }

    const { wabaId, phoneNumberId, apiVersion, accessToken } = parsed.data;

    await setSetting(SETTING_KEYS.WABA_ID, wabaId, user.id);
    await setSetting(SETTING_KEYS.PHONE_NUMBER_ID, phoneNumberId, user.id);
    await setSetting(SETTING_KEYS.API_VERSION, apiVersion, user.id);

    if (accessToken) {
      if (accessToken.length < 20) {
        return {
          error:
            "That access token looks too short. Copy the full token from Meta Business Settings.",
        };
      }
      await setSecret(SETTING_KEYS.ACCESS_TOKEN, accessToken, user.id);
    }

    // The audit log records that the credentials changed, never their values.
    await audit(user, "settings.whatsapp_update", {
      entityType: "AppSetting",
      metadata: {
        wabaId,
        phoneNumberId,
        apiVersion,
        tokenChanged: Boolean(accessToken),
      },
    });

    revalidatePath("/settings/whatsapp");
    return { success: "WhatsApp settings saved." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change these settings." };
    }
    return { error: "Could not save the settings. Please try again." };
  }
}

/**
 * Calls Meta with the stored credentials and reports the result in plain
 * language, so a mistake is found here rather than when a campaign fails.
 */
export async function testConnection(): Promise<WhatsAppSettingsState> {
  try {
    const user = await requireApiAuth("settings:whatsapp");
    const config = await getMetaConfig();

    if (!config) {
      return {
        connection: {
          ok: false,
          message:
            "Fill in all three fields and the access token, then save before testing.",
        },
      };
    }

    const provider = new MetaCloudProvider(config, env.META_APP_SECRET);

    const [phone, account] = await Promise.all([
      provider.getPhoneNumber(),
      provider.getBusinessAccount(),
    ]);

    if (!phone) {
      await setSetting(
        SETTING_KEYS.LAST_CONNECTION_ERROR,
        new Date().toISOString(),
      );

      return {
        connection: {
          ok: false,
          message:
            "WhatsApp rejected these details. Check the Phone Number ID and that the access token is a System User token that has not expired.",
        },
      };
    }

    // Cache what Meta told us, so the dashboard can warn about a falling
    // quality rating without calling Meta on every page load.
    await setSetting(SETTING_KEYS.LAST_CONNECTION_OK, new Date().toISOString());
    if (phone.qualityRating) {
      await setSetting(SETTING_KEYS.QUALITY_RATING, phone.qualityRating);
    }
    if (phone.messagingLimitTier) {
      await setSetting(SETTING_KEYS.MESSAGING_TIER, phone.messagingLimitTier);
    }

    await audit(user, "settings.whatsapp_test", {
      metadata: { ok: true, phoneNumberId: config.phoneNumberId },
    });

    return {
      connection: {
        ok: true,
        businessName: account?.name,
        phoneNumber: phone.displayPhoneNumber,
        verifiedName: phone.verifiedName,
        qualityRating: phone.qualityRating,
        messagingTier: phone.messagingLimitTier,
        message: "Connected successfully.",
      },
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to test the connection." };
    }
    return {
      connection: {
        ok: false,
        message: "Could not reach WhatsApp. Check your internet connection.",
      },
    };
  }
}

export async function disconnectWhatsApp(): Promise<WhatsAppSettingsState> {
  try {
    const user = await requireApiAuth("settings:whatsapp");

    await Promise.all([
      deleteSetting(SETTING_KEYS.ACCESS_TOKEN),
      deleteSetting(SETTING_KEYS.LAST_CONNECTION_OK),
      deleteSetting(SETTING_KEYS.QUALITY_RATING),
      deleteSetting(SETTING_KEYS.MESSAGING_TIER),
    ]);

    await audit(user, "settings.whatsapp_disconnect");

    revalidatePath("/settings/whatsapp");
    return {
      success:
        "Access token removed. No messages can be sent until a new token is saved.",
    };
  } catch {
    return { error: "Could not disconnect. Please try again." };
  }
}
