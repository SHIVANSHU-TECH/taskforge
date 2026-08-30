import type { InputType, QaCheckType } from "../../lib/constants";

/** A typed input field an operator fills in when running a recipe. */
export interface RecipeInputDef {
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  placeholder?: string;
  help?: string;
  /** For `select` inputs. */
  options?: Array<{ value: string; label: string }>;
}

/** An automated QA check run in the sandbox after changes are applied (Phase 5). */
export interface QaCheckDef {
  type: QaCheckType;
  required: boolean;
  config?: Record<string, unknown>;
}

/** The editable content of a recipe version. */
export interface VersionDraft {
  systemPrompt?: string;
  prompt: string;
  model?: string;
  changelog?: string;
  inputs: RecipeInputDef[];
  qaChecks: QaCheckDef[];
}

export interface ReferenceSummary {
  id: string;
  title: string;
  hasOriginal: boolean;
  hasCompleted: boolean;
  hasDiff: boolean;
  promptUsed: string | null;
  inputsJson: string | null;
  createdAt: Date;
}

/** A template the org owns, offered as a linkable reference implementation. */
export interface TemplateOption {
  id: string;
  name: string;
  framework: string | null;
}

export interface RecipeVersionDetail {
  id: string;
  version: number;
  prompt: string;
  systemPrompt: string | null;
  model: string | null;
  changelog: string | null;
  createdAt: Date;
  inputs: RecipeInputDef[];
  qaChecks: QaCheckDef[];
  references: ReferenceSummary[];
}

export interface RecipeDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: Date;
  versions: Array<{ id: string; version: number; changelog: string | null; createdAt: Date }>;
  head: RecipeVersionDetail;
  /** Reference implementations linked to this recipe (curated, org-scoped). */
  linkedTemplates: TemplateOption[];
}

export interface RecipeSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  isActive: boolean;
  versionCount: number;
  latestVersion: number;
  inputCount: number;
  qaCheckCount: number;
  referenceCount: number;
  updatedAt: Date;
}

export const INPUT_TYPE_LABELS: Record<InputType, string> = {
  text: "Text",
  color: "Color",
  url: "URL",
  file: "File",
  image: "Image",
  csv: "CSV",
  boolean: "Toggle",
  select: "Select",
};

export const QA_CHECK_LABELS: Record<QaCheckType, string> = {
  build: "Build passes",
  typescript: "Type-check passes",
  lint: "Lint passes",
  api: "API responds",
  e2e: "End-to-end flow",
  visual: "Visual regression",
  branding: "Branding replaced",
};

export const QA_CHECK_DESCRIPTIONS: Record<QaCheckType, string> = {
  build: "Runs the project's build script and requires exit code 0.",
  typescript: "Runs tsc --noEmit and requires no type errors.",
  lint: "Runs the lint script and requires it to pass.",
  api: "Hits a configured endpoint and asserts the status/response.",
  e2e: "Runs a Playwright flow against the preview.",
  visual: "Compares screenshots against a baseline.",
  branding: "Asserts old strings are gone and new ones are present.",
};

/** QA checks every new recipe starts with. */
export const DEFAULT_QA_CHECKS: QaCheckDef[] = [
  { type: "build", required: true },
  { type: "typescript", required: true },
];

/** Suggested categories (free-text; surfaced as a datalist). */
export const COMMON_CATEGORIES = [
  "Rebranding",
  "Analytics",
  "Integration",
  "Data mapping",
  "SEO",
  "Content",
  "Custom",
] as const;
