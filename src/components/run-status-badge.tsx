import { cn } from "@/lib/utils";
import { runStatusMeta, STATUS_TONE_CLASSES } from "@/lib/run-status";

/** Colored pill for a run status. Safe in both server and client components. */
export function RunStatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = runStatusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_TONE_CLASSES[meta.tone],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
