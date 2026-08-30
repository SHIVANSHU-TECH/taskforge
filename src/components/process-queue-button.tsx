"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { drainQueueAction } from "@/app/(app)/runs/actions";

/**
 * Dev-only helper: processes pending queue jobs inline (the AI pipeline) without
 * a separate worker process, then refreshes. Hidden in production builds.
 */
export function ProcessQueueButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  function onClick() {
    setMsg(null);
    startTransition(async () => {
      const res = await drainQueueAction();
      if (!res.ok) {
        setMsg(res.error);
        return;
      }
      setMsg(
        res.processed === 0 && res.failed === 0
          ? "Queue empty."
          : `Processed ${res.processed}${res.failed ? `, ${res.failed} failed` : ""}.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={onClick} disabled={pending}>
        {pending ? "Processing…" : "Process queue"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
