import type { RunStatus } from "./constants";

export type StatusTone = "neutral" | "progress" | "success" | "danger" | "muted";

interface StatusMeta {
  label: string;
  tone: StatusTone;
}

/** Display metadata for each run status. Client-safe (no server imports). */
export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  queued: { label: "Queued", tone: "neutral" },
  analyzing: { label: "Analyzing", tone: "progress" },
  planning: { label: "Planning", tone: "progress" },
  modifying: { label: "Modifying", tone: "progress" },
  validating: { label: "Validating", tone: "progress" },
  repairing: { label: "Repairing", tone: "progress" },
  passed: { label: "Passed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  delivered: { label: "Delivered", tone: "success" },
  canceled: { label: "Canceled", tone: "muted" },
};

/** Statuses where a worker is (or should be) actively progressing the run. */
const ACTIVE_STATUSES = new Set<string>([
  "queued",
  "analyzing",
  "planning",
  "modifying",
  "validating",
  "repairing",
]);

/** True while the run is still expected to change on its own — drives auto-refresh polling. */
export function isRunActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function runStatusMeta(status: string): StatusMeta {
  return RUN_STATUS_META[status as RunStatus] ?? { label: status, tone: "neutral" };
}

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  progress: "border-transparent bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  success: "border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  danger: "border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  muted: "border-transparent bg-muted text-muted-foreground",
};
