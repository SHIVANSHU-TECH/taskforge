"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  addReferenceExample,
  createRecipe,
  publishNewVersion,
  saveVersionDraft,
  setRecipeActive,
  setRecipeTemplates,
} from "@/server/recipes";
import { createRecipeSchema, versionDraftSchema } from "@/server/recipes/schema";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input.";
}

export async function createRecipeAction(input: unknown): Promise<Result<{ recipeId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const parsed = createRecipeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  const { recipeId } = await createRecipe(user.organizationId, parsed.data);
  revalidatePath("/recipes");
  return { ok: true, recipeId };
}

export async function saveDraftAction(
  recipeId: string,
  versionId: string,
  draft: unknown,
): Promise<Result<{ saved: true }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const parsed = versionDraftSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  try {
    await saveVersionDraft(user.organizationId, recipeId, versionId, parsed.data);
    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath(`/recipes/${recipeId}/edit`);
    return { ok: true, saved: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save." };
  }
}

export async function publishVersionAction(
  recipeId: string,
  changelogRaw?: string,
): Promise<Result<{ publishedVersion: number; draftVersion: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const changelog = changelogRaw?.trim() || undefined;
  if (changelog && changelog.length > 2000) {
    return { ok: false, error: "Changelog is too long." };
  }

  try {
    const res = await publishNewVersion(user.organizationId, recipeId, changelog);
    revalidatePath(`/recipes/${recipeId}`);
    revalidatePath(`/recipes/${recipeId}/edit`);
    return { ok: true, publishedVersion: res.publishedVersion, draftVersion: res.draftVersion };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not publish." };
  }
}

export async function toggleActiveAction(
  recipeId: string,
  isActive: boolean,
): Promise<Result<{ isActive: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  await setRecipeActive(user.organizationId, recipeId, isActive);
  revalidatePath("/recipes");
  revalidatePath(`/recipes/${recipeId}`);
  return { ok: true, isActive };
}

const setTemplatesSchema = z.object({
  templateIds: z.array(z.string().min(1)).max(50),
});

export async function setRecipeTemplatesAction(
  recipeId: string,
  input: unknown,
): Promise<Result<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const parsed = setTemplatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };

  try {
    await setRecipeTemplates(user.organizationId, recipeId, parsed.data.templateIds);
    revalidatePath(`/recipes/${recipeId}`);
    return { ok: true, count: parsed.data.templateIds.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update linked templates." };
  }
}

const addReferenceSchema = z.object({
  recipeVersionId: z.string().min(1),
  beforeProjectId: z.string().min(1, "Choose the original project."),
  afterProjectId: z.string().min(1, "Choose the completed project."),
  title: z.string().trim().min(1, "Give this reference a title.").max(160),
  promptUsed: z.string().trim().max(20000).optional(),
});

export async function addReferenceAction(
  recipeId: string,
  input: unknown,
): Promise<Result<{ filesChanged: number; insertions: number; deletions: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const parsed = addReferenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (parsed.data.beforeProjectId === parsed.data.afterProjectId) {
    return { ok: false, error: "Pick two different projects (before and after)." };
  }

  try {
    const res = await addReferenceExample(user.organizationId, parsed.data);
    revalidatePath(`/recipes/${recipeId}`);
    return {
      ok: true,
      filesChanged: res.filesChanged,
      insertions: res.insertions,
      deletions: res.deletions,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not build reference." };
  }
}
