import type { QaCheckType, QaStatus } from "./constants";
import type { StatusTone } from "./run-status";

/**
 * Client-safe QA display metadata. Kept in `src/lib` (constants-only imports) so
 * both server pages and client components can render QA results without pulling
 * in the server QA engine (which touches the sandbox / prisma).
 */

export const QA_CHECK_LABELS: Record<QaCheckType, string> = {
  build: "Build",
  typescript: "Type-check",
  lint: "Lint",
  api: "API",
  e2e: "End-to-end",
  visual: "Visual",
  branding: "Branding",
};

interface QaStatusMeta {
  label: string;
  tone: StatusTone;
}

export const QA_STATUS_META: Record<QaStatus, QaStatusMeta> = {
  pass: { label: "Pass", tone: "success" },
  fail: { label: "Fail", tone: "danger" },
  skip: { label: "Skipped", tone: "muted" },
};

export function qaCheckLabel(check: string): string {
  return QA_CHECK_LABELS[check as QaCheckType] ?? check;
}

export function qaStatusMeta(status: string): QaStatusMeta {
  return QA_STATUS_META[status as QaStatus] ?? { label: status, tone: "neutral" };
}
