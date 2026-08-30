import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/db";
import { getEnv } from "../../lib/env";
import { getStorageProvider } from "../storage";
import { qaCheckLabel, qaStatusMeta } from "../../lib/qa-status";

/**
 * Phase 6 — Preview & delivery.
 *
 * A delivery packages a passed run for the client: the final project bundle
 * (reusing the snapshot's after.zip), a human-readable QA report, and a
 * changelog, all reachable through a single unguessable share token. Clients
 * never log in — the token is a bearer capability with an expiry. Everything a
 * token holder can reach is confined to the three artifacts recorded on the
 * DeliveryArtifact row; no storage key ever comes from user input.
 */

const DELIVERY_TTL_DAYS = 14;

export type DeliveryFileKind = "bundle" | "qa-report" | "changelog";

export interface DeliveryQaLine {
  check: string;
  status: string;
  required: boolean;
  summary: string | null;
}

export interface DeliveryView {
  shareToken: string;
  projectName: string;
  recipeName: string;
  recipeVersion: number;
  runStatus: string;
  changelogMarkdown: string | null;
  qa: { total: number; passed: number; failed: number; skipped: number };
  qaResults: DeliveryQaLine[];
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
  hasBundle: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  expired: boolean;
}

/** Share metadata surfaced on the internal run page (org-scoped caller). */
export interface DeliverySummary {
  shareToken: string;
  shareUrl: string;
  expiresAt: Date | null;
  expired: boolean;
  hasBundle: boolean;
  createdAt: Date;
}

function makeShareToken(): string {
  return randomBytes(24).toString("base64url");
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt != null && expiresAt.getTime() < Date.now();
}

/** PLACEHOLDER_BODY */

// ---- report + changelog rendering ----

function buildQaReport(lines: DeliveryQaLine[]): string {
  const out: string[] = ["# QA report", ""];
  if (lines.length === 0) {
    out.push("_No QA checks were configured for this run._");
    return out.join("\n") + "\n";
  }
  for (const l of lines) {
    const status = qaStatusMeta(l.status).label;
    const req = l.required ? "required" : "optional";
    out.push(`## ${qaCheckLabel(l.check)} — ${status} (${req})`);
    out.push("");
    out.push(l.summary ?? "(no summary)");
    out.push("");
  }
  return out.join("\n");
}

function buildChangelog(args: {
  projectName: string;
  recipeName: string;
  recipeVersion: number;
  diffSummary: string | null;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
  inputs: Array<{ label: string; value: string }>;
  completedAt: Date;
}): string {
  const out: string[] = [
    `# Changelog — ${args.projectName}`,
    "",
    `Automated change applied via the **${args.recipeName}** recipe (v${args.recipeVersion}).`,
    "",
    `Completed ${args.completedAt.toISOString()}.`,
    "",
    "## Summary",
    "",
    args.diffSummary?.trim() || "_No summary was produced for this change._",
    "",
    "## Files",
    "",
    `- ${args.filesChanged ?? 0} file(s) changed`,
    `- +${args.insertions ?? 0} / −${args.deletions ?? 0} lines`,
    "",
  ];
  const provided = args.inputs.filter((i) => i.value.trim().length > 0);
  if (provided.length > 0) {
    out.push("## Inputs");
    out.push("");
    for (const i of provided) out.push(`- **${i.label}:** ${i.value}`);
    out.push("");
  }
  return out.join("\n");
}

// ---- creation (called by the execution engine on a passed run) ----

/**
 * Build (or refresh) the delivery for a run: writes the QA report and changelog
 * to storage, references the final bundle, and mints an expiring share token.
 * Idempotent per run — re-delivery keeps the existing token.
 */
export async function createDelivery(runId: string): Promise<{ shareToken: string; expiresAt: Date }> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    include: {
      project: { select: { name: true } },
      recipeVersion: {
        select: { version: true, recipe: { select: { name: true } }, inputs: { orderBy: { order: "asc" } } },
      },
      qaResults: { orderBy: { createdAt: "asc" } },
      diffs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!run) throw new Error(`Run ${runId} not found for delivery.`);

  const storage = getStorageProvider();
  const diff = run.diffs[0] ?? null;

  // The final bundle is the snapshot produced during modify/repair.
  const bundleKey = `runs/${runId}/after.zip`;
  const hasBundle = await storage.exists(bundleKey);

  const qaLines: DeliveryQaLine[] = run.qaResults.map((q) => {
    const d = parseQaDetails(q.detailsJson);
    return { check: q.check, status: q.status, required: d.required, summary: d.summary };
  });

  const qaReportKey = `runs/${runId}/delivery/qa-report.md`;
  await storage.put(qaReportKey, buildQaReport(qaLines), { contentType: "text/markdown" });

  const inputValues = parseInputs(run.inputsJson);
  const changelogKey = `runs/${runId}/delivery/changelog.md`;
  await storage.put(
    changelogKey,
    buildChangelog({
      projectName: run.project.name,
      recipeName: run.recipeVersion.recipe.name,
      recipeVersion: run.recipeVersion.version,
      diffSummary: diff?.summary ?? null,
      filesChanged: diff?.filesChanged ?? null,
      insertions: diff?.insertions ?? null,
      deletions: diff?.deletions ?? null,
      inputs: run.recipeVersion.inputs.map((i) => ({ label: i.label, value: inputValues[i.key] ?? "" })),
      completedAt: run.finishedAt ?? new Date(),
    }),
    { contentType: "text/markdown" },
  );

  const expiresAt = new Date(Date.now() + DELIVERY_TTL_DAYS * 86_400_000);
  const existing = await prisma.deliveryArtifact.findUnique({ where: { runId }, select: { shareToken: true } });
  const shareToken = existing?.shareToken ?? makeShareToken();

  await prisma.deliveryArtifact.upsert({
    where: { runId },
    update: {
      qaReportStorageKey: qaReportKey,
      changeLogStorageKey: changelogKey,
      finalBundleStorageKey: hasBundle ? bundleKey : null,
      expiresAt,
    },
    create: {
      runId,
      shareToken,
      qaReportStorageKey: qaReportKey,
      changeLogStorageKey: changelogKey,
      finalBundleStorageKey: hasBundle ? bundleKey : null,
      expiresAt,
    },
  });

  return { shareToken, expiresAt };
}

// ---- public read (token holder) ----

export async function getDeliveryByToken(token: string): Promise<DeliveryView | null> {
  const art = await prisma.deliveryArtifact.findUnique({
    where: { shareToken: token },
    include: {
      run: {
        include: {
          project: { select: { name: true } },
          recipeVersion: { select: { version: true, recipe: { select: { name: true } } } },
          qaResults: { orderBy: { createdAt: "asc" } },
          diffs: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!art) return null;

  const run = art.run;
  const diff = run.diffs[0] ?? null;
  const qaResults: DeliveryQaLine[] = run.qaResults.map((q) => {
    const d = parseQaDetails(q.detailsJson);
    return { check: q.check, status: q.status, required: d.required, summary: d.summary };
  });
  const qa = {
    total: qaResults.length,
    passed: qaResults.filter((q) => q.status === "pass").length,
    failed: qaResults.filter((q) => q.status === "fail").length,
    skipped: qaResults.filter((q) => q.status === "skip").length,
  };

  let changelogMarkdown: string | null = null;
  if (art.changeLogStorageKey) {
    try {
      changelogMarkdown = (await getStorageProvider().get(art.changeLogStorageKey)).toString("utf8");
    } catch {
      changelogMarkdown = null;
    }
  }

  return {
    shareToken: art.shareToken,
    projectName: run.project.name,
    recipeName: run.recipeVersion.recipe.name,
    recipeVersion: run.recipeVersion.version,
    runStatus: run.status,
    changelogMarkdown,
    qa,
    qaResults,
    filesChanged: diff?.filesChanged ?? null,
    insertions: diff?.insertions ?? null,
    deletions: diff?.deletions ?? null,
    hasBundle: art.finalBundleStorageKey != null,
    createdAt: art.createdAt,
    expiresAt: art.expiresAt,
    expired: isExpired(art.expiresAt),
  };
}

// ---- internal read (org-scoped) ----

export async function getDeliveryForRun(organizationId: string, runId: string): Promise<DeliverySummary | null> {
  const art = await prisma.deliveryArtifact.findFirst({
    where: { runId, run: { project: { workspace: { organizationId } } } },
  });
  if (!art) return null;
  return {
    shareToken: art.shareToken,
    shareUrl: `${getEnv().APP_URL.replace(/\/$/, "")}/deliver/${art.shareToken}`,
    expiresAt: art.expiresAt,
    expired: isExpired(art.expiresAt),
    hasBundle: art.finalBundleStorageKey != null,
    createdAt: art.createdAt,
  };
}

// ---- download (public, token holder) ----

export type DeliveryFileResult =
  | { ok: true; buffer: Buffer; filename: string; contentType: string }
  | { ok: false; error: "not_found" | "expired" | "unavailable" };

export async function resolveDeliveryFile(token: string, kind: DeliveryFileKind): Promise<DeliveryFileResult> {
  const art = await prisma.deliveryArtifact.findUnique({
    where: { shareToken: token },
    include: { run: { include: { project: { select: { name: true } } } } },
  });
  if (!art) return { ok: false, error: "not_found" };
  if (isExpired(art.expiresAt)) return { ok: false, error: "expired" };

  const spec: Record<DeliveryFileKind, { key: string | null; contentType: string; suffix: string }> = {
    bundle: { key: art.finalBundleStorageKey, contentType: "application/zip", suffix: "bundle.zip" },
    "qa-report": { key: art.qaReportStorageKey, contentType: "text/markdown; charset=utf-8", suffix: "qa-report.md" },
    changelog: { key: art.changeLogStorageKey, contentType: "text/markdown; charset=utf-8", suffix: "changelog.md" },
  };
  const chosen = spec[kind];
  if (!chosen.key) return { ok: false, error: "unavailable" };

  try {
    const buffer = await getStorageProvider().get(chosen.key);
    return {
      ok: true,
      buffer,
      filename: `${slugify(art.run.project.name)}-${chosen.suffix}`,
      contentType: chosen.contentType,
    };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

// ---- local parsing helpers (JSON string columns) ----

function parseQaDetails(json: string | null): { summary: string | null; required: boolean } {
  if (!json) return { summary: null, required: false };
  try {
    const obj = JSON.parse(json) as { summary?: unknown; required?: unknown };
    return { summary: typeof obj.summary === "string" ? obj.summary : null, required: obj.required === true };
  } catch {
    return { summary: null, required: false };
  }
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
