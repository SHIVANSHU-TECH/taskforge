import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { listRunnableTargets } from "@/server/runs";
import { RunLaunchForm } from "@/components/run-launch-form";

export const dynamic = "force-dynamic";

export default async function NewRunPage() {
  const user = await requireUser();
  const { projects, recipes } = await listRunnableTargets(user.organizationId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/runs"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to runs
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">New run</h1>
        <p className="text-sm text-muted-foreground">
          Pick a project and a recipe, fill in the recipe&apos;s inputs, and launch. The engine
          analyzes, plans, and applies the change, then hands off to QA.
        </p>
      </div>

      <RunLaunchForm projects={projects} recipes={recipes} />
    </div>
  );
}
