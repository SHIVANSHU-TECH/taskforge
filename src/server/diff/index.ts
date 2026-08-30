/**
 * Line-based unified diff engine (pure, no deps).
 *
 * Used by the recipe reference library (original → completed) and, later, to
 * summarize the changes an AI run produces. Operates on maps of text files
 * (path → contents); binary/non-text files are not passed in.
 */

export type DiffFileStatus = "added" | "modified" | "deleted";

export interface DiffFile {
  path: string;
  status: DiffFileStatus;
  insertions: number;
  deletions: number;
  patch: string;
  truncated?: boolean;
}

export interface ProjectDiff {
  files: DiffFile[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  /** Concatenated git-style unified patch across all files. */
  patch: string;
}

/** Per-file line cap; beyond this we emit a labeled placeholder instead of an O(n·m) diff. */
const MAX_DIFF_LINES = 2000;
const CONTEXT = 3;

type Tag = "eq" | "del" | "ins";
interface Op {
  tag: Tag;
  line: string;
  o?: number; // 1-based line number on the "old" side
  n?: number; // 1-based line number on the "new" side
}

/** Split into lines, normalizing CRLF and ignoring a single trailing newline. */
function toLines(text: string): string[] {
  const norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = norm.endsWith("\n") ? norm.slice(0, -1) : norm;
  return body.length === 0 ? [] : body.split("\n");
}

/** Longest-common-subsequence line diff via a flat Int32 DP table. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + (j + 1)] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  let o = 1;
  let nn = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ tag: "eq", line: a[i], o: o++, n: nn++ });
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) {
      ops.push({ tag: "del", line: a[i], o: o++ });
      i++;
    } else {
      ops.push({ tag: "ins", line: b[j], n: nn++ });
      j++;
    }
  }
  while (i < n) ops.push({ tag: "del", line: a[i++], o: o++ });
  while (j < m) ops.push({ tag: "ins", line: b[j++], n: nn++ });
  return ops;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function buildHunks(ops: Op[]): Hunk[] {
  const changed: number[] = [];
  for (let k = 0; k < ops.length; k++) if (ops[k].tag !== "eq") changed.push(k);
  if (changed.length === 0) return [];

  // Group nearby changes so a run of edits shares one hunk with its context.
  const groups: Array<[number, number]> = [];
  let gs = changed[0];
  let ge = changed[0];
  for (let x = 1; x < changed.length; x++) {
    if (changed[x] - ge <= CONTEXT * 2 + 1) ge = changed[x];
    else {
      groups.push([gs, ge]);
      gs = changed[x];
      ge = changed[x];
    }
  }
  groups.push([gs, ge]);

  const hunks: Hunk[] = [];
  for (const [s, e] of groups) {
    const from = Math.max(0, s - CONTEXT);
    const to = Math.min(ops.length - 1, e + CONTEXT);
    const slice = ops.slice(from, to + 1);

    let oldStart = 0;
    let newStart = 0;
    let oldLines = 0;
    let newLines = 0;
    const lines: string[] = [];
    for (const op of slice) {
      if (op.tag === "eq") {
        if (!oldStart && op.o) oldStart = op.o;
        if (!newStart && op.n) newStart = op.n;
        oldLines++;
        newLines++;
        lines.push(` ${op.line}`);
      } else if (op.tag === "del") {
        if (!oldStart && op.o) oldStart = op.o;
        oldLines++;
        lines.push(`-${op.line}`);
      } else {
        if (!newStart && op.n) newStart = op.n;
        newLines++;
        lines.push(`+${op.line}`);
      }
    }
    hunks.push({
      oldStart: oldLines === 0 ? 0 : oldStart || 1,
      oldLines,
      newStart: newLines === 0 ? 0 : newStart || 1,
      newLines,
      lines,
    });
  }
  return hunks;
}

function fileHeader(path: string, status: DiffFileStatus): string {
  const a = status === "added" ? "/dev/null" : `a/${path}`;
  const b = status === "deleted" ? "/dev/null" : `b/${path}`;
  const meta =
    status === "added"
      ? "new file mode 100644\n"
      : status === "deleted"
        ? "deleted file mode 100644\n"
        : "";
  return `diff --git a/${path} b/${path}\n${meta}--- ${a}\n+++ ${b}\n`;
}

function renderPatch(path: string, status: DiffFileStatus, hunks: Hunk[]): string {
  let out = fileHeader(path, status);
  for (const h of hunks) {
    out += `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n`;
    out += h.lines.map((l) => `${l}\n`).join("");
  }
  return out;
}

/** Diff a single file's before/after text. Returns null when unchanged. */
export function diffFile(path: string, before: string | undefined, after: string | undefined): DiffFile | null {
  if (before === undefined && after === undefined) return null;
  if (before !== undefined && after !== undefined && before === after) return null;

  const status: DiffFileStatus =
    before === undefined ? "added" : after === undefined ? "deleted" : "modified";

  const beforeLines = before === undefined ? [] : toLines(before);
  const afterLines = after === undefined ? [] : toLines(after);

  if (beforeLines.length > MAX_DIFF_LINES || afterLines.length > MAX_DIFF_LINES) {
    return {
      path,
      status,
      insertions: 0,
      deletions: 0,
      truncated: true,
      patch: `${fileHeader(path, status)}@@ file too large to diff (${Math.max(beforeLines.length, afterLines.length)} lines) @@\n`,
    };
  }

  const ops = diffLines(beforeLines, afterLines);
  const hunks = buildHunks(ops);
  const insertions = ops.reduce((c, op) => c + (op.tag === "ins" ? 1 : 0), 0);
  const deletions = ops.reduce((c, op) => c + (op.tag === "del" ? 1 : 0), 0);
  return { path, status, insertions, deletions, patch: renderPatch(path, status, hunks) };
}

/**
 * Diff two project file maps (path → text). Paths present only in `after` are
 * additions; only in `before` are deletions; in both with differing content are
 * modifications. Identical files are omitted.
 */
export function computeProjectDiff(
  before: Map<string, string>,
  after: Map<string, string>,
): ProjectDiff {
  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  const files: DiffFile[] = [];
  for (const p of [...paths].sort()) {
    const df = diffFile(p, before.get(p), after.get(p));
    if (df) files.push(df);
  }
  const insertions = files.reduce((c, f) => c + f.insertions, 0);
  const deletions = files.reduce((c, f) => c + f.deletions, 0);
  return {
    files,
    filesChanged: files.length,
    insertions,
    deletions,
    patch: files.map((f) => f.patch).join(""),
  };
}

/** Build a path→text map from extracted files (skips entries without text). */
export function fileMapFromEntries(entries: Array<{ path: string; text?: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) if (typeof e.text === "string") map.set(e.path, e.text);
  return map;
}
