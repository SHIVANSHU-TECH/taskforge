"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteTemplate } from "@/app/(app)/templates/actions";

export function DeleteTemplateButton({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onDelete() {
    setPending(true);
    setError(null);
    const res = await deleteTemplate(templateId);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      setConfirming(false);
      return;
    }
    router.push("/templates");
    router.refresh();
  }

  if (!confirming) {
    return (
      <Button variant="outline" onClick={() => setConfirming(true)} className="shrink-0">
        <Trash2 className="mr-2 h-4 w-4" /> Delete
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onDelete} disabled={pending}>
          {pending ? "Deleting…" : "Confirm delete"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
