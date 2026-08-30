"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toggleActiveAction } from "@/app/(app)/recipes/actions";

export function RecipeActiveToggle({
  recipeId,
  isActive,
}: {
  recipeId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [active, setActive] = React.useState(isActive);
  const [pending, startTransition] = React.useTransition();

  function toggle() {
    startTransition(async () => {
      const next = !active;
      const res = await toggleActiveAction(recipeId, next);
      if (res.ok) {
        setActive(res.isActive);
        router.refresh();
      }
    });
  }

  return (
    <Button variant={active ? "outline" : "default"} size="sm" onClick={toggle} disabled={pending}>
      {pending ? "Saving…" : active ? "Deactivate" : "Activate"}
    </Button>
  );
}
