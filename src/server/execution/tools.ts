import { z } from "zod";
import type { ToolCall, ToolDef } from "../llm/types";

/**
 * The in-memory project tree the AI edits during a run. Seeded from the
 * ingested source (text files only — binaries/deps are excluded upstream),
 * mutated by tool calls, then diffed against its original state.
 */
export class WorkingTree {
  private files: Map<string, string>;
  private readonly original: Map<string, string>;

  constructor(seed: Map<string, string>) {
    this.original = new Map(seed);
    this.files = new Map(seed);
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  read(path: string): string | undefined {
    return this.files.get(path);
  }

  write(path: string, contents: string): void {
    this.files.set(normalize(path), contents);
  }

  remove(path: string): boolean {
    return this.files.delete(normalize(path));
  }

  /** Literal (or regex) project-wide replace. Returns files touched + total hits. */
  replaceInFiles(find: string, replace: string, isRegex = false): { files: number; occurrences: number } {
    if (!find) return { files: 0, occurrences: 0 };
    let re: RegExp;
    try {
      re = isRegex ? new RegExp(find, "g") : new RegExp(escapeRegExp(find), "g");
    } catch {
      return { files: 0, occurrences: 0 };
    }
    let files = 0;
    let occurrences = 0;
    for (const [path, contents] of this.files) {
      const matches = contents.match(re);
      if (!matches || matches.length === 0) continue;
      files++;
      occurrences += matches.length;
      this.files.set(path, contents.replace(re, replace));
    }
    return { files, occurrences };
  }

  snapshot(): Map<string, string> {
    return new Map(this.files);
  }

  originalSnapshot(): Map<string, string> {
    return new Map(this.original);
  }
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- Tool definitions exposed to the model during the modify phase ----

export const MODIFY_TOOLS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read the full current contents of a text file in the project by its relative path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Project-relative file path." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing one with the given contents. Provide the COMPLETE new file contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative file path." },
        contents: { type: "string", description: "The complete new contents of the file." },
      },
      required: ["path", "contents"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file from the project.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "replace_in_files",
    description:
      "Replace every occurrence of a string across ALL text files in the project. Ideal for renames/rebrands. Literal by default; set isRegex to use a JavaScript regular expression.",
    parameters: {
      type: "object",
      properties: {
        find: { type: "string", description: "The exact text (or regex) to find." },
        replace: { type: "string", description: "The replacement text." },
        isRegex: { type: "boolean", description: "Treat `find` as a regular expression.", default: false },
      },
      required: ["find", "replace"],
    },
  },
  {
    name: "finish",
    description: "Call this when all required changes are complete. Provide a concise summary of what changed.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string", description: "Summary of the changes made." } },
      required: ["summary"],
    },
  },
];

// ---- Tool execution ----

const readArgs = z.object({ path: z.string().min(1) });
const writeArgs = z.object({ path: z.string().min(1), contents: z.string() });
const deleteArgs = z.object({ path: z.string().min(1) });
const replaceArgs = z.object({ find: z.string().min(1), replace: z.string(), isRegex: z.boolean().optional() });
const finishArgs = z.object({ summary: z.string().optional() });

export interface ToolExecution {
  result: string;
  finished: boolean;
  finishSummary?: string;
}

const MAX_READ_CHARS = 24_000;

/** Apply one tool call to the working tree and return a result string for the model. */
export function executeToolCall(tree: WorkingTree, call: ToolCall): ToolExecution {
  switch (call.name) {
    case "read_file": {
      const p = readArgs.safeParse(call.arguments);
      if (!p.success) return err("read_file: invalid arguments; expected { path }.");
      const contents = tree.read(p.data.path);
      if (contents === undefined) return err(`read_file: "${p.data.path}" not found.`);
      const clipped =
        contents.length > MAX_READ_CHARS
          ? contents.slice(0, MAX_READ_CHARS) + `\n… [truncated ${contents.length - MAX_READ_CHARS} chars]`
          : contents;
      return ok(clipped);
    }
    case "write_file": {
      const p = writeArgs.safeParse(call.arguments);
      if (!p.success) return err("write_file: invalid arguments; expected { path, contents }.");
      const existed = tree.has(p.data.path);
      tree.write(p.data.path, p.data.contents);
      return ok(`${existed ? "Updated" : "Created"} ${p.data.path} (${p.data.contents.length} chars).`);
    }
    case "delete_file": {
      const p = deleteArgs.safeParse(call.arguments);
      if (!p.success) return err("delete_file: invalid arguments; expected { path }.");
      const removed = tree.remove(p.data.path);
      return ok(removed ? `Deleted ${p.data.path}.` : `delete_file: "${p.data.path}" not found (no-op).`);
    }
    case "replace_in_files": {
      const p = replaceArgs.safeParse(call.arguments);
      if (!p.success) return err("replace_in_files: invalid arguments; expected { find, replace }.");
      const res = tree.replaceInFiles(p.data.find, p.data.replace, p.data.isRegex ?? false);
      return ok(`Replaced ${res.occurrences} occurrence(s) across ${res.files} file(s).`);
    }
    case "finish": {
      const p = finishArgs.safeParse(call.arguments);
      const summary = p.success ? p.data.summary : undefined;
      return { result: "Run complete.", finished: true, finishSummary: summary };
    }
    default:
      return err(`Unknown tool "${call.name}".`);
  }
}

function ok(result: string): ToolExecution {
  return { result, finished: false };
}

function err(result: string): ToolExecution {
  return { result: `ERROR: ${result}`, finished: false };
}
