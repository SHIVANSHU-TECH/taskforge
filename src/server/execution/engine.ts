import AdmZip from "adm-zip";
import { prisma } from "../../lib/db";
import type { QaCheckType } from "../../lib/constants";
import { getLlmProvider, resolveModel } from "../llm";
import type { LlmMessage, LlmUsage, ToolCall } from "../llm/types";
import { INPUTS_BLOCK_CLOSE, INPUTS_BLOCK_OPEN } from "../llm/scripted";
import { getStorageProvider } from "../storage";
import type { StorageProvider } from "../storage/types";
import { extractZip } from "../ingestion/extract";
import { computeProjectDiff, fileMapFromEntries } from "../diff";
import { runQa, type QaCheckOutcome } from "../qa";
import { createDelivery } from "../delivery";
import type { QaCheckDef } from "../recipes/types";
import { assembleRunContext, type ContextInput, type ContextReference, type ContextTemplate } from "./context";
import { executeToolCall, MODIFY_TOOLS, WorkingTree } from "./tools";

/** Hard cap on model round-trips in a single modify/repair loop (backstop against loops). */
const MAX_MODIFY_ITERATIONS = 16;
/** How many times QA may fail-and-repair before the run is marked failed. */
const MAX_REPAIR_ATTEMPTS = 2;
/** Per-call ceiling on a single model round-trip, so a hung provider can't wedge a run forever. */
const LLM_CALL_TIMEOUT_MS = 120_000;
/** Cap on linked reference implementations loaded into context per run. */
const MAX_LINKED_TEMPLATES = 3;

/** An AbortSignal that fires after the per-call LLM timeout. */
function llmTimeout(): AbortSignal {
  return AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);
}

/**
 * Execute one run end-to-end: analyze the project, plan the change, apply it via
 * the tool-using model loop, diff and snapshot the result, then run automated QA
 * in a sandbox — repairing and re-validating on required-check failure. On a
 * passing run it packages the delivery (bundle + QA report + changelog behind an
 * expiring share token) and marks the run `delivered`; otherwise `failed`.
 *
 * Idempotent: only a `queued` run is processed; re-delivery is a no-op.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      project: { include: { analysis: true } },
      recipeVersion: {
        include: {
          inputs: { orderBy: { order: "asc" } },
          qaChecks: true,
          referenceExamples: true,
          recipe: { include: { templates: true } },
        },
      },
    },
  });
  if (!run) throw new Error(`Run ${runId} not found.`);
  if (run.status !== "queued") return; // already processed / not runnable

  const storage = getStorageProvider();
  const provider = getLlmProvider();
  const model = resolveModel(run.recipeVersion.model);
  const values = parseInputs(run.inputsJson);

  const stepRun = makeStepRunner(storage, runId);

  await prisma.run.update({
    where: { id: runId },
    data: { status: "analyzing", startedAt: new Date(), error: null },
  });

  try {
    // ---- ANALYZE: hydrate the source tree + reference diffs ----
    const analysis = await stepRun("analyze", async () => {
      if (!run.project.storageKey) {
        throw new Error("Project has no stored source archive to run against.");
      }
      const buf = await storage.get(run.project.storageKey);
      const extracted = extractZip(buf);
      const beforeMap = fileMapFromEntries(extracted.files);

      const references: ContextReference[] = [];
      for (const ref of run.recipeVersion.referenceExamples) {
        if (!ref.diffStorageKey) continue;
        try {
          references.push({ title: ref.title, patch: (await storage.get(ref.diffStorageKey)).toString("utf8") });
        } catch {
          /* a missing reference blob shouldn't abort the run */
        }
      }

      // Curated reference implementations linked to this recipe: extract each
      // template's stored archive so its files can be injected as an example.
      const templates: ContextTemplate[] = [];
      for (const tpl of run.recipeVersion.recipe.templates.slice(0, MAX_LINKED_TEMPLATES)) {
        if (!tpl.storageKey) continue;
        try {
          const tplBuf = await storage.get(tpl.storageKey);
          const files = fileMapFromEntries(extractZip(tplBuf).files);
          templates.push({ name: tpl.name, prompt: tpl.prompt, files });
        } catch {
          /* a missing/corrupt template blob shouldn't abort the run */
        }
      }
      return {
        value: { beforeMap, references, templates },
        log: `Loaded ${beforeMap.size} source text file(s); ${references.length} reference example(s); ${templates.length} reference implementation(s).`,
      };
    });

    const contextInputs: ContextInput[] = run.recipeVersion.inputs.map((i) => ({
      key: i.key,
      label: i.label,
      type: i.type,
      value: values[i.key] ?? "",
    }));
    const ctx = assembleRunContext({
      prompt: run.recipeVersion.prompt,
      systemPrompt: run.recipeVersion.systemPrompt,
      inputs: contextInputs,
      files: analysis.beforeMap,
      analysis: run.project.analysis
        ? {
            framework: run.project.analysis.framework,
            packageManager: run.project.analysis.packageManager,
            scripts: parseScripts(run.project.analysis.scriptsJson),
          }
        : null,
      references: analysis.references,
      templates: analysis.templates,
    });

    // ---- PLAN: one call, no tools ----
    await prisma.run.update({ where: { id: runId }, data: { status: "planning" } });
    await stepRun("plan", async (recordUsage) => {
      const res = await provider.complete({
        system: ctx.system,
        messages: [
          {
            role: "user",
            content: ctx.task + "\n\nBefore editing anything, briefly state your plan as 2–5 bullet points.",
          },
        ],
        model,
        temperature: 0,
        signal: llmTimeout(),
      });
      recordUsage(res.usage);
      return { value: null, log: res.text || "(no plan text returned)" };
    });

    // ---- MODIFY: agentic tool loop over the working tree ----
    await prisma.run.update({ where: { id: runId }, data: { status: "modifying" } });
    const tree = new WorkingTree(analysis.beforeMap);
    const modify = await stepRun("modify", async (recordUsage) => {
      const loop = await runModifyLoop(provider, model, ctx.system, ctx.task, tree, recordUsage);
      return { value: { summary: loop.summary, iterations: loop.iterations }, log: loop.log };
    });

    // ---- DIFF + SNAPSHOT ----
    let afterMap = tree.snapshot();
    const diffRowId = await writeSnapshot(storage, runId, analysis.beforeMap, afterMap, modify.summary, null);

    // ---- VALIDATE (automated QA) + REPAIR loop ----
    const qaChecks = parseQaChecks(run.recipeVersion.qaChecks);
    const analysisForQa = run.project.analysis
      ? {
          packageManager: run.project.analysis.packageManager,
          scripts: parseScripts(run.project.analysis.scriptsJson),
        }
      : null;

    let attempt = 0;
    let passed = true;
    let failureSummary = "";

    for (;;) {
      await prisma.run.update({ where: { id: runId }, data: { status: "validating" } });
      const qa = await stepRun("validate", async () => {
        const result = await runQa({
          runId,
          checks: qaChecks,
          files: afterMap,
          inputs: values,
          analysis: analysisForQa,
        });
        return { value: result, log: result.logText || "No QA checks configured." };
      });

      if (!qa.requiredFailed) {
        passed = true;
        break;
      }
      if (attempt >= MAX_REPAIR_ATTEMPTS) {
        passed = false;
        failureSummary = summarizeFailures(qa.results);
        break;
      }

      // ---- REPAIR: feed the failing required checks back to the model ----
      attempt++;
      await prisma.run.update({ where: { id: runId }, data: { status: "repairing" } });
      const repairTask = buildRepairTask(qa.results, contextInputs);
      await stepRun("repair", async (recordUsage) => {
        const loop = await runModifyLoop(provider, model, ctx.system, repairTask, tree, recordUsage);
        return { value: null, log: `Repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}\n\n${loop.log}` };
      });

      // Re-snapshot the repaired tree and refresh the stored diff/archive in place.
      afterMap = tree.snapshot();
      await writeSnapshot(storage, runId, analysis.beforeMap, afterMap, modify.summary, diffRowId);
    }

    if (!passed) {
      await prisma.run.update({
        where: { id: runId },
        data: { status: "failed", error: `Automated QA failed: ${failureSummary}`, finishedAt: new Date() },
      });
      return;
    }

    // QA passed — record it before delivery so a delivery hiccup can't lose it.
    await prisma.run.update({
      where: { id: runId },
      data: { status: "passed", finishedAt: new Date() },
    });

    // ---- DELIVER: package the passed run behind an expiring share token ----
    try {
      await stepRun("deliver", async () => {
        const { shareToken, expiresAt } = await createDelivery(runId);
        return {
          value: null,
          log: `Delivery packaged. Share token ${shareToken}; expires ${expiresAt.toISOString()}.`,
        };
      });
      await prisma.run.update({ where: { id: runId }, data: { status: "delivered" } });
    } catch {
      // The run stays `passed` (QA is recorded); re-launching re-delivers without re-running QA.
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.runStep.updateMany({
      where: { runId, status: "active" },
      data: { status: "failed", finishedAt: new Date() },
    });
    await prisma.run.update({
      where: { id: runId },
      data: { status: "failed", error: message, finishedAt: new Date() },
    });
    // Swallowed: the failure is recorded on the run. Re-launch to retry.
  }
}

// ---- helpers ----

interface StepReturn<T> {
  value: T;
  log?: string;
}

/** Wrap a phase in a RunStep row, recording status, timing, token usage, and a log blob. */
function makeStepRunner(storage: StorageProvider, runId: string) {
  return async function stepRun<T>(
    phase: string,
    fn: (recordUsage: (u: LlmUsage) => void) => Promise<StepReturn<T>>,
  ): Promise<T> {
    const step = await prisma.runStep.create({
      data: { runId, phase, status: "active", startedAt: new Date() },
    });
    let tokensIn = 0;
    let tokensOut = 0;
    const recordUsage = (u: LlmUsage) => {
      tokensIn += u.inputTokens;
      tokensOut += u.outputTokens;
    };

    try {
      const res = await fn(recordUsage);
      let logKey: string | null = null;
      if (res.log) {
        logKey = `runs/${runId}/${phase}.log`;
        await storage.put(logKey, res.log, { contentType: "text/plain" });
      }
      await prisma.runStep.update({
        where: { id: step.id },
        data: {
          status: "done",
          finishedAt: new Date(),
          tokensIn: tokensIn || null,
          tokensOut: tokensOut || null,
          logStorageKey: logKey,
        },
      });
      return res.value;
    } catch (e) {
      await prisma.runStep.update({
        where: { id: step.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          tokensIn: tokensIn || null,
          tokensOut: tokensOut || null,
        },
      });
      throw e;
    }
  };
}

interface ModifyLoopResult {
  summary: string;
  iterations: number;
  log: string;
}

/** Drive the tool-using model loop over the working tree until it finishes or hits the cap. */
async function runModifyLoop(
  provider: ReturnType<typeof getLlmProvider>,
  model: string,
  system: string,
  firstUserContent: string,
  tree: WorkingTree,
  recordUsage: (u: LlmUsage) => void,
): Promise<ModifyLoopResult> {
  const messages: LlmMessage[] = [{ role: "user", content: firstUserContent }];
  const logLines: string[] = [];
  let summary = "";
  let iterations = 0;

  for (let i = 0; i < MAX_MODIFY_ITERATIONS; i++) {
    iterations++;
    const res = await provider.complete({ system, messages, tools: MODIFY_TOOLS, model, temperature: 0, signal: llmTimeout() });
    recordUsage(res.usage);

    if (res.toolCalls.length === 0) {
      if (res.text) {
        summary = summary || res.text;
        logLines.push(`[assistant] ${clip(res.text, 300)}`);
      }
      break;
    }

    messages.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });

    let finished = false;
    for (const call of res.toolCalls) {
      const exec = executeToolCall(tree, call);
      logLines.push(`[${call.name}] ${summarizeArgs(call)} → ${clip(exec.result, 200)}`);
      messages.push({ role: "tool", content: exec.result, toolCallId: call.id, toolName: call.name });
      if (exec.finished) {
        finished = true;
        if (exec.finishSummary) summary = exec.finishSummary;
      }
    }
    if (finished) break;
  }

  return { summary, iterations, log: `Iterations: ${iterations}\n\n${logLines.join("\n")}` };
}

/**
 * Compute + store the unified diff and after.zip, then create the Diff row — or
 * update it in place when re-snapshotting after a repair. Returns the row id.
 */
async function writeSnapshot(
  storage: StorageProvider,
  runId: string,
  before: Map<string, string>,
  after: Map<string, string>,
  summary: string,
  existingDiffId: string | null,
): Promise<string> {
  const diff = computeProjectDiff(before, after);
  const diffKey = `runs/${runId}/diff.patch`;
  await storage.put(diffKey, diff.patch || "(no textual changes)", { contentType: "text/x-diff" });
  await storage.put(`runs/${runId}/after.zip`, buildZip(after), { contentType: "application/zip" });

  const data = {
    storageKey: diffKey,
    filesChanged: diff.filesChanged,
    insertions: diff.insertions,
    deletions: diff.deletions,
    summary: summary || null,
  };
  if (existingDiffId) {
    await prisma.diff.update({ where: { id: existingDiffId }, data });
    return existingDiffId;
  }
  const row = await prisma.diff.create({ data: { runId, ...data } });
  return row.id;
}

function parseQaChecks(
  rows: Array<{ type: string; required: boolean; configJson: string | null }>,
): QaCheckDef[] {
  return rows.map((r) => ({ type: r.type as QaCheckType, required: r.required, config: parseConfig(r.configJson) }));
}

function parseConfig(json: string | null): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Build the repair-phase task: the failing required checks + the machine-readable inputs. */
function buildRepairTask(results: QaCheckOutcome[], inputs: ContextInput[]): string {
  const failing = results.filter((r) => r.required && r.status === "fail");
  const items = failing
    .map((r) => `### ${r.check} failed\n${r.summary}` + (r.detail ? `\n\nOutput:\n\`\`\`\n${clip(r.detail, 3000)}\n\`\`\`` : ""))
    .join("\n\n");
  const machine =
    INPUTS_BLOCK_OPEN +
    "\n" +
    JSON.stringify(inputs.map((i) => ({ key: i.key, label: i.label, type: i.type, value: i.value }))) +
    "\n" +
    INPUTS_BLOCK_CLOSE;
  return [
    "The change was applied, but automated QA reported failing REQUIRED checks. Fix the project so they pass.",
    "Inspect files with read_file, then correct them with write_file or replace_in_files. Do not undo the intended change — correct it. Call finish when done.",
    "",
    "## Failing checks",
    items,
    "",
    "## Inputs",
    machine,
  ].join("\n");
}

function summarizeFailures(results: QaCheckOutcome[]): string {
  return results
    .filter((r) => r.required && r.status === "fail")
    .map((r) => `${r.check} (${r.summary})`)
    .join("; ");
}

function buildZip(files: Map<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [path, contents] of files) {
    zip.addFile(path, Buffer.from(contents, "utf8"));
  }
  return zip.toBuffer();
}

function parseInputs(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) out[k] = typeof v === "string" ? v : String(v);
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function parseScripts(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function summarizeArgs(call: ToolCall): string {
  const a = call.arguments as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return "";
  if (call.name === "replace_in_files") return `"${clip(String(a.find ?? ""), 40)}" → "${clip(String(a.replace ?? ""), 40)}"`;
  if (call.name === "write_file" || call.name === "read_file" || call.name === "delete_file") {
    return String(a.path ?? "");
  }
  if (call.name === "finish") return clip(String(a.summary ?? ""), 80);
  return "";
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
