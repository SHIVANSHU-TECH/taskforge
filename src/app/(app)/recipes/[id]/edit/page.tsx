import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getRecipeDetail } from "@/server/recipes";
import { RecipeVersionEditor } from "@/components/recipe-version-editor";

export const dynamic = "force-dynamic";

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const recipe = await getRecipeDetail(user.organizationId, id);
  if (!recipe) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/recipes/${recipe.id}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {recipe.name}
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Edit recipe</h1>
        <p className="text-sm text-muted-foreground">
          Editing working draft v{recipe.head.version}. Save to keep iterating, or publish to freeze
          a version.
        </p>
      </div>

      <RecipeVersionEditor key={recipe.head.id} recipeId={recipe.id} version={recipe.head} />
    </div>
  );
}
