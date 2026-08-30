"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createRun } from "@/server/runs";
import { drainOnce } from "@/server/queue/db";
import { RUN_JOB_TYPE, runJobHandler } from "@/server/execution";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function createRunAction(input: {
  projectId: string;
  recipeId: string;
  inputs: Record<string, unknown>;
}): Promise<Result<{ runId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  if (!input?.projectId) return { ok: false, error: "Choose a project." };
  if (!input?.recipeId) return { ok: false, error: "Choose a recipe." };

  try {
    const { runId } = await createRun(user.organizationId, {
      projectId: input.projectId,
      recipeId: input.recipeId,
      inputs: input.inputs ?? {},
    });
    revalidatePath("/runs");
    return { ok: true, runId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create run." };
  }
}

/**
 * Dev-only: process pending queue jobs inline so runs advance without a separate
 * worker process. In production the long-running worker drains the queue.
 */
export async function drainQueueAction(): Promise<Result<{ processed: number; failed: number }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  if (process.env.NODE_ENV === "production") {
    return { ok: false, error: "The worker drains the queue in production." };
  }

  const res = await drainOnce({ [RUN_JOB_TYPE]: runJobHandler }, "dev-drainer");
  revalidatePath("/runs");
  return { ok: true, processed: res.processed, failed: res.failed };
}
