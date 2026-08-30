import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ingestTemplate } from "@/server/templates";
import { INGEST_LIMITS } from "@/server/ingestion/types";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const NAME_MAX = 80;
const PROMPT_MAX = 5_000;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Extraction + analysis is expensive; cap to 10 uploads/min per IP.
  const limit = rateLimit(`template-upload:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many uploads. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

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

  const prompt = String(form.get("prompt") ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Add a note on what to take from this template." }, { status: 400 });
  }
  if (prompt.length > PROMPT_MAX) {
    return NextResponse.json({ error: "Note is too long." }, { status: 400 });
  }

  const nameRaw = String(form.get("name") ?? "").trim();
  const name = (nameRaw || file.name.replace(/\.zip$/i, "")).slice(0, NAME_MAX) || "Template";

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { templateId } = await ingestTemplate({
      organizationId: user.organizationId,
      name,
      prompt,
      filename: file.name,
      zipBuffer: buffer,
    });
    return NextResponse.json({ templateId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ingestion failed" },
      { status: 400 },
    );
  }
}
