import { z } from "zod";
import { inputTypeSchema, qaCheckTypeSchema } from "../../lib/constants";

/** Input keys become object properties in the collected inputs; keep them identifier-safe. */
export const inputKeySchema = z
  .string()
  .trim()
  .min(1, "Key is required")
  .max(60)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Use letters, digits, underscore; must start with a letter");

export const optionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
});

export const inputDefSchema = z
  .object({
    key: inputKeySchema,
    label: z.string().trim().min(1, "Label is required").max(120),
    type: inputTypeSchema,
    required: z.boolean(),
    placeholder: z.string().trim().max(200).optional(),
    help: z.string().trim().max(300).optional(),
    options: z.array(optionSchema).max(50).optional(),
  })
  .refine((i) => i.type !== "select" || (i.options && i.options.length > 0), {
    message: "Select inputs need at least one option",
    path: ["options"],
  });

export const qaCheckDefSchema = z.object({
  type: qaCheckTypeSchema,
  required: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const versionDraftSchema = z
  .object({
    systemPrompt: z.string().trim().max(20000).optional(),
    prompt: z.string().trim().min(1, "Prompt is required").max(20000),
    model: z.string().trim().max(120).optional(),
    changelog: z.string().trim().max(2000).optional(),
    inputs: z.array(inputDefSchema).max(60),
    qaChecks: z.array(qaCheckDefSchema).max(40),
  })
  .refine(
    (d) => new Set(d.inputs.map((i) => i.key)).size === d.inputs.length,
    { message: "Input keys must be unique", path: ["inputs"] },
  )
  .refine(
    (d) => new Set(d.qaChecks.map((c) => c.type)).size === d.qaChecks.length,
    { message: "Each QA check type can appear once", path: ["qaChecks"] },
  );

export const createRecipeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(60).optional(),
  prompt: z.string().trim().min(1, "An initial prompt is required").max(20000),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;

/** URL-safe slug from a recipe name. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "recipe";
}
