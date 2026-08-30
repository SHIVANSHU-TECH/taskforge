import { NextResponse } from "next/server";
import { resolveDeliveryFile, type DeliveryFileKind } from "@/server/delivery";

export const runtime = "nodejs";

const KINDS: DeliveryFileKind[] = ["bundle", "qa-report", "changelog"];

/**
 * Public, token-gated download of a delivery artifact. The token is the only
 * credential; `file` is validated against a fixed allow-list, and the storage
 * key is resolved server-side from the DeliveryArtifact row — never from the
 * request — so a token holder can only fetch that run's three artifacts.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const file = new URL(req.url).searchParams.get("file");
  if (!file || !KINDS.includes(file as DeliveryFileKind)) {
    return NextResponse.json({ error: "Unknown file" }, { status: 400 });
  }

  const res = await resolveDeliveryFile(token, file as DeliveryFileKind);
  if (!res.ok) {
    const status = res.error === "expired" ? 410 : 404;
    return NextResponse.json({ error: res.error }, { status });
  }

  return new NextResponse(new Uint8Array(res.buffer), {
    status: 200,
    headers: {
      "Content-Type": res.contentType,
      "Content-Disposition": `attachment; filename="${res.filename}"`,
      "Content-Length": String(res.buffer.length),
      "Cache-Control": "private, no-store",
    },
  });
}
