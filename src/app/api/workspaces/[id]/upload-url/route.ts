import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStorageProvider } from "@/server/storage";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/[id]/upload-url
 *
 * Returns a short-lived presigned S3 PUT URL so the client can upload a ZIP
 * directly to object storage, bypassing Vercel's 4.5 MB body limit.
 *
 * Query params:
 *   filename  – original filename (used to derive the storage key)
 *   size      – file size in bytes (checked against the 100 MB cap)
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const limit = rateLimit(`upload-url:${clientIp(req)}`, 20, 60_000);
    if (!limit.ok) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const { id: workspaceId } = await params;
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId, organizationId: user.organizationId },
    });
    if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

    const url = new URL(req.url);
    const filename = url.searchParams.get("filename") ?? "upload.zip";
    const size = Number(url.searchParams.get("size") ?? "0");

    if (!/\.zip$/i.test(filename)) {
      return NextResponse.json({ error: "Only .zip files are accepted." }, { status: 400 });
    }

    const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
    if (size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is ${(size / 1024 / 1024).toFixed(0)} MB, exceeding the 100 MB limit.` },
        { status: 413 },
      );
    }

    let storage;
    try {
      storage = getStorageProvider();
    } catch (e) {
      // Storage misconfigured — surface the real message so it's visible in
      // Vercel function logs and the response body.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload-url] storage init failed:", msg);
      return NextResponse.json(
        { error: `Storage configuration error: ${msg}` },
        { status: 500 },
      );
    }

    // Local storage provider doesn't support presigned URLs — fall back to the
    // regular upload endpoint so dev still works.
    if (!storage.presignedPutUrl) {
      return NextResponse.json({ fallback: true });
    }

    const token = randomBytes(16).toString("hex");
    const key = `uploads/pending/${workspaceId}/${token}/${filename}`;

    let uploadUrl: string;
    try {
      uploadUrl = await storage.presignedPutUrl(key, {
        contentType: "application/zip",
        expiresIn: 3600,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload-url] presign failed:", msg);
      return NextResponse.json(
        { error: `Failed to generate upload URL: ${msg}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ uploadUrl, key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-url] unexpected error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
