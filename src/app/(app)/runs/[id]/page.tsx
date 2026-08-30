import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getRunDetail, getRunDiffPatch } from "@/server/runs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunStatusBadge } from "@/components/run-status-badge";
import { RunAutoRefresh } from "@/components/run-auto-refresh";
import { ProcessQueueButton } from "@/components/process-queue-button";
import { PatchView } from "@/components/patch-view";
import { CopyLink } from "@/components/copy-link";
import { isRunActive, STATUS_TONE_CLASSES } from "@/lib/run-status";
import { qaCheckLabel, qaStatusMeta } from "@/lib/qa-status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PHASE_LABELS: Record<string, string> = {
  analyze: "Analyze",
  plan: "Plan",
  modify: "Modify",
  validate: "Validate",
  repair: "Repair",
  deliver: "Deliver",
};

function duration(start: Date | null, end: Date | null): string {
  if (!start) return "—";
  const ms = (end ? end.getTime() : Date.now()) - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function stepDotClass(status: string): string {
  if (status === "done") return "bg-emerald-500";
  if (status === "failed") return "bg-red-500";
  if (status === "active") return "bg-sky-500 animate-pulse";
  return "bg-muted-foreground/40";
}

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const run = await getRunDetail(user.organizationId, id);
  if (!run) notFound();

  const active = isRunActive(run.status);
  const patch = run.diff ? await getRunDiffPatch(user.organizationId, id) : null;
  const showDrain = active && process.env.NODE_ENV !== "production";

  return (
    <div className="space-y-6">
      <RunAutoRefresh active={active} />

      <div>
        <Link
          href="/runs"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to runs
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{run.projectName}</h1>
            <p className="text-sm text-muted-foreground">
              {run.recipeName} · v{run.recipeVersion}
            </p>
            {run.referenceTemplates.length > 0 && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Reference implementations: {run.referenceTemplates.join(", ")}
              </p>
            )}
          </div>
          <RunStatusBadge status={run.status} className="px-3 py-1 text-sm" />
        </div>
      </div>

      {showDrain && (
        <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-3">
          <span className="text-xs text-muted-foreground">
            Dev: no worker is running. Process the queue to advance this run.
          </span>
          <div className="ml-auto">
            <ProcessQueueButton />
          </div>
        </div>
      )}

      {run.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="font-medium">Run failed</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{run.error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            {run.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {active ? "Waiting for the engine to start…" : "No steps recorded."}
              </p>
            ) : (
              <ol className="space-y-3">
                {run.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stepDotClass(s.status)}`} />
                    <span className="w-20 font-medium">{PHASE_LABELS[s.phase] ?? s.phase}</span>
                    <span className="w-16 font-mono text-muted-foreground">{duration(s.startedAt, s.finishedAt)}</span>
                    {(s.tokensIn != null || s.tokensOut != null) && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {(s.tokensIn ?? 0).toLocaleString()} in / {(s.tokensOut ?? 0).toLocaleString()} out
                      </span>
                    )}
                    <span className="ml-auto text-xs capitalize text-muted-foreground">{s.status}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Inputs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs</CardTitle>
          </CardHeader>
          <CardContent>
            {run.inputs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No inputs.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {run.inputs.map((inp) => (
                  <div key={inp.key}>
                    <dt className="text-xs text-muted-foreground">{inp.label}</dt>
                    <dd className="break-words font-medium">{inp.value || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QA checks */}
      {run.qaResults.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">QA checks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {run.qaResults.map((q) => {
              const meta = qaStatusMeta(q.status);
              return (
                <div key={q.check} className="space-y-1">
                  <div className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "inline-flex w-16 justify-center rounded-full border px-2 py-0.5 text-xs font-medium",
                        STATUS_TONE_CLASSES[meta.tone],
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="font-medium">{qaCheckLabel(q.check)}</span>
                    <span className="text-xs text-muted-foreground">{q.required ? "required" : "optional"}</span>
                  </div>
                  {q.summary && <p className="pl-[4.75rem] text-sm text-muted-foreground">{q.summary}</p>}
                  {q.detail && (
                    <details className="pl-[4.75rem]">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Output
                      </summary>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs leading-relaxed">
                        {q.detail}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Delivery */}
      {run.delivery && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share this tokenized link with the client — no login required. It expires{" "}
              {run.delivery.expiresAt ? run.delivery.expiresAt.toLocaleDateString() : "never"}.
            </p>
            <CopyLink url={run.delivery.shareUrl} />
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <a
                href={run.delivery.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" /> Open delivery page
              </a>
              {run.delivery.expired && <span className="text-xs text-destructive">This link has expired.</span>}
              {!run.delivery.hasBundle && (
                <span className="text-xs text-muted-foreground">Bundle unavailable for this run.</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Diff */}
      {run.diff && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Changes</h2>
            <p className="text-sm text-muted-foreground">
              {run.diff.filesChanged ?? 0} file{run.diff.filesChanged === 1 ? "" : "s"} ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400">+{run.diff.insertions ?? 0}</span>{" "}
              <span className="text-red-600 dark:text-red-400">−{run.diff.deletions ?? 0}</span>
            </p>
          </div>
          {run.diff.summary && <p className="text-sm text-muted-foreground">{run.diff.summary}</p>}
          {patch ? (
            <PatchView patch={patch} />
          ) : (
            <p className="text-sm text-muted-foreground">No textual changes were produced.</p>
          )}
        </div>
      )}
    </div>
  );
}
