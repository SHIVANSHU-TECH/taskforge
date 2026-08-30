import path from "node:path";
import AdmZip from "adm-zip";
import { INGEST_LIMITS, IGNORED_DIRS, type ExtractedFile, type ExtractedProject } from "./types";

/** Extensions we treat as inspectable text (for env-var scanning + package.json parse). */
const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".json", ".jsonc", ".yml", ".yaml", ".toml", ".xml", ".ini",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".vue", ".svelte", ".astro", ".md", ".mdx", ".txt",
  ".sh", ".bash", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".php",
  ".graphql", ".gql", ".prisma", ".sql",
]);

/** Filenames (no extension, or dotfiles) that are still inspectable text. */
const TEXT_FILENAMES = new Set([
  ".env", ".env.example", ".env.sample", ".env.local", ".env.template", ".env.defaults",
  ".gitignore", ".npmrc", ".nvmrc", "dockerfile", "makefile", "procfile", ".dockerignore",
]);

function isInspectableText(relPath: string, size: number): boolean {
  if (size > INGEST_LIMITS.maxInspectBytes) return false;
  const base = relPath.slice(relPath.lastIndexOf("/") + 1).toLowerCase();
  if (TEXT_FILENAMES.has(base)) return true;
  if (base.startsWith(".env")) return true;
  return TEXT_EXTENSIONS.has(path.posix.extname(base));
}

/** Normalizes an archive entry path and rejects anything that escapes the root. */
function safeRelPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/");
  if (p.includes("\0")) return null;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null; // absolute / drive-letter
  const norm = path.posix.normalize(p).replace(/^\.\//, "");
  if (norm === ".." || norm.startsWith("../") || norm.startsWith("/")) return null;
  return norm;
}

function firstSegment(p: string): string {
  const i = p.indexOf("/");
  return i === -1 ? p : p.slice(0, i);
}

function inIgnoredDir(relPath: string): boolean {
  return relPath.split("/").some((seg) => IGNORED_DIRS.has(seg));
}

/**
 * Extracts and validates a ZIP archive into an in-memory file list.
 * Enforces INGEST_LIMITS and strips a single common wrapper directory
 * (as produced by GitHub archive downloads, e.g. `repo-main/`).
 *
 * Never executes archive contents — it only reads bytes.
 */
export function extractZip(buffer: Buffer): ExtractedProject {
  if (buffer.byteLength > INGEST_LIMITS.maxArchiveBytes) {
    throw new Error(
      `Archive is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB, exceeding the ` +
        `${INGEST_LIMITS.maxArchiveBytes / 1024 / 1024} MB limit.`,
    );
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("Could not read the archive. Is it a valid .zip file?");
  }

  const entries = zip.getEntries();
  const raw: ExtractedFile[] = [];
  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const rel = safeRelPath(entry.entryName);
    if (rel === null) {
      throw new Error(`Unsafe path in archive: "${entry.entryName}"`);
    }

    // Skip symlinks (unix mode S_IFLNK) — we never follow links out of the tree.
    const mode = (entry.header.attr ?? 0) >>> 16;
    if ((mode & 0xf000) === 0xa000) continue;

    const size = entry.header.size;
    totalBytes += size;
    if (totalBytes > INGEST_LIMITS.maxUncompressedBytes) {
      throw new Error("Archive is too large once uncompressed (possible zip bomb).");
    }

    const file: ExtractedFile = { path: rel, size };
    if (isInspectableText(rel, size)) {
      try {
        file.text = entry.getData().toString("utf8");
      } catch {
        /* unreadable entry — keep the metadata, drop the text */
      }
    }
    raw.push(file);

    if (raw.length > INGEST_LIMITS.maxFiles) {
      throw new Error(`Archive has more than ${INGEST_LIMITS.maxFiles} files.`);
    }
  }

  if (raw.length === 0) {
    throw new Error("Archive contains no files.");
  }

  // Strip a single common wrapper directory if every entry shares it.
  let strippedRoot: string | null = null;
  const firstSegs = new Set(raw.map((f) => firstSegment(f.path)));
  if (firstSegs.size === 1) {
    const seg = [...firstSegs][0];
    // Only strip if it's genuinely a directory prefix (paths like "seg/...").
    if (raw.every((f) => f.path.startsWith(seg + "/"))) {
      strippedRoot = seg;
      for (const f of raw) f.path = f.path.slice(seg.length + 1);
    }
  }

  // Drop noise dirs from the analyzed set (but they were still counted above).
  const files = raw.filter((f) => !inIgnoredDir(f.path));

  return {
    files,
    fileCount: files.length,
    sizeBytes: files.reduce((n, f) => n + f.size, 0),
    strippedRoot,
  };
}
