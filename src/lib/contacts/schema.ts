import { z } from "zod";

import { normalizePhone } from "./phone";

/**
 * Validation schemas for contact input.
 *
 * These run on the server. Client-side validation using the same schemas is a
 * UX convenience — it is never the control.
 */

/**
 * Phone field that normalises as it validates, so callers always receive
 * E.164 and can never accidentally persist the raw user input.
 */
const phoneField = z
  .string()
  .min(1, "Phone number is required")
  .transform((value, ctx) => {
    const result = normalizePhone(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.message });
      return z.NEVER;
    }
    return result.e164;
  });

const optionalEmail = z
  .union([z.email("Enter a valid email address"), z.literal("")])
  .optional()
  .transform((v) => (v === "" ? undefined : v));

export const createContactSchema = z.object({
  name: z.string().trim().max(120, "Name is too long").optional(),
  phone: phoneField,
  email: optionalEmail,
  tagIds: z.array(z.string()).default([]),
  source: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),

  /**
   * Consent is explicit and defaults to false. It is never inferred from the
   * fact that we hold someone's phone number.
   */
  optedIn: z.boolean().default(false),
  optInSource: z.string().max(120).optional(),
});

export type CreateContactInput = z.input<typeof createContactSchema>;
export type CreateContactData = z.output<typeof createContactSchema>;

export const updateContactSchema = createContactSchema
  .partial()
  .extend({ id: z.string().min(1) });

export const contactFilterSchema = z.object({
  search: z.string().trim().max(120).optional(),
  tagIds: z.array(z.string()).optional(),
  optInStatus: z.enum(["UNKNOWN", "OPTED_IN", "OPTED_OUT"]).optional(),
  marketingOptOut: z.boolean().optional(),
  source: z.string().optional(),
  sortBy: z
    .enum(["name", "createdAt", "lastContactedAt", "phoneE164"])
    .default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  // Capped server-side so ?pageSize=999999 cannot be used to dump the whole
  // contact list in one request.
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ContactFilter = z.output<typeof contactFilterSchema>;

export const bulkContactActionSchema = z.object({
  contactIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one contact")
    .max(1000, "Select at most 1000 contacts at a time"),
  action: z.enum(["delete", "addTag", "removeTag", "export"]),
  tagId: z.string().optional(),
});

export const createTagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tag name is required")
    .max(50, "Tag name is too long")
    .regex(
      /^[a-zA-Z0-9_\- ]+$/,
      "Tag names can use letters, numbers, spaces, hyphens and underscores",
    ),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Choose a valid colour")
    .optional(),
});

/** URL-safe slug derived from a tag name. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
