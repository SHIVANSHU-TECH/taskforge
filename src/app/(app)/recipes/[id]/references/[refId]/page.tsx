import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getReferenceDiff } from "@/server/recipes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function lineClass(line: string): string {
  if (line.startsWith("diff --git") || line.startsWith("new file") || line.startsWith("deleted file")) {
    return "font-semibold text-foreground";
  }
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-sky-600 dark:text-sky-400";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-700 dark:text-red-300";
  return "text-muted-foreground";
}

export default async function ReferenceDiffPage({
  params,
}: {
  params: Promise<{ id: string; refId: string }>;
}) {
  const user = await requireUser();
  const { id, refId } = await params;

  const data = await getReferenceDiff(user.organizationId, refId);
  if (!data) notFound();

  const lines = data.patch.split("\n");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/recipes/${id}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to recipe
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{data.title}</h1>
        <p className="text-sm text-muted-foreground">Reference diff (original → completed)</p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <pre className="min-w-full font-mono text-[12px] leading-relaxed">
          <code>
            {lines.map((line, i) => (
              <span key={i} className={cn("block px-4", lineClass(line))}>
                {line || " "}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
