import { cn } from "@/lib/utils";

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

/** Renders a unified diff patch with per-line coloring. */
export function PatchView({ patch, className }: { patch: string; className?: string }) {
  const lines = patch.split("\n");
  return (
    <div className={cn("overflow-x-auto rounded-lg border bg-card", className)}>
      <pre className="min-w-full font-mono text-[12px] leading-relaxed">
        <code>
          {lines.map((line, i) => (
            <span key={i} className={cn("block px-4", lineClass(line))}>
              {line || " "}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
