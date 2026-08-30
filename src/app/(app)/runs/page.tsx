import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listRuns } from "@/server/runs";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RunStatusBadge } from "@/components/run-status-badge";
import { RunAutoRefresh } from "@/components/run-auto-refresh";
import { ProcessQueueButton } from "@/components/process-queue-button";
import { isRunActive } from "@/lib/run-status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatWhen(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default async function RunsPage() {
  const user = await requireUser();
  const runs = await listRuns(user.organizationId);
  const anyActive = runs.some((r) => isRunActive(r.status));
  const isDev = process.env.NODE_ENV !== "production";

  return (
    <div className="stagger space-y-6">
      <RunAutoRefresh active={anyActive} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-muted-foreground/70">Execution</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground">
            AI execution history — a recipe applied to a project, planned and modified by the engine.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isDev && <ProcessQueueButton />}
          <Link href="/runs/new" className={cn(buttonVariants({ size: "sm" }))}>
            New run
          </Link>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No runs yet. Launch one to see execution history here.
          </p>
          <Link href="/runs/new" className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
            New run
          </Link>
        </div>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center justify-between gap-4 px-6 py-3 text-sm transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{run.projectName}</div>
                  <div className="truncate text-muted-foreground">
                    {run.recipeName} · v{run.recipeVersion}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {run.filesChanged != null && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {run.filesChanged} file{run.filesChanged === 1 ? "" : "s"}
                    </span>
                  )}
                  <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                    {formatWhen(run.createdAt)}
                  </span>
                  <RunStatusBadge status={run.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
