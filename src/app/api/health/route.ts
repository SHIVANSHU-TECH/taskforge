import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe. Unauthenticated by design (no sensitive data) — it
 * reports process health and a cheap DB round-trip so orchestrators can gate
 * traffic. Returns 503 when the database is unreachable.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "ok",
      latencyMs: Date.now() - startedAt,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "unreachable", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
