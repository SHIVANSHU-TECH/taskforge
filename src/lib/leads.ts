import { z } from "zod";

/**
 * Shared lead schema — the single source of truth for the "I'm Interested"
 * contact form. Imported by both the client form (validation + typing) and the
 * `/api/leads` route (server-side validation), so the two can never drift.
 *
 * The payload shape intentionally matches the documented lead contract:
 *   { name, email, phone, company, message, product, plan, source }
 * Extra product/plan fields keep it extensible for a multi-product catalogue.
 */
export const leadInputSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a valid phone number")
    .max(24)
    .regex(/^[+\d][\d\s()-]{6,}$/, "Enter a valid phone number"),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  product: z.string().trim().max(160).optional().or(z.literal("")),
  plan: z.string().trim().max(160).optional().or(z.literal("")),
  source: z.string().trim().max(80).default("product-landing-page"),
});

export type LeadInput = z.infer<typeof leadInputSchema>;

export interface LeadSubmitResult {
  ok: boolean;
  /** User-facing message, safe to render directly. */
  message: string;
  /** Field-level errors keyed by field name, when validation failed client/server side. */
  fieldErrors?: Partial<Record<keyof LeadInput, string>>;
}
