import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileTree } from "@/components/file-tree";
import { DeleteTemplateButton } from "@/components/delete-template-button";
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

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const template = await prisma.template.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { recipes: { select: { id: true, name: true }, orderBy: { updatedAt: "desc" } } },
  });
  if (!template) notFound();

  const scripts = parse<Record<string, string>>(template.scriptsJson, {});
  const entryPoints = parse<string[]>(template.entryPointsJson, []);
  const envVars = parse<string[]>(template.envVarsDetectedJson, []);
  const dependencies = parse<string[]>(template.dependenciesJson, []);
  const fileTree = parse<FileTreeNode | null>(template.fileTreeJson, null);

  const shownDeps = dependencies.slice(0, DEP_DISPLAY_CAP);
  const hiddenDeps = dependencies.length - shownDeps.length;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Framework", value: template.framework ?? "—" },
    { label: "Package manager", value: template.packageManager ?? "—" },
    { label: "Node", value: template.nodeVersion ?? "—" },
    { label: "Files", value: template.fileCount != null ? template.fileCount.toLocaleString() : "—" },
    { label: "Size", value: template.sizeBytes != null ? formatBytes(template.sizeBytes) : "—" },
  ];

  return (
    <div className="stagger space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/templates"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Templates
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{template.name}</h1>
            <Badge variant="steel">{template.framework ?? "reference"}</Badge>
          </div>
          {template.sourceRef && (
            <p className="font-mono text-sm text-muted-foreground">{template.sourceRef}</p>
          )}
        </div>
        <DeleteTemplateButton templateId={template.id} />
      </div>

      <Card className="border-ember/30 bg-ember-soft/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4 text-ember" /> What to take from it
          </CardTitle>
          <CardDescription>The note guiding what to copy or reuse from this reference.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{template.prompt}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Used by recipes</CardTitle>
          <CardDescription>
            Recipes that hand this reference to the AI on every run. Link it from a recipe&apos;s
            detail page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {template.recipes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Not linked to any recipe yet. Open a recipe and add it under “Linked templates.”
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {template.recipes.map((r) => (
                <Link
                  key={r.id}
                  href={`/recipes/${r.id}`}
                  className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
                >
                  {r.name}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
              {hiddenDeps > 0 && <span className="text-sm text-muted-foreground">+{hiddenDeps} more</span>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reference files</CardTitle>
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
