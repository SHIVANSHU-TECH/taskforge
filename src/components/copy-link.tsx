"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Read-only URL field with a copy-to-clipboard button (client delivery link). */
export function CopyLink({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the field is still selectable */
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={copy} className="shrink-0 gap-1.5">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
