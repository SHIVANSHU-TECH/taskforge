import { INPUTS_BLOCK_CLOSE, INPUTS_BLOCK_OPEN } from "../llm/scripted";

export interface ContextInput {
  key: string;
  label: string;
  type: string;
  value: string;
}

export interface ContextReference {
  title: string;
  patch: string;
}

/** A curated reference implementation: a whole reference project + a note on what to copy from it. */
export interface ContextTemplate {
  name: string;
  /** The author's "what to take from it" note. */
  prompt: string;
  files: Map<string, string>;
}

export interface ContextAnalysis {
  framework: string | null;
  packageManager: string | null;
  scripts: Record<string, string>;
}

export interface AssembleArgs {
  prompt: string;
  systemPrompt?: string | null;
  inputs: ContextInput[];
  files: Map<string, string>;
  analysis?: ContextAnalysis | null;
  references: ContextReference[];
  templates?: ContextTemplate[];
}

export interface RunContextParts {
  system: string;
  task: string;
}

// Budgets — keep the request bounded regardless of project size.
const MAX_INLINE_CHARS = 48_000;
const MAX_SINGLE_FILE_CHARS = 12_000;
const MAX_MANIFEST_FILES = 400;
const MAX_REFERENCES = 3;
const MAX_REF_PATCH_CHARS = 6_000;
// Reference implementations (whole projects) get their own, separate budget so
// they don't crowd out the target project's own selected files.
const MAX_TEMPLATES = 3;
const MAX_TEMPLATE_CHARS = 24_000;

const DEFAULT_SYSTEM = [
  "You are TaskForge's code-modification engine. You apply one specific, well-scoped change to a web project.",
  "",
  "Rules:",
  "- Make the smallest correct change that fully satisfies the task. Do not refactor unrelated code.",
  "- Preserve the existing code style, indentation, and formatting.",
  "- For renames or rebrands that touch many files, prefer the replace_in_files tool over rewriting files by hand.",
  "- Use read_file to inspect a file before overwriting it with write_file (write_file needs the COMPLETE new contents).",
  "- When every required change is done, call finish with a short summary. Do not call finish before making changes unless the task genuinely requires none.",
].join("\n");

/** Replace {{key}} placeholders with input values (unknown keys are left intact). */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}

export function assembleRunContext(args: AssembleArgs): RunContextParts {
  const values = Object.fromEntries(args.inputs.map((i) => [i.key, i.value]));
  const interpolated = interpolate(args.prompt, values);

  const system = args.systemPrompt?.trim() || DEFAULT_SYSTEM;
  const sections: string[] = [];

  sections.push(`## Task\n${interpolated}`);

  if (args.inputs.length > 0) {
    const human = args.inputs
      .map((i) => `- **${i.label}** (\`${i.key}\`, ${i.type}): ${i.value === "" ? "—" : i.value}`)
      .join("\n");
    const machine =
      INPUTS_BLOCK_OPEN +
      "\n" +
      JSON.stringify(args.inputs.map((i) => ({ key: i.key, label: i.label, type: i.type, value: i.value }))) +
      "\n" +
      INPUTS_BLOCK_CLOSE;
    sections.push(`## Inputs\n${human}\n\n${machine}`);
  }

  if (args.analysis) {
    const a = args.analysis;
    const scriptLines = Object.entries(a.scripts)
      .slice(0, 12)
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");
    sections.push(
      `## Project\n- Framework: ${a.framework ?? "unknown"}\n- Package manager: ${a.packageManager ?? "unknown"}` +
        (scriptLines ? `\n- Scripts:\n${scriptLines}` : ""),
    );
  }

  const allPaths = [...args.files.keys()].sort();
  const manifest = allPaths.slice(0, MAX_MANIFEST_FILES);
  const manifestNote =
    allPaths.length > MAX_MANIFEST_FILES ? `\n… and ${allPaths.length - MAX_MANIFEST_FILES} more files` : "";
  sections.push(`## File manifest (${allPaths.length} files)\n${manifest.join("\n")}${manifestNote}`);

  const selected = selectFiles(args.files, args.inputs);
  if (selected.length > 0) {
    const blocks = selected
      .map((s) => `### ${s.path}\n\`\`\`\n${s.contents}\n\`\`\``)
      .join("\n\n");
    sections.push(`## Selected file contents\n${blocks}`);
  }

  const refs = args.references.slice(0, MAX_REFERENCES);
  if (refs.length > 0) {
    const blocks = refs
      .map((r) => {
        const patch =
          r.patch.length > MAX_REF_PATCH_CHARS
            ? r.patch.slice(0, MAX_REF_PATCH_CHARS) + "\n… [patch truncated]"
            : r.patch;
        return `### ${r.title}\n\`\`\`diff\n${patch}\n\`\`\``;
      })
      .join("\n\n");
    sections.push(
      `## Reference examples\nThese are diffs from past completed jobs for this recipe. Mimic their approach and scope.\n\n${blocks}`,
    );
  }

  const templates = (args.templates ?? []).slice(0, MAX_TEMPLATES);
  for (const tpl of templates) {
    const picked = selectFiles(tpl.files, args.inputs, MAX_TEMPLATE_CHARS);
    const fileBlocks = picked
      .map((s) => `#### ${s.path}\n\`\`\`\n${s.contents}\n\`\`\``)
      .join("\n\n");
    sections.push(
      `## Reference implementation — ${tpl.name}\n` +
        `A working reference project. Copy its approach, structure, and wiring for the task above — adapt it to this project rather than pasting verbatim.\n\n` +
        `### What to take from it\n${tpl.prompt}` +
        (fileBlocks ? `\n\n### Reference files\n${fileBlocks}` : ""),
    );
  }

  return { system, task: sections.join("\n\n") };
}

interface SelectedFile {
  path: string;
  contents: string;
}

/**
 * Pick which files to inline, under a byte budget. Files that contain one of the
 * input values (likely edit targets) come first, then package.json, then the
 * smallest remaining files.
 */
function selectFiles(files: Map<string, string>, inputs: ContextInput[], budgetChars = MAX_INLINE_CHARS): SelectedFile[] {
  const needles = inputs
    .map((i) => i.value.trim())
    .filter((v) => v.length >= 2);

  const scored = [...files.entries()].map(([path, contents]) => {
    const hit = needles.some((n) => contents.includes(n));
    const isPkg = path === "package.json" || path.endsWith("/package.json");
    const priority = hit ? 0 : isPkg ? 1 : 2;
    return { path, contents, priority, size: contents.length };
  });

  scored.sort((a, b) => a.priority - b.priority || a.size - b.size || a.path.localeCompare(b.path));

  const out: SelectedFile[] = [];
  let budget = budgetChars;
  for (const f of scored) {
    if (budget <= 0) break;
    // Only spend budget on likely-relevant files; skip large, unrelated ones.
    if (f.priority === 2 && f.size > 4_000) continue;
    const contents =
      f.contents.length > MAX_SINGLE_FILE_CHARS
        ? f.contents.slice(0, MAX_SINGLE_FILE_CHARS) + "\n… [file truncated]"
        : f.contents;
    if (contents.length > budget && out.length > 0) continue;
    out.push({ path: f.path, contents });
    budget -= contents.length;
  }
  return out;
}
