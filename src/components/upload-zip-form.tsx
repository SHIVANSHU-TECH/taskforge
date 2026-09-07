"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function UploadZipForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a .zip file first.");
      return;
    }
    setError(null);
    setUploading(true);

    try {
      // Step 1: request a presigned URL (or fallback flag for local dev).
      setProgress("Preparing upload…");
      const urlRes = await fetch(
        `/api/workspaces/${workspaceId}/upload-url?filename=${encodeURIComponent(file.name)}&size=${file.size}`,
      );
      const urlData = (await urlRes.json().catch(() => ({}))) as {
        uploadUrl?: string;
        key?: string;
        fallback?: boolean;
        error?: string;
      };

      if (!urlRes.ok) {
        setError(urlData.error ?? "Failed to prepare upload.");
        return;
      }

      let projectId: string | undefined;

      if (urlData.fallback) {
        // Local dev: no presigned URL support — POST the file directly (old path).
        setProgress("Uploading…");
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/workspaces/${workspaceId}/upload`, {
          method: "POST",
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as {
          projectId?: string;
          error?: string;
        };
        if (!res.ok || !data.projectId) {
          setError(data.error ?? "Upload failed.");
          return;
        }
        projectId = data.projectId;
      } else {
        // Production: PUT directly to S3 — bypasses Vercel body limit entirely.
        setProgress("Uploading to storage…");
        const putRes = await fetch(urlData.uploadUrl!, {
          method: "PUT",
          headers: { "Content-Type": "application/zip" },
          body: file,
        });
        if (!putRes.ok) {
          setError("Failed to upload file to storage. Please try again.");
          return;
        }

        // Step 3: tell the server to ingest from the storage key.
        setProgress("Analyzing project…");
        const ingestRes = await fetch(`/api/workspaces/${workspaceId}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: urlData.key, filename: file.name }),
        });
        const ingestData = (await ingestRes.json().catch(() => ({}))) as {
          projectId?: string;
          error?: string;
        };
        if (!ingestRes.ok || !ingestData.projectId) {
          setError(ingestData.error ?? "Ingestion failed.");
          return;
        }
        projectId = ingestData.projectId;
      }

      router.push(`/workspaces/${workspaceId}/projects/${projectId}`);
      router.refresh();
    } catch {
      setError("Network error during upload.");
    } finally {
      setUploading(false);
      setProgress(null);
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
      {uploading && progress && <p className="text-sm text-muted-foreground">{progress}</p>}
      <Button type="submit" disabled={uploading || !file}>
        {uploading ? (progress ?? "Uploading…") : "Upload & analyze"}
      </Button>
    </form>
  );
}
