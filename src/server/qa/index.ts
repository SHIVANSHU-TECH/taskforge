import { prisma } from "../../lib/db";
import type { QaCheckType, QaStatus } from "../../lib/constants";
import type { QaCheckDef } from "../recipes/types";
import { getSandboxProvider } from "../sandbox";
import type { ExecResult, SandboxHandle, SandboxProvider } from "../sandbox/types";

/** Timeouts for the sandbox phases (generous — the worker is long-running). */
const INSTALL_TIMEOUT_MS = 240_000;
const BUILD_TIMEOUT_MS = 240_000;
const CHECK_TIMEOUT_MS = 120_000;
/** Trailing output kept per check for the UI/log. */
const DETAIL_TAIL_CHARS = 4_000;

export interface QaCheckOutcome {
  check: QaCheckType;
  status: QaStatus;
  required: boolean;
  /** One-line human summary. */
  summary: string;
  /** Optional multi-line detail (command output tail, mismatched strings). */
  detail?: string;
}

export interface QaRunResult {
  results: QaCheckOutcome[];
  /** True when at least one *required* check failed — the run must repair or fail. */
  requiredFailed: boolean;
  /** Combined text blob stored as the validate step's log. */
  logText: string;
}

export interface RunQaArgs {
  runId: string;
  checks: QaCheckDef[];
  /** The current (post-modify or post-repair) project tree: path → text. */
  files: Map<string, string>;
  /** Coerced run inputs (used to derive branding expectations). */
  inputs: Record<string, string>;
  analysis: { packageManager: string | null; scripts: Record<string, string> } | null;
}

const EXEC_CHECKS = new Set<QaCheckType>(["build", "typescript", "lint"]);
const DEFERRED: Partial<Record<QaCheckType, string>> = {
  api: "API checks require a running preview server (Phase 6).",
  e2e: "End-to-end checks require a running preview server (Phase 6).",
  visual: "Visual regression requires a screenshot baseline (Phase 6).",
};

/**
 * Run a recipe's QA checks against the produced project tree and record a
 * QAResult per check. Static checks (branding) run directly on the file map;
 * build/typescript/lint materialize the tree into a sandbox, install once, then
 * run the corresponding command. Checks that can't run here (no script, deps
 * unavailable, preview-dependent) are recorded as `skip`, which never blocks a
 * run — only a required `fail` does.
 */
export async function runQa(args: RunQaArgs): Promise<QaRunResult> {
  const { checks, files, inputs, analysis } = args;
  const outcomes: QaCheckOutcome[] = [];

  // --- static + deferred checks (no sandbox) ---
  for (const c of checks) {
    if (c.type === "branding") {
      outcomes.push(brandingOutcome(c, files, inputs));
    } else if (c.type in DEFERRED) {
      outcomes.push({ check: c.type, status: "skip", required: c.required, summary: DEFERRED[c.type]! });
    }
  }

  // --- exec checks (build/typescript/lint) share one sandbox + install ---
  const execChecks = checks.filter((c) => EXEC_CHECKS.has(c.type));
  if (execChecks.length > 0) {
    outcomes.push(...(await runExecChecks(execChecks, files, analysis)));
  }

  // Restore the recipe's declared order.
  const order = new Map(checks.map((c, i) => [c.type, i] as const));
  outcomes.sort((a, b) => (order.get(a.check) ?? 0) - (order.get(b.check) ?? 0));

  const requiredFailed = outcomes.some((o) => o.required && o.status === "fail");

  await persist(args.runId, outcomes);

  const logText = outcomes
    .map((o) => {
      const req = o.required ? "required" : "optional";
      const head = `## ${o.check} — ${o.status.toUpperCase()} (${req})\n${o.summary}`;
      return o.detail ? `${head}\n\n${o.detail}` : head;
    })
    .join("\n\n");

  return { results: outcomes, requiredFailed, logText };
}

// ---- branding ----

/** Derive the strings that must be gone vs. present after the change. */
function brandingExpectations(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, string>,
): { removed: string[]; added: string[] } {
  const fromConfig = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length >= 2).map((x) => x.trim()) : [];

  const removed = fromConfig(config?.removed);
  const added = fromConfig(config?.added);
  if (removed.length > 0 || added.length > 0) return { removed: unique(removed), added: unique(added) };

  // Fall back to old→new input pairs (oldName/newName, from*/to*, …).
  const OLD = ["old", "from", "current", "previous", "prev", "source", "existing"];
  const NEW = ["new", "to", "target", "dest", "replacement", "updated"];
  const byKey = new Map(Object.entries(inputs).map(([k, v]) => [k.toLowerCase(), v]));
  const dRemoved: string[] = [];
  const dAdded: string[] = [];
  for (const [key, value] of Object.entries(inputs)) {
    const lower = key.toLowerCase();
    const op = OLD.find((p) => lower.startsWith(p));
    if (!op) continue;
    const remainder = lower.slice(op.length);
    for (const np of NEW) {
      const counterpart = byKey.get(np + remainder);
      if (counterpart === undefined) continue;
      const find = value.trim();
      const replace = counterpart.trim();
      if (find.length >= 2 && replace.length >= 2 && find !== replace) {
        dRemoved.push(find);
        dAdded.push(replace);
      }
      break;
    }
  }
  return { removed: unique(dRemoved), added: unique(dAdded) };
}

function brandingOutcome(
  c: QaCheckDef,
  files: Map<string, string>,
  inputs: Record<string, string>,
): QaCheckOutcome {
  const { removed, added } = brandingExpectations(c.config, inputs);
  if (removed.length === 0 && added.length === 0) {
    return {
      check: "branding",
      status: "skip",
      required: c.required,
      summary: "No branding strings configured or derivable from inputs.",
    };
  }

  const present = (needle: string): string[] => {
    const hits: string[] = [];
    for (const [path, contents] of files) if (contents.includes(needle)) hits.push(path);
    return hits;
  };

  const stillPresent = removed.filter((s) => present(s).length > 0);
  const missing = added.filter((s) => present(s).length === 0);

  if (stillPresent.length === 0 && missing.length === 0) {
    return {
      check: "branding",
      status: "pass",
      required: c.required,
      summary: `${removed.length} old string(s) removed, ${added.length} new string(s) present across ${files.size} files.`,
    };
  }

  const problems: string[] = [];
  const detailLines: string[] = [];
  if (stillPresent.length > 0) {
    problems.push(`${stillPresent.length} old string(s) still present`);
    for (const s of stillPresent) detailLines.push(`- still present: "${s}" in ${present(s).slice(0, 5).join(", ")}`);
  }
  if (missing.length > 0) {
    problems.push(`${missing.length} new string(s) missing`);
    for (const s of missing) detailLines.push(`- missing: "${s}"`);
  }
  return {
    check: "branding",
    status: "fail",
    required: c.required,
    summary: problems.join("; ") + ".",
    detail: detailLines.join("\n"),
  };
}

// ---- exec checks (build / typescript / lint) ----

interface RunnablePlan {
  check: QaCheckDef;
  cmd: string;
}
interface SkipPlan {
  check: QaCheckDef;
  skip: string;
}
type ExecPlan = RunnablePlan | SkipPlan;

interface PlanContext {
  pm: PackageManager;
  scripts: Record<string, string>;
  hasTsconfig: boolean;
  hasTypescriptDep: boolean;
}

/** Decide the command for a check (or why it can't run) without touching the sandbox. */
function planExecCheck(c: QaCheckDef, ctx: PlanContext): ExecPlan {
  if (c.type === "build") {
    return ctx.scripts.build ? { check: c, cmd: ctx.pm.run("build") } : { check: c, skip: "No build script defined." };
  }
  if (c.type === "lint") {
    return ctx.scripts.lint ? { check: c, cmd: ctx.pm.run("lint") } : { check: c, skip: "No lint script defined." };
  }
  // typescript
  if (!ctx.hasTsconfig) return { check: c, skip: "No tsconfig.json in the project." };
  if (!ctx.hasTypescriptDep) return { check: c, skip: "TypeScript is not a project dependency." };
  const cmd = ctx.scripts.typecheck
    ? ctx.pm.run("typecheck")
    : ctx.scripts["type-check"]
      ? ctx.pm.run("type-check")
      : `${ctx.pm.npx} --no-install tsc --noEmit`;
  return { check: c, cmd };
}

async function runExecChecks(
  execChecks: QaCheckDef[],
  files: Map<string, string>,
  analysis: { packageManager: string | null; scripts: Record<string, string> } | null,
): Promise<QaCheckOutcome[]> {
  const pkg = readRootPackageJson(files);
  const scripts = analysis?.scripts && Object.keys(analysis.scripts).length > 0 ? analysis.scripts : pkg.scripts;
  const ctx: PlanContext = {
    pm: normalizePackageManager(analysis?.packageManager ?? null),
    scripts,
    hasTsconfig: [...files.keys()].some((p) => p === "tsconfig.json" || p.endsWith("/tsconfig.json")),
    hasTypescriptDep: pkg.deps.has("typescript"),
  };

  // Only stand up a sandbox + install deps if at least one check can actually run.
  const plans = execChecks.map((c) => planExecCheck(c, ctx));
  const runnable = plans.filter((p): p is RunnablePlan => "cmd" in p);
  if (runnable.length === 0) {
    return plans.map((p) => skipOutcome(p.check, (p as SkipPlan).skip));
  }

  const sandbox = getSandboxProvider();
  let handle: SandboxHandle | null = null;
  try {
    handle = await sandbox.create({});
    for (const [p, contents] of files) await sandbox.writeFile(handle, p, contents);

    // Install once; runnable checks skip (not fail) when deps can't be installed.
    const install = await sandbox.exec(handle, ctx.pm.install, { timeoutMs: INSTALL_TIMEOUT_MS });
    const installOk = install.exitCode === 0 && !install.timedOut;
    const installNote = `dependency install failed (exit ${install.exitCode}${install.timedOut ? ", timed out" : ""})`;

    const out: QaCheckOutcome[] = [];
    for (const plan of plans) {
      if ("skip" in plan) {
        out.push(skipOutcome(plan.check, plan.skip));
        continue;
      }
      if (!installOk) {
        out.push(skipOutcome(plan.check, `Skipped — ${installNote}.`));
        continue;
      }
      const timeoutMs = plan.check.type === "build" ? BUILD_TIMEOUT_MS : CHECK_TIMEOUT_MS;
      const r = await sandbox.exec(handle, plan.cmd, { timeoutMs });
      out.push(fromExec(plan.check.type, plan.check.required, plan.cmd, r));
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return execChecks.map((c) => skipOutcome(c, `Sandbox unavailable — ${clip(msg, 140)}`));
  } finally {
    if (handle) await sandbox.destroy(handle).catch(() => {});
  }
}

function skipOutcome(c: QaCheckDef, summary: string): QaCheckOutcome {
  return { check: c.type, status: "skip", required: c.required, summary };
}

function fromExec(check: QaCheckType, required: boolean, cmd: string, r: ExecResult): QaCheckOutcome {
  const ok = r.exitCode === 0 && !r.timedOut;
  const detail = tail(`${r.stdout}\n${r.stderr}`.trim(), DETAIL_TAIL_CHARS);
  return {
    check,
    required,
    status: ok ? "pass" : "fail",
    summary: ok
      ? `\`${cmd}\` passed (${fmtMs(r.durationMs)}).`
      : `\`${cmd}\` failed — exit ${r.exitCode}${r.timedOut ? ", timed out" : ""} (${fmtMs(r.durationMs)}).`,
    detail: detail || undefined,
  };
}

// ---- package-manager command mapping ----

interface PackageManager {
  name: string;
  install: string;
  run: (script: string) => string;
  npx: string;
}

function normalizePackageManager(pm: string | null): PackageManager {
  const name = pm && ["npm", "pnpm", "yarn", "bun"].includes(pm) ? pm : "npm";
  const install =
    name === "pnpm"
      ? "pnpm install --prefer-offline"
      : name === "yarn"
        ? "yarn install"
        : name === "bun"
          ? "bun install"
          : "npm install --no-audit --no-fund --prefer-offline";
  const run = (script: string) =>
    name === "yarn" ? `yarn ${script}` : name === "bun" ? `bun run ${script}` : `${name} run ${script}`;
  const npx = name === "pnpm" ? "pnpm dlx" : name === "yarn" ? "yarn dlx" : name === "bun" ? "bunx" : "npx";
  return { name, install, run, npx };
}

// ---- persistence ----

async function persist(runId: string, outcomes: QaCheckOutcome[]): Promise<void> {
  // Latest QA pass replaces the previous one (repair loops re-validate).
  await prisma.$transaction([
    prisma.qAResult.deleteMany({ where: { runId } }),
    ...outcomes.map((o) =>
      prisma.qAResult.create({
        data: {
          runId,
          check: o.check,
          status: o.status,
          detailsJson: JSON.stringify({ summary: o.summary, required: o.required, detail: o.detail ?? null }),
        },
      }),
    ),
  ]);
}

// ---- helpers ----

function readRootPackageJson(files: Map<string, string>): { scripts: Record<string, string>; deps: Set<string> } {
  let bestPath: string | null = null;
  let bestDepth = Infinity;
  for (const p of files.keys()) {
    if (p === "package.json" || p.endsWith("/package.json")) {
      const depth = p.split("/").length;
      if (depth < bestDepth) {
        bestDepth = depth;
        bestPath = p;
      }
    }
  }
  if (!bestPath) return { scripts: {}, deps: new Set() };
  try {
    const pkg = JSON.parse(files.get(bestPath)!) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      scripts: pkg.scripts ?? {},
      deps: new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]),
    };
  } catch {
    return { scripts: {}, deps: new Set() };
  }
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

function tail(s: string, n: number): string {
  return s.length > n ? "…" + s.slice(s.length - n) : s;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
