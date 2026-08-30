import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listRecipes } from "@/server/recipes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewRecipeForm } from "@/components/new-recipe-form";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function RecipesPage() {
  const user = await requireUser();
  const recipes = await listRecipes(user.organizationId);

  return (
    <div className="stagger space-y-6">
      <div>
        <p className="eyebrow text-muted-foreground/70">Library</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Task Recipes</h1>
        <p className="text-sm text-muted-foreground">
          Reusable modification definitions — prompt, typed inputs, QA checks, and reference
          examples the AI engine learns from.
        </p>
      </div>

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-6 py-4 text-sm font-medium">New recipe</summary>
        <div className="border-t p-6">
          <NewRecipeForm />
        </div>
      </details>

      {recipes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No recipes yet. Create one above to get started.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <Link key={r.id} href={`/recipes/${r.id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{r.name}</CardTitle>
                    <Badge variant={r.isActive ? "emerald" : "steel"} className="shrink-0">
                      {r.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {r.description || `${r.category ?? "Uncategorized"} recipe`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="steel" className="font-mono">v{r.latestVersion}</Badge>
                  <span>{r.inputCount} input{r.inputCount === 1 ? "" : "s"}</span>
                  <span>·</span>
                  <span>{r.qaCheckCount} QA</span>
                  <span>·</span>
                  <span>
                    {r.referenceCount} reference{r.referenceCount === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto">{formatDate(r.updatedAt)}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
