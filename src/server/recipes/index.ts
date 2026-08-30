import { prisma } from "../../lib/db";
import type { InputType, QaCheckType } from "../../lib/constants";
import { getStorageProvider } from "../storage";
import { extractZip } from "../ingestion/extract";
import { computeProjectDiff, fileMapFromEntries } from "../diff";
import { slugify, type CreateRecipeInput } from "./schema";
import {
  DEFAULT_QA_CHECKS,
  type QaCheckDef,
  type RecipeDetail,
  type RecipeInputDef,
  type RecipeSummary,
  type RecipeVersionDetail,
  type TemplateOption,
  type VersionDraft,
} from "./types";

// ---- (de)serialization between DTOs and the String/`*Json` DB columns ----

function safeParse<T>(json: string | null): T | undefined {
  if (!json) return undefined;
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

function inputToRow(def: RecipeInputDef, order: number) {
  const validation: Record<string, string> = {};
  if (def.placeholder) validation.placeholder = def.placeholder;
  if (def.help) validation.help = def.help;
  return {
    key: def.key,
    label: def.label,
    type: def.type,
    required: def.required,
    optionsJson: def.options && def.options.length ? JSON.stringify(def.options) : null,
    validationJson: Object.keys(validation).length ? JSON.stringify(validation) : null,
    order,
  };
}

type InputRow = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  optionsJson: string | null;
  validationJson: string | null;
  order: number;
};

function rowToInput(row: InputRow): RecipeInputDef {
  const validation = safeParse<{ placeholder?: string; help?: string }>(row.validationJson) ?? {};
  return {
    key: row.key,
    label: row.label,
    type: row.type as InputType,
    required: row.required,
    placeholder: validation.placeholder,
    help: validation.help,
    options: safeParse<Array<{ value: string; label: string }>>(row.optionsJson),
  };
}

function qaToRow(def: QaCheckDef) {
  return {
    type: def.type,
    required: def.required,
    configJson: def.config && Object.keys(def.config).length ? JSON.stringify(def.config) : null,
  };
}

type QaRow = { type: string; required: boolean; configJson: string | null };

function rowToQa(row: QaRow): QaCheckDef {
  return {
    type: row.type as QaCheckType,
    required: row.required,
    config: safeParse<Record<string, unknown>>(row.configJson),
  };
}

// ---- reads ----

export async function listRecipes(organizationId: string): Promise<RecipeSummary[]> {
  const rows = await prisma.recipe.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { versions: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: {
          _count: { select: { inputs: true, qaChecks: true, referenceExamples: true } },
        },
      },
    },
  });

  return rows.map((r) => {
    const head = r.versions[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      category: r.category,
      isActive: r.isActive,
      versionCount: r._count.versions,
      latestVersion: head?.version ?? 0,
      inputCount: head?._count.inputs ?? 0,
      qaCheckCount: head?._count.qaChecks ?? 0,
      referenceCount: head?._count.referenceExamples ?? 0,
      updatedAt: r.updatedAt,
    };
  });
}

export async function getRecipeDetail(
  organizationId: string,
  recipeId: string,
): Promise<RecipeDetail | null> {
  const r = await prisma.recipe.findFirst({
    where: { id: recipeId, organizationId },
    include: {
      templates: {
        select: { id: true, name: true, framework: true },
        orderBy: { createdAt: "desc" },
      },
      versions: {
        orderBy: { version: "desc" },
        include: {
          inputs: { orderBy: { order: "asc" } },
          qaChecks: true,
          referenceExamples: { orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  if (!r || r.versions.length === 0) return null;

  const head = r.versions[0];
  const headDetail: RecipeVersionDetail = {
    id: head.id,
    version: head.version,
    prompt: head.prompt,
    systemPrompt: head.systemPrompt,
    model: head.model,
    changelog: head.changelog,
    createdAt: head.createdAt,
    inputs: head.inputs.map(rowToInput),
    qaChecks: head.qaChecks.map(rowToQa),
    references: head.referenceExamples.map((ref) => ({
      id: ref.id,
      title: ref.title,
      hasOriginal: !!ref.originalStorageKey,
      hasCompleted: !!ref.completedStorageKey,
      hasDiff: !!ref.diffStorageKey,
      promptUsed: ref.promptUsed,
      inputsJson: ref.inputsJson,
      createdAt: ref.createdAt,
    })),
  };

  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    category: r.category,
    isActive: r.isActive,
    createdAt: r.createdAt,
    versions: r.versions.map((v) => ({
      id: v.id,
      version: v.version,
      changelog: v.changelog,
      createdAt: v.createdAt,
    })),
    head: headDetail,
    linkedTemplates: r.templates.map((t) => ({ id: t.id, name: t.name, framework: t.framework })),
  };
}

// ---- writes ----

/** All templates the org owns, offered as linkable reference implementations. */
export async function listTemplatesForOrg(organizationId: string): Promise<TemplateOption[]> {
  const rows = await prisma.template.findMany({
    where: { organizationId },
    select: { id: true, name: true, framework: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((t) => ({ id: t.id, name: t.name, framework: t.framework }));
}

/**
 * Replace the set of reference implementations linked to a recipe. Every id is
 * validated to belong to the same org (keeps links org-consistent), then the
 * recipe's `templates` relation is `set` to exactly that list.
 */
export async function setRecipeTemplates(
  organizationId: string,
  recipeId: string,
  templateIds: string[],
): Promise<void> {
  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, organizationId },
    select: { id: true },
  });
  if (!recipe) throw new Error("Recipe not found.");

  const ids = [...new Set(templateIds)];
  if (ids.length > 0) {
    const owned = await prisma.template.count({
      where: { organizationId, id: { in: ids } },
    });
    if (owned !== ids.length) throw new Error("One or more templates were not found.");
  }

  await prisma.recipe.update({
    where: { id: recipeId },
    data: { templates: { set: ids.map((id) => ({ id })) }, updatedAt: new Date() },
  });
}

/** Find a globally-unique slug derived from `name` (slug column is unique). */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let i = 2;
  // Small internal tool: a short linear probe is fine.
  while (await prisma.recipe.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${i++}`;
  }
  return candidate;
}

export async function createRecipe(
  organizationId: string,
  data: CreateRecipeInput,
): Promise<{ recipeId: string; versionId: string }> {
  const slug = await uniqueSlug(data.name);
  const recipe = await prisma.recipe.create({
    data: {
      organizationId,
      name: data.name,
      description: data.description ?? null,
      category: data.category ?? null,
      slug,
      versions: {
        create: {
          version: 1,
          prompt: data.prompt,
          qaChecks: { create: DEFAULT_QA_CHECKS.map(qaToRow) },
        },
      },
    },
    include: { versions: true },
  });
  return { recipeId: recipe.id, versionId: recipe.versions[0].id };
}

/** Replace the editable content of a version (prompt + inputs + QA checks) in place. */
export async function saveVersionDraft(
  organizationId: string,
  recipeId: string,
  versionId: string,
  draft: VersionDraft,
): Promise<void> {
  const version = await prisma.recipeVersion.findFirst({
    where: { id: versionId, recipeId, recipe: { organizationId } },
    select: { id: true },
  });
  if (!version) throw new Error("Recipe version not found.");

  await prisma.$transaction([
    prisma.recipeInput.deleteMany({ where: { recipeVersionId: versionId } }),
    prisma.recipeQACheck.deleteMany({ where: { recipeVersionId: versionId } }),
    prisma.recipeVersion.update({
      where: { id: versionId },
      data: {
        prompt: draft.prompt,
        systemPrompt: draft.systemPrompt ?? null,
        model: draft.model ?? null,
        changelog: draft.changelog ?? null,
        inputs: { create: draft.inputs.map((d, i) => inputToRow(d, i)) },
        qaChecks: { create: draft.qaChecks.map(qaToRow) },
      },
    }),
    prisma.recipe.update({ where: { id: recipeId }, data: { updatedAt: new Date() } }),
  ]);
}

/**
 * Freeze the current head as an immutable published version (annotated with
 * `changelog`) and open a fresh editable draft copy at version+1. The head is
 * always the working draft; lower version numbers are frozen history.
 */
export async function publishNewVersion(
  organizationId: string,
  recipeId: string,
  changelog?: string,
): Promise<{ publishedVersion: number; draftVersionId: string; draftVersion: number }> {
  const head = await prisma.recipeVersion.findFirst({
    where: { recipeId, recipe: { organizationId } },
    orderBy: { version: "desc" },
    include: { inputs: true, qaChecks: true },
  });
  if (!head) throw new Error("Recipe not found.");

  const [, draft] = await prisma.$transaction([
    // Annotate the version being frozen with its changelog.
    prisma.recipeVersion.update({
      where: { id: head.id },
      data: { changelog: changelog ?? head.changelog },
    }),
    // Continue editing on an identical fresh draft.
    prisma.recipeVersion.create({
      data: {
        recipeId,
        version: head.version + 1,
        prompt: head.prompt,
        systemPrompt: head.systemPrompt,
        model: head.model,
        changelog: null,
        inputs: {
          create: head.inputs.map((i) => ({
            key: i.key,
            label: i.label,
            type: i.type,
            required: i.required,
            optionsJson: i.optionsJson,
            validationJson: i.validationJson,
            order: i.order,
          })),
        },
        qaChecks: {
          create: head.qaChecks.map((c) => ({
            type: c.type,
            required: c.required,
            configJson: c.configJson,
          })),
        },
      },
    }),
    prisma.recipe.update({ where: { id: recipeId }, data: { updatedAt: new Date() } }),
  ]);
  return {
    publishedVersion: head.version,
    draftVersionId: draft.id,
    draftVersion: draft.version,
  };
}

export async function setRecipeActive(
  organizationId: string,
  recipeId: string,
  isActive: boolean,
): Promise<void> {
  await prisma.recipe.updateMany({ where: { id: recipeId, organizationId }, data: { isActive } });
}

/**
 * Build a reference example from two ingested projects (before → after):
 * read both stored archives, compute the unified diff, and persist it. This is
 * the competitive core — completed jobs become few-shot references for the AI.
 */
export async function addReferenceExample(
  organizationId: string,
  args: {
    recipeVersionId: string;
    beforeProjectId: string;
    afterProjectId: string;
    title: string;
    promptUsed?: string;
    inputsJson?: string;
  },
): Promise<{ referenceId: string; filesChanged: number; insertions: number; deletions: number }> {
  const version = await prisma.recipeVersion.findFirst({
    where: { id: args.recipeVersionId, recipe: { organizationId } },
    select: { id: true },
  });
  if (!version) throw new Error("Recipe version not found.");

  const [before, after] = await Promise.all([
    prisma.project.findFirst({
      where: { id: args.beforeProjectId, workspace: { organizationId } },
      select: { storageKey: true },
    }),
    prisma.project.findFirst({
      where: { id: args.afterProjectId, workspace: { organizationId } },
      select: { storageKey: true },
    }),
  ]);
  if (!before?.storageKey || !after?.storageKey) {
    throw new Error("Both projects must have a stored source archive.");
  }

  const storage = getStorageProvider();
  const [beforeBuf, afterBuf] = await Promise.all([
    storage.get(before.storageKey),
    storage.get(after.storageKey),
  ]);
  const diff = computeProjectDiff(
    fileMapFromEntries(extractZip(beforeBuf).files),
    fileMapFromEntries(extractZip(afterBuf).files),
  );

  const ref = await prisma.referenceExample.create({
    data: {
      recipeVersionId: args.recipeVersionId,
      title: args.title,
      originalStorageKey: before.storageKey,
      completedStorageKey: after.storageKey,
      promptUsed: args.promptUsed ?? null,
      inputsJson: args.inputsJson ?? null,
    },
  });
  const diffKey = `references/${ref.id}/diff.patch`;
  await storage.put(diffKey, diff.patch || "(no textual changes)", { contentType: "text/x-diff" });
  await prisma.referenceExample.update({ where: { id: ref.id }, data: { diffStorageKey: diffKey } });

  return {
    referenceId: ref.id,
    filesChanged: diff.filesChanged,
    insertions: diff.insertions,
    deletions: diff.deletions,
  };
}

/** Read a stored reference diff (org-scoped). Returns null if absent. */
export async function getReferenceDiff(
  organizationId: string,
  referenceId: string,
): Promise<{ title: string; patch: string } | null> {
  const ref = await prisma.referenceExample.findFirst({
    where: { id: referenceId, recipeVersion: { recipe: { organizationId } } },
    select: { title: true, diffStorageKey: true },
  });
  if (!ref?.diffStorageKey) return null;
  const buf = await getStorageProvider().get(ref.diffStorageKey);
  return { title: ref.title, patch: buf.toString("utf8") };
}
