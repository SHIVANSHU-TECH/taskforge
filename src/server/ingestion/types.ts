/** Types and safety limits for project ingestion (ZIP upload + GitHub import). */

/** A single file extracted from an uploaded/downloaded archive. */
export interface ExtractedFile {
  /** Project-relative POSIX path, with any common top-level wrapper dir stripped. */
  path: string;
  size: number;
  /** Present only for text files small enough to inspect (see MAX_INSPECT_BYTES). */
  text?: string;
}

export interface ExtractedProject {
  files: ExtractedFile[];
  fileCount: number;
  sizeBytes: number;
  /** The wrapper directory that was stripped (e.g. "repo-main/"), or null. */
  strippedRoot: string | null;
}

/** A node in the display file tree. `children` is undefined for files. */
export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  children?: FileTreeNode[];
  /** Set when a directory's children were capped for display. */
  truncated?: boolean;
}

/** Result of analyzing an extracted project. Persisted to ProjectAnalysis. */
export interface AnalyzerResult {
  framework: string | null;
  packageManager: string | null;
  nodeVersion: string | null;
  scripts: Record<string, string>;
  dependencies: string[];
  entryPoints: string[];
  /** Environment variable NAMES only — values are never read or stored. */
  envVars: string[];
  fileCount: number;
  sizeBytes: number;
  fileTree: FileTreeNode;
}

/** Guards against zip-bombs and pathological archives. */
export const INGEST_LIMITS = {
  /** Max size of the archive we accept for upload. */
  maxArchiveBytes: 100 * 1024 * 1024, // 100 MB
  /** Max total uncompressed size across all entries. */
  maxUncompressedBytes: 400 * 1024 * 1024, // 400 MB
  /** Max number of entries. */
  maxFiles: 20_000,
  /** Only files at/under this size have their text inspected (for env scanning). */
  maxInspectBytes: 512 * 1024, // 512 KB
} as const;

/** Directories that never contain project source we care about analyzing. */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  ".vercel",
  ".output",
]);
