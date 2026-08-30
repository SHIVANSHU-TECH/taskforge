"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function UploadZipForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .zip file first.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/workspaces/${workspaceId}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as { projectId?: string; error?: string };
      if (!res.ok || !data.projectId) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      router.push(`/workspaces/${workspaceId}/projects/${data.projectId}`);
      router.refresh();
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        aria-label="Project ZIP file"
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={uploading || !file}>
        {uploading ? "Uploading & analyzing…" : "Upload & analyze"}
      </Button>
    </form>
  );
}
