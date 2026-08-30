"use client";

import { usePathname } from "next/navigation";

const LABELS: Array<[string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/workspaces", "Workspaces"],
  ["/recipes", "Task Recipes"],
  ["/templates", "Templates"],
  ["/runs", "Runs"],
];

/** Shows the current top-level section as a header eyebrow + title. */
export function SectionLabel() {
  const pathname = usePathname();
  const match = LABELS.find(([href]) => pathname === href || pathname.startsWith(href + "/"));
  const label = match ? match[1] : "Console";
  return (
    <div className="flex flex-col leading-none">
      <span className="eyebrow text-muted-foreground/70">Control plane</span>
      <span className="mt-1 font-display text-sm font-semibold tracking-tight">{label}</span>
    </div>
  );
}
