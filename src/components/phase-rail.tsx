import { ScanSearch, ListTree, FileCode2, ShieldCheck, Send } from "lucide-react";

const STAGES = [
  { key: "analyze", label: "Analyze", note: "Read the project", icon: ScanSearch },
  { key: "plan", label: "Plan", note: "Draft a change set", icon: ListTree },
  { key: "modify", label: "Modify", note: "Apply edits", icon: FileCode2 },
  { key: "validate", label: "Validate", note: "Sandbox QA", icon: ShieldCheck },
  { key: "deliver", label: "Deliver", note: "Tokenized link", icon: Send },
];

/**
 * Signature element: the forge pipeline rail. Encodes the fixed lifecycle every
 * run flows through — a heated bar running left to right through five stations.
 */
export function PhaseRail() {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-6 shadow-sm">
      <div className="glow-ember pointer-events-none absolute inset-x-0 top-0 h-24" />
      <div className="relative flex items-center justify-between">
        <div>
          <p className="eyebrow text-muted-foreground/70">Execution pipeline</p>
          <h2 className="mt-1 font-display text-base font-semibold tracking-tight">
            How every run is forged
          </h2>
        </div>
      </div>

      <div className="relative mt-6">
        {/* The rail line, heated across its full length. */}
        <div className="absolute left-0 right-0 top-6 h-0.5 bg-gradient-to-r from-ember/20 via-ember to-ember/20" />
        <ol className="relative grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex flex-col items-center text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card shadow-sm">
                  <Icon className="h-5 w-5 text-ember" />
                </span>
                <span className="mt-3 font-mono text-[0.7rem] text-muted-foreground/60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mt-0.5 text-sm font-medium">{s.label}</span>
                <span className="mt-0.5 text-xs text-muted-foreground">{s.note}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
