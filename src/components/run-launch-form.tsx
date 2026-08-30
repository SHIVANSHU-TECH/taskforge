"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { RunnableProject, RunnableRecipe } from "@/server/runs";
import { createRunAction } from "@/app/(app)/runs/actions";

export function RunLaunchForm({
  projects,
  recipes,
}: {
  projects: RunnableProject[];
  recipes: RunnableRecipe[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = React.useState("");
  const [recipeId, setRecipeId] = React.useState("");
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const recipe = recipes.find((r) => r.id === recipeId) ?? null;

  // Reset collected inputs when the recipe changes.
  React.useEffect(() => {
    setValues({});
  }, [recipeId]);

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createRunAction({ projectId, recipeId, inputs: values });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/runs/${res.runId}`);
      router.refresh();
    });
  }

  if (projects.length === 0 || recipes.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {projects.length === 0 ? (
          <p>
            No projects with a stored archive yet. Ingest a project in a workspace first, then come
            back to run a recipe against it.
          </p>
        ) : (
          <p>No active recipes. Create and activate a recipe before launching a run.</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="run-project">Project</Label>
          <Select id="run-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="" disabled>
              Choose a project…
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.workspaceName}
                {p.framework ? ` (${p.framework})` : ""}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="run-recipe">Recipe</Label>
          <Select id="run-recipe" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            <option value="" disabled>
              Choose a recipe…
            </option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (v{r.version})
              </option>
            ))}
          </Select>
        </div>
      </div>

      {recipe && (
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Inputs for {recipe.name}</p>
            {recipe.referenceTemplates.length > 0 && (
              <p className="text-xs text-muted-foreground">
                References: {recipe.referenceTemplates.join(", ")}
              </p>
            )}
          </div>
          {recipe.inputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This recipe takes no inputs — it runs from the prompt alone.
            </p>
          ) : (
            recipe.inputs.map((input) => {
              const id = `run-input-${input.key}`;
              return (
                <div key={input.key} className="space-y-1.5">
                  <Label htmlFor={id}>
                    {input.label}
                    {input.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>

                  {input.type === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        id={id}
                        type="checkbox"
                        checked={values[input.key] === "true"}
                        onChange={(e) => set(input.key, e.target.checked ? "true" : "false")}
                        className="h-4 w-4 rounded border-input"
                      />
                      <span className="text-muted-foreground">{input.placeholder || "Enabled"}</span>
                    </label>
                  ) : input.type === "select" ? (
                    <Select
                      id={id}
                      value={values[input.key] ?? ""}
                      onChange={(e) => set(input.key, e.target.value)}
                    >
                      <option value="" disabled>
                        {input.placeholder || "Choose…"}
                      </option>
                      {(input.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : input.type === "color" ? (
                    <div className="flex items-center gap-2">
                      <input
                        id={id}
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(values[input.key] ?? "") ? values[input.key] : "#000000"}
                        onChange={(e) => set(input.key, e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1"
                      />
                      <Input
                        placeholder={input.placeholder || "#0f172a"}
                        value={values[input.key] ?? ""}
                        onChange={(e) => set(input.key, e.target.value)}
                        className="max-w-[10rem] font-mono"
                      />
                    </div>
                  ) : input.type === "file" || input.type === "image" || input.type === "csv" ? (
                    <Input
                      id={id}
                      type="text"
                      placeholder={input.placeholder || "Paste a URL or value (uploads arrive with delivery)"}
                      value={values[input.key] ?? ""}
                      onChange={(e) => set(input.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={id}
                      type={input.type === "url" ? "url" : "text"}
                      placeholder={input.placeholder || (input.type === "url" ? "https://…" : "")}
                      value={values[input.key] ?? ""}
                      onChange={(e) => set(input.key, e.target.value)}
                    />
                  )}

                  {input.help && <p className="text-xs text-muted-foreground">{input.help}</p>}
                </div>
              );
            })
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={pending || !projectId || !recipeId}>
        {pending ? "Launching…" : "Launch run"}
      </Button>
    </form>
  );
}
