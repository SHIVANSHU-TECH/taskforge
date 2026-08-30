"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route-level error boundary for the app. Keeps the shell; offers a retry. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for local debugging; a real deployment would forward to telemetry.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow text-muted-foreground/70">Error</p>
      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        An unexpected error interrupted this view. You can retry, or head back to the dashboard.
      </p>
      {error.digest && (
        <code className="mt-4 rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          ref: {error.digest}
        </code>
      )}
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
