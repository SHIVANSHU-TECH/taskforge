import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Github, Upload } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadZipForm } from "@/components/upload-zip-form";
import { ImportGithubForm } from "@/components/import-github-form";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function WorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const workspace = await prisma.workspace.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      projects: { include: { analysis: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!workspace) notFound();

  return (
    <div className="stagger space-y-6">
      <div>
        <Link
          href="/workspaces"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Workspaces
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{workspace.name}</h1>
        <p className="text-sm text-muted-foreground">
          {workspace.projects.length} project{workspace.projects.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" /> Upload a ZIP
            </CardTitle>
            <CardDescription>Upload a zipped project. We extract and analyze it.</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadZipForm workspaceId={workspace.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Github className="h-4 w-4" /> Import from GitHub
            </CardTitle>
            <CardDescription>Pull a repository straight from GitHub.</CardDescription>
          </CardHeader>
          <CardContent>
            <ImportGithubForm workspaceId={workspace.id} />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Projects</h2>
        {workspace.projects.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No projects yet. Upload a ZIP or import a repo above.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workspace.projects.map((p) => (
              <Link key={p.id} href={`/workspaces/${workspace.id}/projects/${p.id}`} className="block">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="truncate text-base">{p.name}</CardTitle>
                      <Badge variant="steel" className="shrink-0">{p.sourceType}</Badge>
                    </div>
                    <CardDescription>
                      {p.analysis?.framework ?? "Unrecognized stack"} · {formatDate(p.createdAt)}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
