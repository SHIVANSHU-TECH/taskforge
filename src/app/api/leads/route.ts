import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { leadInputSchema } from "@/lib/leads";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anonymous, public endpoint — throttle abuse: 5 submissions per minute per IP.
const LEAD_LIMIT = 5;
const LEAD_WINDOW_MS = 60_000;

/** One-way hash of the client IP (salted) so we can triage abuse without storing PII. */
function hashIp(ip: string): string {
  const salt = process.env.AUTH_SECRET ?? "taskforge-leads";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/**
 * Capture a sales lead from the public product landing page. No auth by design.
 * Validates with the shared zod schema, rate-limits per IP, and persists to the
 * `Lead` table for the sales team to follow up. Never stores the raw IP.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = rateLimit(`lead:${ip}`, LEAD_LIMIT, LEAD_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, message: "Too many submissions. Please try again in a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }

  const parsed = leadInputSchema.safeParse(json);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json(
      { ok: false, message: "Please check the highlighted fields.", fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;
  try {
    const lead = await prisma.lead.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        company: data.company || null,
        message: data.message || null,
        product: data.product || null,
        plan: data.plan || null,
        source: data.source || "product-landing-page",
        userAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
        ipHash: hashIp(ip),
      },
      select: { id: true },
    });
    return NextResponse.json(
      {
        ok: true,
        id: lead.id,
        message:
          "Thank you for your interest! Our team has received your details and will get in touch with you shortly.",
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: "Something went wrong while submitting your details. Please try again." },
      { status: 500 },
    );
  }
}
