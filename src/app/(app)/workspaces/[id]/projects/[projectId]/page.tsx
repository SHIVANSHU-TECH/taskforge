import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileTree } from "@/components/file-tree";
import { formatBytes } from "@/server/ingestion/analyze";
import type { FileTreeNode } from "@/server/ingestion/types";

export const dynamic = "force-dynamic";

function parse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const DEP_DISPLAY_CAP = 80;

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string; projectId: string }>;
}) {
  const user = await requireUser();
  const { id: workspaceId, projectId } = await params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, workspace: { id: workspaceId, organizationId: user.organizationId } },
    include: { analysis: true },
  });
  if (!project) notFound();

  const a = project.analysis;
  const scripts = parse<Record<string, string>>(a?.scriptsJson, {});
  const entryPoints = parse<string[]>(a?.entryPointsJson, []);
  const envVars = parse<string[]>(a?.envVarsDetectedJson, []);
  const dependencies = parse<string[]>(a?.dependenciesJson, []);
  const fileTree = parse<FileTreeNode | null>(a?.fileTreeJson, null);

  const shownDeps = dependencies.slice(0, DEP_DISPLAY_CAP);
  const hiddenDeps = dependencies.length - shownDeps.length;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Framework", value: a?.framework ?? "—" },
    { label: "Package manager", value: a?.packageManager ?? "—" },
    { label: "Node", value: a?.nodeVersion ?? "—" },
    { label: "Files", value: a?.fileCount != null ? a.fileCount.toLocaleString() : "—" },
    { label: "Size", value: a?.sizeBytes != null ? formatBytes(a.sizeBytes) : "—" },
  ];

  return (
    <div className="stagger space-y-6">
      <div>
        <Link
          href={`/workspaces/${workspaceId}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to workspace
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant="steel">{project.sourceType}</Badge>
        </div>
        {project.sourceRef && (
          <p className="text-sm text-muted-foreground">{project.sourceRef}</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardDescription>{s.label}</CardDescription>
              <CardTitle className="truncate text-lg" title={s.value}>
                {s.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scripts</CardTitle>
            <CardDescription>From package.json</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(scripts).length === 0 ? (
              <p className="text-sm text-muted-foreground">No scripts detected.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {Object.entries(scripts).map(([name, cmd]) => (
                  <div key={name} className="grid grid-cols-[8rem_1fr] gap-2">
                    <dt className="font-medium">{name}</dt>
                    <dd className="truncate font-mono text-muted-foreground" title={cmd}>
                      {cmd}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entry points</CardTitle>
            <CardDescription>Likely app entry files found in the tree</CardDescription>
          </CardHeader>
          <CardContent>
            {entryPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">None detected.</p>
            ) : (
              <ul className="space-y-1 font-mono text-sm text-muted-foreground">
                {entryPoints.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Environment variables{" "}
            <span className="font-mono font-normal text-muted-foreground">({envVars.length})</span>
          </CardTitle>
          <CardDescription>Names referenced in code — values are never read or stored.</CardDescription>
        </CardHeader>
        <CardContent>
          {envVars.length === 0 ? (
            <p className="text-sm text-muted-foreground">None detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {envVars.map((v) => (
                <Badge key={v} variant="outline" className="font-mono">
                  {v}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Dependencies{" "}
            <span className="font-mono font-normal text-muted-foreground">({dependencies.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dependencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dependencies detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {shownDeps.map((d) => (
                <Badge key={d} variant="outline" className="font-mono">
                  {d}
                </Badge>
              ))}
              {hiddenDeps > 0 && (
                <span className="text-sm text-muted-foreground">+{hiddenDeps} more</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project files</CardTitle>
          <CardDescription>Extracted tree (build artifacts and node_modules excluded)</CardDescription>
        </CardHeader>
        <CardContent>
          {fileTree ? (
            <div className="max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-3">
              <FileTree root={fileTree} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No file tree available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
