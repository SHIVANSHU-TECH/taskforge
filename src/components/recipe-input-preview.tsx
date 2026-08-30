"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { RecipeInputDef } from "@/server/recipes/types";

/**
 * Renders the form an operator fills in when running a recipe. Used as a live
 * preview in the recipe editor now, and reused for real input collection in
 * Phase 4. `disabled` makes it a pure, non-interactive preview.
 */
export function RecipeInputPreview({
  inputs,
  disabled = false,
}: {
  inputs: RecipeInputDef[];
  disabled?: boolean;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));

  if (inputs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No inputs defined. This recipe runs with the prompt alone.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {inputs.map((input) => {
        const id = `preview-${input.key}`;
        return (
          <div key={input.key} className="space-y-1.5">
            <Label htmlFor={id}>
              {input.label}
              {input.required && <span className="ml-1 text-destructive">*</span>}
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {input.key}
              </span>
            </Label>

            {input.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  disabled={disabled}
                  checked={values[input.key] === "true"}
                  onChange={(e) => set(input.key, e.target.checked ? "true" : "false")}
                  className="h-4 w-4 rounded border-input"
                />
                <span className="text-muted-foreground">{input.placeholder || "Enabled"}</span>
              </label>
            ) : input.type === "select" ? (
              <Select
                id={id}
                disabled={disabled}
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
                  disabled={disabled}
                  value={/^#[0-9a-fA-F]{6}$/.test(values[input.key] ?? "") ? values[input.key] : "#000000"}
                  onChange={(e) => set(input.key, e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded-md border border-input bg-background p-1 disabled:cursor-not-allowed"
                />
                <Input
                  disabled={disabled}
                  placeholder={input.placeholder || "#0f172a"}
                  value={values[input.key] ?? ""}
                  onChange={(e) => set(input.key, e.target.value)}
                  className="max-w-[10rem] font-mono"
                />
              </div>
            ) : input.type === "file" || input.type === "image" || input.type === "csv" ? (
              <Input
                id={id}
                type="file"
                disabled={disabled}
                accept={input.type === "image" ? "image/*" : input.type === "csv" ? ".csv" : undefined}
                className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
              />
            ) : (
              <Input
                id={id}
                type={input.type === "url" ? "url" : "text"}
                disabled={disabled}
                placeholder={input.placeholder || (input.type === "url" ? "https://…" : "")}
                value={values[input.key] ?? ""}
                onChange={(e) => set(input.key, e.target.value)}
              />
            )}

            {input.help && <p className="text-xs text-muted-foreground">{input.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
