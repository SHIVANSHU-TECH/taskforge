import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ingestFromStorageKey } from "@/server/ingestion";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
});

/**
 * POST /api/workspaces/[id]/ingest
 *
 * Called after the client has uploaded a ZIP directly to S3 via a presigned
 * URL. Receives the storage key, downloads the ZIP server-side, and runs the
 * normal ingestion pipeline (extract → analyze → persist).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limit = rateLimit(`ingest:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id: workspaceId } = await params;
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, organizationId: user.organizationId },
  });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing key or filename" }, { status: 400 });
  }

  try {
    const { projectId } = await ingestFromStorageKey({
      workspaceId,
      storageKey: parsed.data.key,
      filename: parsed.data.filename,
    });
    return NextResponse.json({ projectId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ingestion failed" },
      { status: 400 },
    );
  }
}
