"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importGithub } from "@/app/(app)/workspaces/actions";

export function ImportGithubForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await importGithub(workspaceId, url);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/workspaces/${workspaceId}/projects/${res.projectId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Input
        placeholder="github.com/owner/repo  or  owner/repo"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="GitHub repository URL"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Importing…" : "Import repository"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Public repos work out of the box. Set <code>GITHUB_TOKEN</code> for private repos.
      </p>
    </form>
  );
}
