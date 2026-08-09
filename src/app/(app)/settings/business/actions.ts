"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { ForbiddenError } from "@/lib/rbac";
import { getProvider } from "@/lib/whatsapp";

export interface BusinessProfileState {
  error?: string;
  success?: string;
  issues?: Record<string, string>;
}

/**
 * Meta's limits on the public profile. Exceeding one is rejected with an
 * unhelpful message, so they are checked here with the actual count shown.
 */
const LIMITS = {
  about: 139,
  description: 512,
  address: 256,
  email: 128,
  website: 256,
  websites: 2,
} as const;

const profileSchema = z.object({
  about: z.string().trim().max(LIMITS.about).optional(),
  description: z.string().trim().max(LIMITS.description).optional(),
  address: z.string().trim().max(LIMITS.address).optional(),
  email: z
    .union([z.email("Enter a valid email address"), z.literal("")])
    .optional(),
  vertical: z.string().trim().optional(),
});

export async function saveBusinessProfile(
  _prev: BusinessProfileState,
  formData: FormData,
): Promise<BusinessProfileState> {
  try {
    const user = await requireApiAuth("settings:business");

    const parsed = profileSchema.safeParse({
      about: formData.get("about") ?? "",
      description: formData.get("description") ?? "",
      address: formData.get("address") ?? "",
      email: formData.get("email") ?? "",
      vertical: formData.get("vertical") ?? "",
    });

    if (!parsed.success) {
      const issues: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        const limit = LIMITS[field as keyof typeof LIMITS];
        issues[field] =
          typeof limit === "number" && issue.code === "too_big"
            ? `WhatsApp allows ${limit} characters here.`
            : issue.message;
      }
      return { issues, error: "Please fix the problems below." };
    }

    // Up to two links. Most businesses want their site and one social
    // profile, which is exactly what Meta permits.
    const websites = [
      String(formData.get("website1") ?? "").trim(),
      String(formData.get("website2") ?? "").trim(),
    ].filter(Boolean);

    for (const [i, site] of websites.entries()) {
      if (!/^https?:\/\/.+/i.test(site)) {
        return {
          issues: {
            [`website${i + 1}`]: "The address must start with https://",
          },
          error: "Please fix the problems below.",
        };
      }
      if (site.length > LIMITS.website) {
        return {
          issues: {
            [`website${i + 1}`]: `WhatsApp allows ${LIMITS.website} characters.`,
          },
          error: "Please fix the problems below.",
        };
      }
    }

    const provider = await getProvider();
    if (!provider) {
      return { error: "WhatsApp is not connected." };
    }

    const ok = await provider.updateBusinessProfile({
      about: parsed.data.about ?? "",
      description: parsed.data.description ?? "",
      address: parsed.data.address ?? "",
      email: parsed.data.email ?? "",
      vertical: parsed.data.vertical || undefined,
      websites,
    });

    if (!ok) {
      return {
        error:
          "WhatsApp did not accept these details. Check the activity log for what it said.",
      };
    }

    await audit(user, "settings.business_profile", {
      metadata: { websites: websites.length },
    });

    revalidatePath("/settings/business");
    return { success: "Saved. Customers will see this on your profile." };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change this." };
    }
    return { error: "Could not save. Please try again." };
  }
}

const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

export async function uploadProfilePicture(
  _prev: BusinessProfileState,
  formData: FormData,
): Promise<BusinessProfileState> {
  try {
    const user = await requireApiAuth("settings:business");

    const file = formData.get("picture");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Choose an image first." };
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      return { error: "WhatsApp only accepts JPG or PNG images." };
    }

    if (file.size > MAX_PICTURE_BYTES) {
      return { error: "That image is larger than 5 MB. Use a smaller one." };
    }

    const provider = await getProvider();
    if (!provider) return { error: "WhatsApp is not connected." };

    const bytes = Buffer.from(await file.arrayBuffer());

    // Two steps: a resumable upload returns a file handle, which is then set
    // on the profile. The handle is not a media id and cannot be reused.
    const handle = await provider.uploadProfilePicture(bytes, file.type);
    if (!handle) {
      return {
        error:
          "The image could not be uploaded to WhatsApp. Try a smaller JPG.",
      };
    }

    const ok = await provider.updateBusinessProfile({
      profilePictureHandle: handle,
    });

    if (!ok) {
      return { error: "WhatsApp accepted the image but would not set it." };
    }

    await audit(user, "settings.profile_picture", {
      metadata: { bytes: file.size, type: file.type },
    });

    revalidatePath("/settings/business");
    return {
      success:
        "Profile picture updated. It can take a few minutes to show for customers.",
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change this." };
    }
    return { error: "Could not upload the image. Please try again." };
  }
}
