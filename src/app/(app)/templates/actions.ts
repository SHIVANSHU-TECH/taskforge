"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStorageProvider } from "@/server/storage";

type Result = { ok: true } | { ok: false; error: string };

/** Deletes a template (org-scoped) and best-effort removes its stored archive. */
export async function deleteTemplate(templateId: string): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const template = await prisma.template.findFirst({
    where: { id: templateId, organizationId: user.organizationId },
  });
  if (!template) return { ok: false, error: "Template not found." };

  if (template.storageKey) {
    await getStorageProvider()
      .delete(template.storageKey)
      .catch(() => {});
  }
  await prisma.template.delete({ where: { id: template.id } });

  revalidatePath("/templates");
  return { ok: true };
}
