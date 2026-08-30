import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FolderGit2, Package, BookMarked, PlayCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PhaseRail } from "@/components/phase-rail";

export const dynamic = "force-dynamic";

const PHASES = [
  { n: 1, name: "Foundation", status: "done" },
  { n: 2, name: "Workspaces & ingestion", status: "done" },
  { n: 3, name: "Recipe system", status: "done" },
  { n: 4, name: "AI execution engine", status: "done" },
  { n: 5, name: "Sandbox + QA engine", status: "done" },
  { n: 6, name: "Preview & delivery", status: "done" },
  { n: 7, name: "Seed recipes", status: "done" },
  { n: 8, name: "Hardening", status: "done" },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const org = { organizationId: user.organizationId };

  const [workspaces, projects, recipes, runs] = await Promise.all([
    prisma.workspace.count({ where: org }),
    prisma.project.count({ where: { workspace: org } }),
    prisma.recipe.count({ where: org }),
    prisma.run.count({ where: { project: { workspace: org } } }),
  ]);

  const stats = [
    { label: "Workspaces", value: workspaces, icon: FolderGit2 },
    { label: "Projects", value: projects, icon: Package },
    { label: "Recipes", value: recipes, icon: BookMarked },
    { label: "Runs", value: runs, icon: PlayCircle },
  ];

  const doneCount = PHASES.filter((p) => p.status === "done").length;

  return (
    <div className="stagger space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of your automation workspace.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="hover:shadow-md">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardDescription>{s.label}</CardDescription>
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ember-soft text-ember-soft-foreground">
                  <Icon className="h-4 w-4" />
                </span>
              </CardHeader>
              <CardContent>
                <div className="font-display text-3xl font-semibold tracking-tight">{s.value}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <PhaseRail />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Build progress</CardTitle>
                <CardDescription>Implementation phases</CardDescription>
              </div>
              <Badge variant="ember">
                {doneCount}/{PHASES.length} shipped
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {PHASES.map((p) => (
              <div
                key={p.n}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              >
                <span className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-muted-foreground/60">
                    {String(p.n).padStart(2, "0")}
                  </span>
                  {p.name}
                </span>
                <Badge variant={p.status === "done" ? "emerald" : "ember"}>{p.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dev providers</CardTitle>
            <CardDescription>Configured via environment (swap for prod)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <ProviderRow label="LLM" value={process.env.LLM_PROVIDER ?? "fake"} />
            <ProviderRow label="Sandbox" value={process.env.SANDBOX_PROVIDER ?? "local"} />
            <ProviderRow label="Storage" value={process.env.STORAGE_PROVIDER ?? "local"} />
            <ProviderRow label="Queue" value={process.env.QUEUE_PROVIDER ?? "db"} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProviderRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
      <span className="text-sm text-muted-foreground">{label}</span>
      <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{value}</code>
    </div>
  );
}
