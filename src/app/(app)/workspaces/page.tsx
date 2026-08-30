import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewWorkspaceForm } from "@/components/new-workspace-form";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const user = await requireUser();
  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { projects: true } } },
  });

  return (
    <div className="stagger space-y-6">
      <div>
        <p className="eyebrow text-muted-foreground/70">Client work</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Workspaces</h1>
        <p className="text-sm text-muted-foreground">
          Group your client projects. Open a workspace to upload a ZIP or import from GitHub.
        </p>
      </div>

      <div className="max-w-xl">
        <NewWorkspaceForm />
      </div>

      {workspaces.length === 0 ? (
        <EmptyState message="No workspaces yet. Create one above to get started." />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {workspaces.map((w) => (
            <Link key={w.id} href={`/workspaces/${w.id}`} className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-base">{w.name}</CardTitle>
                  <CardDescription>
                    {w._count.projects} project{w._count.projects === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
