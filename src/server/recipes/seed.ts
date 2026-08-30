import { prisma } from "../../lib/db";
import type { InputType, QaCheckType } from "../../lib/constants";
import { slugify } from "./schema";

/**
 * Phase 7 — the recipe library TaskForge ships with.
 *
 * Each entry is a complete, production-relevant Task Recipe: a system prompt
 * that frames the engine, a task prompt with `{{key}}` placeholders filled from
 * the operator's inputs (see assembleRunContext), the typed inputs themselves,
 * and the QA checks that gate delivery. Seeding is idempotent — a recipe whose
 * slug already exists is left untouched, so operator edits and published
 * versions are never clobbered on re-seed.
 */

interface SeedInput {
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

interface SeedQa {
  type: QaCheckType;
  required: boolean;
  config?: Record<string, unknown>;
}

interface SeedRecipe {
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  prompt: string;
  inputs: SeedInput[];
  qaChecks: SeedQa[];
}

/** Build + type-check gate every recipe (typescript self-skips with no tsconfig). */
const CORE_QA: SeedQa[] = [
  { type: "build", required: true },
  { type: "typescript", required: true },
];

export const SEED_RECIPES: SeedRecipe[] = [
  {
    name: "Rebrand marketing site",
    description:
      "Replace an existing brand name (and optional brand color) across a web project — visible copy, metadata/titles, the package name, and theme tokens.",
    category: "Rebranding",
    systemPrompt:
      "You are TaskForge's rebranding engine. You replace one brand identity with another across an entire web project while keeping the site fully functional.\n\n" +
      "Rules:\n" +
      "- Replace every user-visible and metadata occurrence of the old name with the new name: page copy, headings, <title> and meta tags, alt text, footer, the \"name\" field in package.json, and README.\n" +
      "- Match the casing of each occurrence (Title Case → Title Case, lowercase → lowercase, kebab-case package names stay kebab-case).\n" +
      "- Prefer replace_in_files for the name sweep instead of rewriting files by hand.\n" +
      "- If an old brand color is given, replace it with the new color everywhere it appears (CSS/SCSS, Tailwind config, theme tokens, inline styles) — match hex casing and keep the leading '#'.\n" +
      "- Do NOT rename asset files, routes, or code identifiers unless the name is part of visible branding. Do not touch third-party package names in dependencies.\n" +
      "- When the sweep is complete, call finish with a one-line summary of what changed.",
    prompt:
      "Rebrand this project from \"{{oldName}}\" to \"{{newName}}\".\n\n" +
      "Replace all visible and metadata occurrences of the old brand name with the new one, matching the casing of each occurrence, including the package.json \"name\" field and the README.\n\n" +
      "If a color change is provided, also replace the old brand color {{oldColor}} with {{newColor}} everywhere it appears in styles and theme configuration.\n\n" +
      "Leave functionality, layout, and dependencies unchanged.",
    inputs: [
      { key: "oldName", label: "Current brand name", type: "text", required: true, placeholder: "Acme", help: "The brand name as it currently appears on the site." },
      { key: "newName", label: "New brand name", type: "text", required: true, placeholder: "Nimbus", help: "What to rename it to. Casing of each occurrence is preserved automatically." },
      { key: "oldColor", label: "Current brand color", type: "color", required: false, help: "Optional. Hex color to replace, e.g. #2563eb." },
      { key: "newColor", label: "New brand color", type: "color", required: false, help: "Optional. Hex color to use instead." },
    ],
    qaChecks: [
      { type: "branding", required: true },
      { type: "build", required: true },
      { type: "typescript", required: true },
    ],
  },
  {
    name: "Add Google Analytics 4",
    description:
      "Install the Google Analytics 4 (gtag.js) tracking snippet site-wide using a GA4 Measurement ID, so page views are reported to Google Analytics.",
    category: "Analytics",
    systemPrompt:
      "You are TaskForge's analytics integration engine. You add Google Analytics 4 (GA4) page-view tracking to a web project.\n\n" +
      "Rules:\n" +
      "- Inject the standard GA4 gtag.js snippet so it loads on EVERY page. Place it in the shared document head (e.g. Next.js app/layout or _document, a shared HTML <head>, the root component, or an index.html <head>) — never duplicated per page.\n" +
      "- Load the script from https://www.googletagmanager.com/gtag/js?id=<ID> and initialize with `window.dataLayer`, `gtag('js', new Date())`, and `gtag('config', '<ID>')` using the provided Measurement ID exactly.\n" +
      "- For framework projects, use the framework's recommended script mechanism (e.g. next/script with strategy=\"afterInteractive\") rather than a raw <script> when that is the idiomatic approach.\n" +
      "- Do not add a second analytics tool, and do not remove any existing tracking. If GA4 with this ID is already present, make no change and say so in finish.\n" +
      "- When done, call finish summarizing where the snippet was added.",
    prompt:
      "Add Google Analytics 4 tracking to this project using Measurement ID {{measurementId}}.\n\n" +
      "Load the gtag.js snippet site-wide from the shared document head so every page reports page views, initialize it with the Measurement ID above, and follow this framework's idiomatic way of injecting scripts.",
    inputs: [
      {
        key: "measurementId",
        label: "GA4 Measurement ID",
        type: "text",
        required: true,
        placeholder: "G-XXXXXXXXXX",
        help: "Found in Google Analytics → Admin → Data streams. Starts with \"G-\".",
      },
    ],
    qaChecks: CORE_QA,
  },
  {
    name: "Connect GoHighLevel webhook",
    description:
      "Wire a site's lead/contact form submissions to a GoHighLevel (GHL) inbound webhook, POSTing the form fields as JSON so leads land in the CRM.",
    category: "Integration",
    systemPrompt:
      "You are TaskForge's integration engine. You connect a web form to a GoHighLevel inbound webhook.\n\n" +
      "Rules:\n" +
      "- On submit of the target form, POST the collected fields to the GHL webhook URL as JSON (Content-Type: application/json) using fetch. Preserve the field names already present on the form.\n" +
      "- Keep the existing submit behavior intact: still validate as before, show the existing success/error UI, and do not remove any current handler — augment it. Prevent the default full-page navigation only if the form currently relies on it and a fetch is now handling the submit.\n" +
      "- If a form selector is provided, target that form; otherwise target the site's primary contact/lead form.\n" +
      "- Handle the request failing gracefully (catch and surface the existing error state) so a webhook outage never breaks the page.\n" +
      "- Never hard-code secrets beyond the provided webhook URL. When done, call finish summarizing the wiring.",
    prompt:
      "Send this site's form submissions to the GoHighLevel webhook {{webhookUrl}}.\n\n" +
      "On submit, POST the form's fields to that URL as JSON via fetch, keeping the existing validation and success/error UI intact. Target the form matching the selector \"{{formSelector}}\" when provided, otherwise the primary contact/lead form.",
    inputs: [
      {
        key: "webhookUrl",
        label: "GHL webhook URL",
        type: "url",
        required: true,
        placeholder: "https://services.leadconnectorhq.com/hooks/…",
        help: "The inbound webhook URL from your GoHighLevel workflow trigger.",
      },
      {
        key: "formSelector",
        label: "Form selector",
        type: "text",
        required: false,
        placeholder: "#contact-form",
        help: "Optional CSS selector for the form to wire up. Leave blank to use the main contact form.",
      },
    ],
    qaChecks: CORE_QA,
  },
  {
    name: "Add Endorsely affiliate tracking",
    description:
      "Install the Endorsely (PAP-style) affiliate tracking script site-wide so referral visits are attributed and conversions can be reported back to Endorsely.",
    category: "Integration",
    systemPrompt:
      "You are TaskForge's integration engine. You add Endorsely affiliate/referral tracking to a web project.\n\n" +
      "Rules:\n" +
      "- Load the Endorsely script site-wide from the shared document head: `<script async src=\"https://assets.endorsely.com/endorsely.js\" data-endorsely=\"<ID>\"></script>` (or the framework's idiomatic script mechanism, e.g. next/script afterInteractive), using the provided Endorsely ID exactly.\n" +
      "- It must load on every page (shared layout/_document/root/index.html head), not per-page and never duplicated.\n" +
      "- If a signup/checkout flow exists and clearly exposes the affiliate referral id (window.endorsely_referral), pass it along to that flow; otherwise just install the tracking script and note that referral attribution on conversion needs a follow-up.\n" +
      "- Do not remove existing analytics or scripts. If Endorsely with this ID is already present, make no change and say so in finish.\n" +
      "- When done, call finish summarizing where the script was added.",
    prompt:
      "Add Endorsely affiliate tracking to this project using Endorsely ID {{endorselyId}}.\n\n" +
      "Load the Endorsely script site-wide from the shared document head so referral visits are attributed on every page, following this framework's idiomatic way of injecting scripts.",
    inputs: [
      {
        key: "endorselyId",
        label: "Endorsely ID",
        type: "text",
        required: true,
        placeholder: "abc123",
        help: "The account/site ID from your Endorsely dashboard (data-endorsely value).",
      },
    ],
    qaChecks: CORE_QA,
  },
  {
    name: "Import coupon codes from CSV",
    description:
      "Turn a CSV of coupon/discount codes into structured project data (e.g. a coupons JSON/TS module) that the site can read, mapping CSV columns to code and discount fields.",
    category: "Data mapping",
    systemPrompt:
      "You are TaskForge's data-mapping engine. You convert a CSV of coupon codes into structured data the project can consume.\n\n" +
      "Rules:\n" +
      "- Parse the provided CSV (the first row is a header). Map its columns to a normalized shape: at minimum a `code` and a discount value (percent or amount); carry through obvious extra columns like description or expiry when present.\n" +
      "- Write the result as a data module the project can import — match the project's conventions (a .ts/.js export or a .json file). If a target path is provided, write there; otherwise choose a sensible location (e.g. src/data/coupons.ts or data/coupons.json) and create the folder if needed.\n" +
      "- If an existing coupons data file is found, replace its contents with the mapped data rather than creating a duplicate.\n" +
      "- Keep values as strings/numbers faithfully; do not invent codes or discounts beyond the CSV. Skip blank rows.\n" +
      "- When done, call finish summarizing how many codes were imported and where.",
    prompt:
      "Import the following coupon codes into this project as structured data.\n\n" +
      "CSV (first row is the header):\n{{couponsCsv}}\n\n" +
      "Map each row to a normalized coupon object (code + discount, plus description/expiry when present) and write it as an importable data module. Use the target path \"{{targetPath}}\" when provided, otherwise choose a location that fits the project's conventions.",
    inputs: [
      {
        key: "couponsCsv",
        label: "Coupon CSV",
        type: "csv",
        required: true,
        placeholder: "code,discount,expiry\nSAVE10,10%,2026-12-31",
        help: "Paste or upload the CSV. First row must be a header describing the columns.",
      },
      {
        key: "targetPath",
        label: "Target file path",
        type: "text",
        required: false,
        placeholder: "src/data/coupons.ts",
        help: "Optional. Where to write the generated data module. Leave blank to auto-select.",
      },
    ],
    qaChecks: CORE_QA,
  },
];

/**
 * Create any missing seed recipes for an org. Existing slugs are skipped so
 * this can be re-run safely (e.g. from `prisma db seed`). Returns which
 * recipes were created vs. already present.
 */
export async function seedRecipes(
  organizationId: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];

  for (const r of SEED_RECIPES) {
    const slug = slugify(r.name);
    const existing = await prisma.recipe.findUnique({ where: { slug } });
    if (existing) {
      skipped.push(r.name);
      continue;
    }

    await prisma.recipe.create({
      data: {
        organizationId,
        name: r.name,
        description: r.description,
        category: r.category,
        slug,
        versions: {
          create: {
            version: 1,
            prompt: r.prompt,
            systemPrompt: r.systemPrompt,
            inputs: {
              create: r.inputs.map((inp, order) => ({
                key: inp.key,
                label: inp.label,
                type: inp.type,
                required: inp.required,
                optionsJson: inp.options && inp.options.length ? JSON.stringify(inp.options) : null,
                validationJson: validationJson(inp),
                order,
              })),
            },
            qaChecks: {
              create: r.qaChecks.map((q) => ({
                type: q.type,
                required: q.required,
                configJson: q.config && Object.keys(q.config).length ? JSON.stringify(q.config) : null,
              })),
            },
          },
        },
      },
    });
    created.push(r.name);
  }

  return { created, skipped };
}

function validationJson(inp: SeedInput): string | null {
  const v: Record<string, string> = {};
  if (inp.placeholder) v.placeholder = inp.placeholder;
  if (inp.help) v.help = inp.help;
  return Object.keys(v).length ? JSON.stringify(v) : null;
}
