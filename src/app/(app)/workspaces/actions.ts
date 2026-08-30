"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ingestGithubRepo } from "@/server/ingestion";
import { rateLimit } from "@/lib/rate-limit";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const nameSchema = z.string().trim().min(1, "Name is required").max(80, "Name is too long");

/** Verify a workspace exists and belongs to the current user's org. */
async function ownedWorkspace(workspaceId: string, organizationId: string) {
  return prisma.workspace.findFirst({ where: { id: workspaceId, organizationId } });
}

export async function createWorkspace(nameRaw: string): Promise<Result<{ workspaceId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const parsed = nameSchema.safeParse(nameRaw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const ws = await prisma.workspace.create({
    data: { name: parsed.data, organizationId: user.organizationId },
  });
  revalidatePath("/workspaces");
  return { ok: true, workspaceId: ws.id };
}

export async function importGithub(
  workspaceId: string,
  urlRaw: string,
): Promise<Result<{ projectId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const url = urlRaw?.trim();
  if (!url) return { ok: false, error: "Enter a GitHub URL or owner/repo." };

  // Remote fetch + extraction is expensive; throttle to 10/min per user.
  const limit = rateLimit(`import:${user.id}`, 10, 60_000);
  if (!limit.ok) {
    return { ok: false, error: "Too many imports. Please try again shortly." };
  }

  const ws = await ownedWorkspace(workspaceId, user.organizationId);
  if (!ws) return { ok: false, error: "Workspace not found." };

  try {
    const { projectId } = await ingestGithubRepo({ workspaceId, url });
    revalidatePath(`/workspaces/${workspaceId}`);
    return { ok: true, projectId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Import failed." };
  }
}
