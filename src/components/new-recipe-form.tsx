"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { COMMON_CATEGORIES } from "@/server/recipes/types";
import { createRecipeAction } from "@/app/(app)/recipes/actions";

export function NewRecipeForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createRecipeAction({
        name,
        category: category || undefined,
        description: description || undefined,
        prompt,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/recipes/${res.recipeId}/edit`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="recipe-name">Name</Label>
          <Input
            id="recipe-name"
            placeholder="Rebrand marketing site"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recipe-category">Category</Label>
          <Input
            id="recipe-category"
            list="recipe-categories"
            placeholder="Rebranding"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id="recipe-categories">
            {COMMON_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recipe-description">Description</Label>
        <Textarea
          id="recipe-description"
          placeholder="What this recipe does and when to use it."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-16"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recipe-prompt">Initial prompt</Label>
        <Textarea
          id="recipe-prompt"
          placeholder="Describe the change the AI should make. You can refine this and add inputs next."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="min-h-28"
        />
        <p className="text-xs text-muted-foreground">
          You&apos;ll add typed inputs, QA checks, and reference examples on the next screen.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create recipe"}
      </Button>
    </form>
  );
}
