import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ingestZipUpload } from "@/server/ingestion";
import { INGEST_LIMITS } from "@/server/ingestion/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Ingestion is expensive; cap to 10 uploads/min per IP.
  const limit = rateLimit(`upload:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const { id: workspaceId } = await params;
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, organizationId: user.organizationId },
  });
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!/\.zip$/i.test(file.name)) {
    return NextResponse.json({ error: "Please upload a .zip file" }, { status: 400 });
  }
  // Reject oversize archives before buffering the whole thing into memory.
  if (file.size > INGEST_LIMITS.maxArchiveBytes) {
    return NextResponse.json(
      {
        error: `Archive is ${(file.size / 1024 / 1024).toFixed(0)} MB, exceeding the ${
          INGEST_LIMITS.maxArchiveBytes / 1024 / 1024
        } MB limit.`,
      },
      { status: 413 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { projectId } = await ingestZipUpload({ workspaceId, filename: file.name, zipBuffer: buffer });
    return NextResponse.json({ projectId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ingestion failed" },
      { status: 400 },
    );
  }
}
