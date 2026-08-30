"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWorkspace } from "@/app/(app)/workspaces/actions";

export function NewWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createWorkspace(name);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      router.push(`/workspaces/${res.workspaceId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex items-start gap-2">
      <div className="flex-1">
        <Input
          placeholder="New workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New workspace name"
        />
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </Button>
    </form>
  );
}
