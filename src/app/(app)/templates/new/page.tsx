import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewTemplateForm } from "@/components/new-template-form";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  await requireUser();

  return (
    <div className="stagger space-y-6">
      <div>
        <Link
          href="/templates"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Templates
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">New template</h1>
        <p className="text-sm text-muted-foreground">
          We extract and analyze the archive so its stack and file tree are browsable alongside your
          note.
        </p>
      </div>

      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reference details</CardTitle>
            <CardDescription>ZIP up to 100 MB. Env var values are never read.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewTemplateForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
