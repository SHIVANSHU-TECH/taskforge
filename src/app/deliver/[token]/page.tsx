import type { Metadata } from "next";
import { CheckCircle2, Download, FileText, Package } from "lucide-react";
import { getDeliveryByToken } from "@/server/delivery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { qaCheckLabel, qaStatusMeta } from "@/lib/qa-status";
import { STATUS_TONE_CLASSES } from "@/lib/run-status";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project delivery",
  robots: { index: false, follow: false },
};

function DownloadLink({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: typeof Download;
  label: string;
  hint: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-xs transition-all hover:border-ember/40 hover:shadow-md"
    >
      <Icon className="h-5 w-5 text-muted-foreground" />
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <Download className="ml-auto h-4 w-4 text-muted-foreground" />
    </a>
  );
}

/* PLACEHOLDER_PAGE */

export default async function DeliveryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const delivery = await getDeliveryByToken(token);

  if (!delivery || delivery.expired) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-xl font-semibold">This delivery link is unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {delivery?.expired
            ? "This link has expired. Please ask for a fresh delivery link."
            : "We couldn't find a delivery for this link. Check that you copied the full URL."}
        </p>
      </main>
    );
  }

  const base = `/api/deliver/${encodeURIComponent(token)}/download`;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Ready for review
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{delivery.projectName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prepared with the {delivery.recipeName} workflow. {delivery.filesChanged ?? 0} file
          {delivery.filesChanged === 1 ? "" : "s"} changed
          {delivery.insertions != null || delivery.deletions != null ? (
            <>
              {" "}(<span className="text-emerald-600 dark:text-emerald-400">+{delivery.insertions ?? 0}</span>{" "}
              <span className="text-red-600 dark:text-red-400">−{delivery.deletions ?? 0}</span>)
            </>
          ) : null}
          .
        </p>
      </div>

      <div className="space-y-6">
        {/* Downloads */}
        <div className="grid gap-3 sm:grid-cols-2">
          {delivery.hasBundle && (
            <DownloadLink
              href={`${base}?file=bundle`}
              icon={Package}
              label="Download project"
              hint="Final source bundle (.zip)"
            />
          )}
          <DownloadLink
            href={`${base}?file=changelog`}
            icon={FileText}
            label="Changelog"
            hint="What changed and why (.md)"
          />
          <DownloadLink
            href={`${base}?file=qa-report`}
            icon={FileText}
            label="QA report"
            hint="Automated checks (.md)"
          />
        </div>

        {/* QA summary */}
        {delivery.qaResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quality checks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {delivery.qaResults.map((q) => {
                const meta = qaStatusMeta(q.status);
                return (
                  <div key={q.check} className="flex items-center gap-3 text-sm">
                    <span
                      className={cn(
                        "inline-flex w-16 justify-center rounded-full border px-2 py-0.5 text-xs font-medium",
                        STATUS_TONE_CLASSES[meta.tone],
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="font-medium">{qaCheckLabel(q.check)}</span>
                    {q.summary && <span className="truncate text-xs text-muted-foreground">{q.summary}</span>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Changelog */}
        {delivery.changelogMarkdown && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
                {delivery.changelogMarkdown}
              </pre>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          This link expires {delivery.expiresAt ? delivery.expiresAt.toLocaleDateString() : "never"}.
        </p>
      </div>
    </main>
  );
}
