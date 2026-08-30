"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { addReferenceAction } from "@/app/(app)/recipes/actions";

interface ProjectOption {
  id: string;
  name: string;
  workspaceName: string;
}

export function AddReferenceForm({
  recipeId,
  recipeVersionId,
  projects,
}: {
  recipeId: string;
  recipeVersionId: string;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [beforeProjectId, setBefore] = React.useState("");
  const [afterProjectId, setAfter] = React.useState("");
  const [promptUsed, setPromptUsed] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (projects.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Ingest at least two projects — an original and its completed version — in Workspaces, then
        pair them here to teach the AI by example.
      </p>
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await addReferenceAction(recipeId, {
        recipeVersionId,
        beforeProjectId,
        afterProjectId,
        title,
        promptUsed: promptUsed || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOk(
        `Reference built: ${res.filesChanged} file${res.filesChanged === 1 ? "" : "s"} changed, ` +
          `+${res.insertions} / -${res.deletions}.`,
      );
      setTitle("");
      setBefore("");
      setAfter("");
      setPromptUsed("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ref-title">Title</Label>
        <Input
          id="ref-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Acme rebrand — blue → green"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ref-before">Original (before)</Label>
          <Select id="ref-before" value={beforeProjectId} onChange={(e) => setBefore(e.target.value)}>
            <option value="" disabled>
              Choose a project…
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.workspaceName}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref-after">Completed (after)</Label>
          <Select id="ref-after" value={afterProjectId} onChange={(e) => setAfter(e.target.value)}>
            <option value="" disabled>
              Choose a project…
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.workspaceName}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <details className="rounded-md border bg-background">
        <summary className="cursor-pointer px-3 py-2 text-sm">Prompt used (optional)</summary>
        <div className="border-t p-3">
          <Textarea
            value={promptUsed}
            onChange={(e) => setPromptUsed(e.target.value)}
            className="min-h-20 font-mono text-[13px]"
            placeholder="The exact prompt/inputs that produced this result, if you have them."
          />
        </div>
      </details>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {ok && <p className="text-sm text-emerald-600 dark:text-emerald-400">{ok}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Building diff…" : "Add reference"}
      </Button>
      <p className="text-xs text-muted-foreground">
        We compute the diff between the two projects and store it as a few-shot example for the AI
        engine.
      </p>
    </form>
  );
}
