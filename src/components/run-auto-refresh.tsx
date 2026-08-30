"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Polls `router.refresh()` on an interval while the run is still active, so the
 * step timeline and status update live without a manual reload. Stops once the
 * run reaches a terminal/paused state. Renders nothing.
 */
export function RunAutoRefresh({ active, intervalMs = 2000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();

  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);

  return null;
}
