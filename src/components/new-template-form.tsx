"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function NewTemplateForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .zip file first.");
      return;
    }
    if (!prompt.trim()) {
      setError("Add a note on what to take from this template.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      fd.append("prompt", prompt.trim());
      const res = await fetch("/api/templates/upload", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { templateId?: string; error?: string };
      if (!res.ok || !data.templateId) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      router.push(`/templates/${data.templateId}`);
      router.refresh();
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="tpl-name" className="text-sm font-medium">
          Name
        </label>
        <Input
          id="tpl-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Stripe checkout integration"
          maxLength={80}
        />
        <p className="text-xs text-muted-foreground">Optional — defaults to the file name.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="tpl-prompt" className="text-sm font-medium">
          What to take from it
        </label>
        <Textarea
          id="tpl-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what to copy or reuse — e.g. how Stripe checkout is wired up: the webhook handler, the pricing table component, and the env vars it expects."
          rows={5}
          maxLength={5000}
        />
        <p className="text-xs text-muted-foreground">
          This note guides what a run should borrow from the reference.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="tpl-file" className="text-sm font-medium">
          Reference ZIP
        </label>
        <input
          id="tpl-file"
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label="Template ZIP file"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={uploading || !file}>
        {uploading ? "Uploading & analyzing…" : "Add template"}
      </Button>
    </form>
  );
}
