import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/db";
import { getQueue } from "../queue";
import { RUN_JOB_TYPE } from "../execution";
import { getDeliveryForRun } from "../delivery";
import type { InputType } from "../../lib/constants";
import type { RecipeInputDef } from "../recipes/types";

export interface RunInputDef {
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
}

/**
 * Validate + coerce operator-supplied inputs against a recipe version's input
 * definitions. Returns a flat string map (the DB stores inputs as JSON strings).
 * Throws a friendly Error on the first problem.
 */
export function coerceRunInputs(defs: RunInputDef[], raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};

  for (const def of defs) {
    const rawValue = raw[def.key];

    if (def.type === "boolean") {
      out[def.key] = rawValue === true || rawValue === "true" ? "true" : "false";
      continue;
    }

    // File-style inputs accept an optional text value (URL / pasted content /
    // note) in Phase 4; direct uploads arrive with delivery in a later phase.
    const isFileType = def.type === "file" || def.type === "image" || def.type === "csv";

    const value = typeof rawValue === "string" ? rawValue.trim() : "";

    if (!value) {
      if (def.required && !isFileType) throw new Error(`"${def.label}" is required.`);
      out[def.key] = "";
      continue;
    }

    if (def.type === "select") {
      const allowed = (def.options ?? []).map((o) => o.value);
      if (!allowed.includes(value)) throw new Error(`"${def.label}": choose one of the provided options.`);
    } else if (def.type === "url") {
      if (!/^https?:\/\/.+/i.test(value)) throw new Error(`"${def.label}" must be a valid http(s) URL.`);
    } else if (def.type === "color") {
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
        throw new Error(`"${def.label}" must be a hex color like #7c3aed.`);
      }
    }

    if (value.length > 20_000) throw new Error(`"${def.label}" is too long.`);
    out[def.key] = value;
  }

  return out;
}

/**
 * Create a run against a project + a recipe's current head version, validate its
 * inputs, and enqueue it for the worker. The AI pipeline runs asynchronously.
 */
export async function createRun(
  organizationId: string,
  args: { projectId: string; recipeId: string; inputs: Record<string, unknown> },
): Promise<{ runId: string }> {
  const project = await prisma.project.findFirst({
    where: { id: args.projectId, workspace: { organizationId } },
    select: { id: true, storageKey: true },
  });
  if (!project) throw new Error("Project not found.");
  if (!project.storageKey) throw new Error("This project has no stored source archive to run against.");

  const recipe = await prisma.recipe.findFirst({
    where: { id: args.recipeId, organizationId },
    select: {
      id: true,
      isActive: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { inputs: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!recipe || recipe.versions.length === 0) throw new Error("Recipe not found.");
  if (!recipe.isActive) throw new Error("This recipe is inactive. Activate it before running.");

  const head = recipe.versions[0];
  const defs: RunInputDef[] = head.inputs.map((i) => ({
    key: i.key,
    label: i.label,
    type: i.type as InputType,
    required: i.required,
    options: parseOptions(i.optionsJson),
  }));
  const values = coerceRunInputs(defs, args.inputs);

  const run = await prisma.run.create({
    data: {
      projectId: project.id,
      recipeVersionId: head.id,
      status: "queued",
      inputsJson: JSON.stringify(values),
      correlationId: randomUUID(),
    },
  });

  await getQueue().enqueue(RUN_JOB_TYPE, { runId: run.id });
  return { runId: run.id };
}

// ---- launch targets (project + recipe pickers) ----

export interface RunnableProject {
  id: string;
  name: string;
  workspaceName: string;
  framework: string | null;
}

export interface RunnableRecipe {
  id: string;
  name: string;
  category: string | null;
  version: number;
  inputs: RecipeInputDef[];
  /** Names of reference implementations (templates) linked to this recipe. */
  referenceTemplates: string[];
}

/**
 * Everything the "new run" screen needs: projects that have a stored archive to
 * run against, and active recipes with their current head input definitions
 * (client-safe DTOs — the launch form is a client component).
 */
export async function listRunnableTargets(
  organizationId: string,
): Promise<{ projects: RunnableProject[]; recipes: RunnableRecipe[] }> {
  const [projectRows, recipeRows] = await Promise.all([
    prisma.project.findMany({
      where: { workspace: { organizationId }, storageKey: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        workspace: { select: { name: true } },
        analysis: { select: { framework: true } },
      },
    }),
    prisma.recipe.findMany({
      where: { organizationId, isActive: true },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        templates: { select: { name: true }, orderBy: { createdAt: "desc" } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: { inputs: { orderBy: { order: "asc" } } },
        },
      },
    }),
  ]);

  const projects: RunnableProject[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    workspaceName: p.workspace.name,
    framework: p.analysis?.framework ?? null,
  }));

  const recipes: RunnableRecipe[] = recipeRows
    .filter((r) => r.versions.length > 0)
    .map((r) => {
      const head = r.versions[0];
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        version: head.version,
        inputs: head.inputs.map((i) => ({
          key: i.key,
          label: i.label,
          type: i.type as InputType,
          required: i.required,
          placeholder: parseValidation(i.validationJson).placeholder,
          help: parseValidation(i.validationJson).help,
          options: parseOptions(i.optionsJson),
        })),
        referenceTemplates: r.templates.map((t) => t.name),
      };
    });

  return { projects, recipes };
}

export interface RunListItem {
  id: string;
  status: string;
  projectName: string;
  recipeName: string;
  recipeVersion: number;
  filesChanged: number | null;
  createdAt: Date;
}

export async function listRuns(organizationId: string): Promise<RunListItem[]> {
  const runs = await prisma.run.findMany({
    where: { project: { workspace: { organizationId } } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      project: { select: { name: true } },
      recipeVersion: { select: { version: true, recipe: { select: { name: true } } } },
      diffs: { select: { filesChanged: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    projectName: r.project.name,
    recipeName: r.recipeVersion.recipe.name,
    recipeVersion: r.recipeVersion.version,
    filesChanged: r.diffs[0]?.filesChanged ?? null,
    createdAt: r.createdAt,
  }));
}

export interface RunStepView {
  phase: string;
  status: string;
  tokensIn: number | null;
  tokensOut: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface RunQaResultView {
  check: string;
  status: string;
  required: boolean;
  summary: string | null;
  detail: string | null;
}

export interface RunDeliveryView {
  shareUrl: string;
  expiresAt: Date | null;
  expired: boolean;
  hasBundle: boolean;
}

export interface RunDetail {
  id: string;
  status: string;
  error: string | null;
  projectId: string;
  projectName: string;
  recipeName: string;
  recipeVersion: number;
  /** Reference implementations (templates) linked to the recipe that informed this run. */
  referenceTemplates: string[];
  inputs: Array<{ key: string; label: string; value: string }>;
  steps: RunStepView[];
  qaResults: RunQaResultView[];
  diff: { filesChanged: number | null; insertions: number | null; deletions: number | null; summary: string | null } | null;
  delivery: RunDeliveryView | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export async function getRunDetail(organizationId: string, runId: string): Promise<RunDetail | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId, project: { workspace: { organizationId } } },
    include: {
      project: { select: { id: true, name: true } },
      recipeVersion: {
        select: {
          version: true,
          recipe: { select: { name: true, templates: { select: { name: true }, orderBy: { createdAt: "desc" } } } },
          inputs: { orderBy: { order: "asc" } },
        },
      },
      steps: { orderBy: { createdAt: "asc" } },
      qaResults: { orderBy: { createdAt: "asc" } },
      diffs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!run) return null;

  const values = parseInputs(run.inputsJson);
  const diff = run.diffs[0] ?? null;
  const deliverySummary = await getDeliveryForRun(organizationId, runId);

  return {
    id: run.id,
    status: run.status,
    error: run.error,
    projectId: run.project.id,
    projectName: run.project.name,
    recipeName: run.recipeVersion.recipe.name,
    recipeVersion: run.recipeVersion.version,
    referenceTemplates: run.recipeVersion.recipe.templates.map((t) => t.name),
    inputs: run.recipeVersion.inputs.map((i) => ({ key: i.key, label: i.label, value: values[i.key] ?? "" })),
    steps: run.steps.map((s) => ({
      phase: s.phase,
      status: s.status,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
    })),
    qaResults: run.qaResults.map((q) => {
      const d = parseQaDetails(q.detailsJson);
      return { check: q.check, status: q.status, required: d.required, summary: d.summary, detail: d.detail };
    }),
    diff: diff
      ? { filesChanged: diff.filesChanged, insertions: diff.insertions, deletions: diff.deletions, summary: diff.summary }
      : null,
    delivery: deliverySummary
      ? {
          shareUrl: deliverySummary.shareUrl,
          expiresAt: deliverySummary.expiresAt,
          expired: deliverySummary.expired,
          hasBundle: deliverySummary.hasBundle,
        }
      : null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** Read the stored unified patch for a run (org-scoped). Null if not produced yet. */
export async function getRunDiffPatch(organizationId: string, runId: string): Promise<string | null> {
  const run = await prisma.run.findFirst({
    where: { id: runId, project: { workspace: { organizationId } } },
    include: { diffs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const key = run?.diffs[0]?.storageKey;
  if (!key) return null;
  const { getStorageProvider } = await import("../storage");
  try {
    return (await getStorageProvider().get(key)).toString("utf8");
  } catch {
    return null;
  }
}

function parseOptions(json: string | null): Array<{ value: string; label: string }> | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : undefined;
  } catch {
    return undefined;
  }
}

function parseValidation(json: string | null): { placeholder?: string; help?: string } {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function parseQaDetails(json: string | null): { summary: string | null; detail: string | null; required: boolean } {
  if (!json) return { summary: null, detail: null, required: false };
  try {
    const obj = JSON.parse(json) as { summary?: unknown; detail?: unknown; required?: unknown };
    return {
      summary: typeof obj.summary === "string" ? obj.summary : null,
      detail: typeof obj.detail === "string" ? obj.detail : null,
      required: obj.required === true,
    };
  } catch {
    return { summary: null, detail: null, required: false };
  }
}

function parseInputs(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = typeof v === "string" ? v : String(v);
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}
