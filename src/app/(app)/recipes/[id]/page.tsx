import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRecipeDetail, listTemplatesForOrg } from "@/server/recipes";
import { INPUT_TYPE_LABELS, QA_CHECK_LABELS } from "@/server/recipes/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecipeActiveToggle } from "@/components/recipe-active-toggle";
import { RecipeInputPreview } from "@/components/recipe-input-preview";
import { AddReferenceForm } from "@/components/add-reference-form";
import { RecipeTemplatesPicker } from "@/components/recipe-templates-picker";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const recipe = await getRecipeDetail(user.organizationId, id);
  if (!recipe) notFound();

  const orgTemplates = await listTemplatesForOrg(user.organizationId);

  const projectRows = await prisma.project.findMany({
    where: { workspace: { organizationId: user.organizationId }, storageKey: { not: null } },
    select: { id: true, name: true, workspace: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const projects = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    workspaceName: p.workspace.name,
  }));

  const head = recipe.head;
  const published = recipe.versions.filter((v) => v.id !== head.id);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/recipes"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Task Recipes
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{recipe.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {recipe.category && <Badge variant="steel">{recipe.category}</Badge>}
              <Badge variant={recipe.isActive ? "emerald" : "steel"}>
                {recipe.isActive ? "Active" : "Inactive"}
              </Badge>
              <span className="font-mono text-xs">{recipe.slug}</span>
            </div>
            {recipe.description && (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{recipe.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <RecipeActiveToggle recipeId={recipe.id} isActive={recipe.isActive} />
            <Link href={`/recipes/${recipe.id}/edit`}>
              <Button size="sm">
                <Pencil className="h-4 w-4" /> Edit draft
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {/* Draft overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Working draft
                <Badge variant="steel" className="font-mono">v{head.version}</Badge>
              </CardTitle>
              <CardDescription>
                Model: {head.model || "provider default"}
                {head.systemPrompt ? " · custom system prompt" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Prompt
                </h3>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-[13px] leading-relaxed">
                  {head.prompt}
                </pre>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Inputs
                </h3>
                {head.inputs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No inputs — runs on the prompt alone.</p>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Label</th>
                          <th className="px-3 py-2 font-medium">Key</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Required</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {head.inputs.map((i) => (
                          <tr key={i.key}>
                            <td className="px-3 py-2">{i.label}</td>
                            <td className="px-3 py-2 font-mono text-xs">{i.key}</td>
                            <td className="px-3 py-2">{INPUT_TYPE_LABELS[i.type]}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {i.required ? "Yes" : "No"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  QA checks
                </h3>
                {head.qaChecks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No QA checks configured.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {head.qaChecks.map((c) => (
                      <Badge key={c.type} variant="steel">
                        {QA_CHECK_LABELS[c.type]}
                        {c.required ? " *" : ""}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* References */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reference examples</CardTitle>
              <CardDescription>
                Completed before/after pairs teach the AI what a good result looks like.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {head.references.length > 0 && (
                <ul className="space-y-2">
                  {head.references.map((ref) => (
                    <li
                      key={ref.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{ref.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(ref.createdAt)}
                          {ref.promptUsed ? " · prompt captured" : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {ref.hasDiff && (
                          <Link
                            href={`/recipes/${recipe.id}/references/${ref.id}`}
                            className="text-xs text-primary underline-offset-4 hover:underline"
                          >
                            View diff
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <AddReferenceForm
                recipeId={recipe.id}
                recipeVersionId={head.id}
                projects={projects}
              />
            </CardContent>
          </Card>

          {/* Linked reference implementations (Templates) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Linked templates</CardTitle>
              <CardDescription>
                Whole reference projects the AI is handed on every run of this recipe — its note plus
                relevant files are injected as a concrete implementation to mimic.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecipeTemplatesPicker
                recipeId={recipe.id}
                templates={orgTemplates}
                linkedIds={recipe.linkedTemplates.map((t) => t.id)}
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: preview + history */}
        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Run form preview</CardTitle>
            </CardHeader>
            <CardContent>
              <RecipeInputPreview inputs={head.inputs} disabled />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Version history</CardTitle>
            </CardHeader>
            <CardContent>
              {published.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No published versions yet. v{head.version} is a draft.
                </p>
              ) : (
                <ul className="space-y-3">
                  {published.map((v) => (
                    <li key={v.id} className="text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="steel" className="font-mono">v{v.version}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(v.createdAt)}</span>
                      </div>
                      {v.changelog && <p className="mt-1 text-muted-foreground">{v.changelog}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
