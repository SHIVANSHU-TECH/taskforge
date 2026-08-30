"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setRecipeTemplatesAction } from "@/app/(app)/recipes/actions";

interface TemplateOption {
  id: string;
  name: string;
  framework: string | null;
}

export function RecipeTemplatesPicker({
  recipeId,
  templates,
  linkedIds,
}: {
  recipeId: string;
  templates: TemplateOption[];
  linkedIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(linkedIds));
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const initial = React.useMemo(() => new Set(linkedIds), [linkedIds]);
  const dirty =
    selected.size !== initial.size || [...selected].some((id) => !initial.has(id));

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No templates yet. Upload a reference implementation under Templates, then link it here so the
        AI mimics it when running this recipe.
      </p>
    );
  }

  function toggle(id: string) {
    setOk(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSave() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await setRecipeTemplatesAction(recipeId, { templateIds: [...selected] });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOk(
        res.count === 0
          ? "No templates linked — runs use recipe prompt + diff examples only."
          : `Linked ${res.count} template${res.count === 1 ? "" : "s"}.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-1.5">
        {templates.map((t) => {
          const checked = selected.has(t.id);
          return (
            <li key={t.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(t.id)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                <Badge variant="steel" className="shrink-0">
                  {t.framework ?? "reference"}
                </Badge>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {ok && <p className="text-sm text-emerald-600 dark:text-emerald-400">{ok}</p>}

      <Button size="sm" onClick={onSave} disabled={pending || !dirty}>
        {pending ? "Saving…" : "Save linked templates"}
      </Button>
    </div>
  );
}
