"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { requireApiAuth } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/rbac";

export interface PricingState {
  error?: string;
  success?: string;
}

const rateSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .min(1)
    .max(2)
    .transform((v) => v.toUpperCase()),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase()),
  ratePerMessage: z
    .string()
    .trim()
    .refine((v) => v !== "" && Number.isFinite(Number(v)), "Enter a number")
    .transform(Number)
    .refine((v) => v >= 0, "A rate cannot be negative")
    .refine((v) => v < 1000, "That rate looks wrong — check the decimal point"),
  note: z.string().trim().max(200).optional(),
});

/**
 * Saves a rate, superseding rather than overwriting the previous one.
 *
 * Old rates are closed off with effectiveTo instead of being edited, because
 * a campaign sent last month was billed at last month's price. Rewriting the
 * rate in place would silently restate what past campaigns cost.
 */
export async function saveRate(
  _prev: PricingState,
  formData: FormData,
): Promise<PricingState> {
  try {
    const user = await requireApiAuth("settings:pricing");

    const parsed = rateSchema.safeParse({
      countryCode: formData.get("countryCode"),
      category: formData.get("category"),
      currency: formData.get("currency"),
      ratePerMessage: formData.get("ratePerMessage"),
      note: formData.get("note") || undefined,
    });

    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the values." };
    }

    const { countryCode, category, currency, ratePerMessage, note } = parsed.data;
    const now = new Date();

    const current = await prisma.pricingRate.findFirst({
      where: {
        countryCode,
        category,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });

    if (current && Number(current.ratePerMessage) === ratePerMessage) {
      return { success: "That is already the current rate." };
    }

    await prisma.$transaction([
      // Close the old rate rather than delete it: past campaigns were costed
      // against it and that history has to stay readable.
      ...(current
        ? [
            prisma.pricingRate.update({
              where: { id: current.id },
              data: { effectiveTo: now },
            }),
          ]
        : []),
      prisma.pricingRate.create({
        data: {
          countryCode,
          category,
          currency,
          ratePerMessage,
          effectiveFrom: now,
          note,
        },
      }),
    ]);

    await audit(user, "settings.pricing", {
      metadata: {
        countryCode,
        category,
        currency,
        from: current ? Number(current.ratePerMessage) : null,
        to: ratePerMessage,
      },
    });

    revalidatePath("/settings/pricing");
    revalidatePath("/reports/spend");

    return {
      success: `Saved. New campaigns are costed at ${currency} ${ratePerMessage} per ${category.toLowerCase()} message to ${countryCode === "*" ? "other countries" : countryCode}.`,
    };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { error: "You do not have permission to change pricing." };
    }
    return { error: "Could not save the rate. Please try again." };
  }
}
