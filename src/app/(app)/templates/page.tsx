import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const user = await requireUser();
  const templates = await prisma.template.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="stagger space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-muted-foreground/70">Reference library</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Upload a reference implementation as a ZIP with a note on what to copy from it — a
            reusable playbook (e.g. how Stripe was wired up).
          </p>
        </div>
        <Link href="/templates/new" className={buttonVariants()}>
          <Plus className="mr-2 h-4 w-4" /> New template
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No templates yet. Add one to build up a library of reference implementations.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Link key={t.id} href={`/templates/${t.id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate text-base">{t.name}</CardTitle>
                    <Badge variant="steel" className="shrink-0">
                      {t.framework ?? "reference"}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">{t.prompt}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
