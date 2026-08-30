"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { INPUT_TYPES, QA_CHECK_TYPES, type InputType, type QaCheckType } from "@/lib/constants";
import {
  INPUT_TYPE_LABELS,
  QA_CHECK_LABELS,
  QA_CHECK_DESCRIPTIONS,
  type RecipeVersionDetail,
} from "@/server/recipes/types";
import { RecipeInputPreview } from "@/components/recipe-input-preview";
import { saveDraftAction, publishVersionAction } from "@/app/(app)/recipes/actions";

interface EditorOption {
  value: string;
  label: string;
}
interface EditorInput {
  key: string;
  label: string;
  type: InputType;
  required: boolean;
  placeholder: string;
  help: string;
  options: EditorOption[];
}
interface EditorQa {
  type: QaCheckType;
  enabled: boolean;
  required: boolean;
  config?: Record<string, unknown>;
}

function initInputs(version: RecipeVersionDetail): EditorInput[] {
  return version.inputs.map((i) => ({
    key: i.key,
    label: i.label,
    type: i.type,
    required: i.required,
    placeholder: i.placeholder ?? "",
    help: i.help ?? "",
    options: i.options ? i.options.map((o) => ({ ...o })) : [],
  }));
}

function initQa(version: RecipeVersionDetail): EditorQa[] {
  return QA_CHECK_TYPES.map((type) => {
    const existing = version.qaChecks.find((c) => c.type === type);
    return {
      type,
      enabled: !!existing,
      required: existing?.required ?? false,
      config: existing?.config,
    };
  });
}

export function RecipeVersionEditor({
  recipeId,
  version,
}: {
  recipeId: string;
  version: RecipeVersionDetail;
}) {
  const router = useRouter();

  const [prompt, setPrompt] = React.useState(version.prompt);
  const [systemPrompt, setSystemPrompt] = React.useState(version.systemPrompt ?? "");
  const [model, setModel] = React.useState(version.model ?? "");
  const [inputs, setInputs] = React.useState<EditorInput[]>(() => initInputs(version));
  const [qa, setQa] = React.useState<EditorQa[]>(() => initQa(version));

  const [dirty, setDirty] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [changelog, setChangelog] = React.useState("");
  const [saving, startSave] = React.useTransition();
  const [publishing, startPublish] = React.useTransition();

  // Any edit marks the draft dirty and clears the last saved/error notice.
  function touched() {
    setDirty(true);
    setStatus(null);
    setError(null);
  }

  function updateInput(index: number, patch: Partial<EditorInput>) {
    setInputs((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    touched();
  }
  function addInput() {
    const existing = new Set(inputs.map((i) => i.key));
    let n = inputs.length + 1;
    let key = `field${n}`;
    while (existing.has(key)) key = `field${++n}`;
    setInputs((prev) => [
      ...prev,
      { key, label: "", type: "text", required: false, placeholder: "", help: "", options: [] },
    ]);
    touched();
  }
  function removeInput(index: number) {
    setInputs((prev) => prev.filter((_, i) => i !== index));
    touched();
  }
  function updateOption(ii: number, oi: number, patch: Partial<EditorOption>) {
    setInputs((prev) =>
      prev.map((it, i) =>
        i === ii ? { ...it, options: it.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) } : it,
      ),
    );
    touched();
  }
  function addOption(ii: number) {
    setInputs((prev) =>
      prev.map((it, i) => (i === ii ? { ...it, options: [...it.options, { value: "", label: "" }] } : it)),
    );
    touched();
  }
  function removeOption(ii: number, oi: number) {
    setInputs((prev) =>
      prev.map((it, i) => (i === ii ? { ...it, options: it.options.filter((_, j) => j !== oi) } : it)),
    );
    touched();
  }
  function updateQa(index: number, patch: Partial<EditorQa>) {
    setQa((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
    touched();
  }

  function buildDraft() {
    return {
      prompt,
      systemPrompt: systemPrompt.trim() || undefined,
      model: model.trim() || undefined,
      inputs: inputs.map((i) => ({
        key: i.key.trim(),
        label: i.label.trim(),
        type: i.type,
        required: i.required,
        placeholder: i.placeholder.trim() || undefined,
        help: i.help.trim() || undefined,
        options:
          i.type === "select"
            ? i.options.map((o) => ({ value: o.value.trim(), label: o.label.trim() }))
            : undefined,
      })),
      qaChecks: qa
        .filter((q) => q.enabled)
        .map((q) => ({ type: q.type, required: q.required, config: q.config })),
    };
  }

  function save() {
    setStatus(null);
    setError(null);
    startSave(async () => {
      const res = await saveDraftAction(recipeId, version.id, buildDraft());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDirty(false);
      setStatus("Draft saved.");
      router.refresh();
    });
  }

  function publish() {
    setStatus(null);
    setError(null);
    startPublish(async () => {
      // Persist current edits first so the frozen version matches the editor.
      const saved = await saveDraftAction(recipeId, version.id, buildDraft());
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      const res = await publishVersionAction(recipeId, changelog);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChangelog("");
      setDirty(false);
      setStatus(`Published v${res.publishedVersion}. Now editing draft v${res.draftVersion}.`);
      router.refresh();
    });
  }

  // Live preview reflects the current (validated-enough) input definitions.
  const previewInputs = inputs
    .filter((i) => i.key.trim() && i.label.trim())
    .map((i) => ({
      key: i.key.trim(),
      label: i.label.trim(),
      type: i.type,
      required: i.required,
      placeholder: i.placeholder.trim() || undefined,
      help: i.help.trim() || undefined,
      options:
        i.type === "select"
          ? i.options
              .filter((o) => o.value.trim())
              .map((o) => ({ value: o.value.trim(), label: o.label.trim() || o.value.trim() }))
          : undefined,
    }));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-8">
        {/* Prompt */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Prompt</h2>
            <p className="text-sm text-muted-foreground">
              The instruction the AI engine follows. Reference input values as{" "}
              <code className="rounded bg-muted px-1">{"{{key}}"}</code>.
            </p>
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              touched();
            }}
            className="min-h-32 font-mono text-[13px]"
            placeholder="Replace the brand name and primary color throughout the site…"
          />
          <details className="rounded-md border bg-card">
            <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
              Advanced: system prompt &amp; model
            </summary>
            <div className="space-y-4 border-t p-4">
              <div className="space-y-1.5">
                <Label htmlFor="system-prompt">System prompt</Label>
                <Textarea
                  id="system-prompt"
                  value={systemPrompt}
                  onChange={(e) => {
                    setSystemPrompt(e.target.value);
                    touched();
                  }}
                  className="min-h-20 font-mono text-[13px]"
                  placeholder="Optional. Sets the AI's role and constraints."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="model">Model override</Label>
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    touched();
                  }}
                  placeholder="Provider default"
                  className="max-w-xs"
                />
              </div>
            </div>
          </details>
        </section>

        {/* Inputs */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Inputs</h2>
              <p className="text-sm text-muted-foreground">
                Typed fields an operator fills in when running this recipe.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addInput}>
              <Plus className="h-4 w-4" /> Add input
            </Button>
          </div>

          {inputs.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No inputs yet. The recipe will run with the prompt alone.
            </p>
          ) : (
            <div className="space-y-3">
              {inputs.map((input, i) => (
                <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={input.label}
                        onChange={(e) => updateInput(i, { label: e.target.value })}
                        placeholder="Brand color"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Key</Label>
                      <Input
                        value={input.key}
                        onChange={(e) => updateInput(i, { key: e.target.value })}
                        className="font-mono"
                        placeholder="brandColor"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={input.type}
                        onChange={(e) => updateInput(i, { type: e.target.value as InputType })}
                      >
                        {INPUT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {INPUT_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Placeholder</Label>
                      <Input
                        value={input.placeholder}
                        onChange={(e) => updateInput(i, { placeholder: e.target.value })}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Help text</Label>
                      <Input
                        value={input.help}
                        onChange={(e) => updateInput(i, { help: e.target.value })}
                        placeholder="Optional"
                      />
                    </div>
                  </div>

                  {input.type === "select" && (
                    <div className="space-y-2 rounded-md border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Options</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={() => addOption(i)}>
                          <Plus className="h-3.5 w-3.5" /> Option
                        </Button>
                      </div>
                      {input.options.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Add at least one option.</p>
                      ) : (
                        input.options.map((o, oi) => (
                          <div key={oi} className="flex items-center gap-2">
                            <Input
                              value={o.value}
                              onChange={(e) => updateOption(i, oi, { value: e.target.value })}
                              placeholder="value"
                              className="h-9 font-mono"
                            />
                            <Input
                              value={o.label}
                              onChange={(e) => updateOption(i, oi, { label: e.target.value })}
                              placeholder="Label"
                              className="h-9"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              onClick={() => removeOption(i, oi)}
                              aria-label="Remove option"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={input.required}
                        onChange={(e) => updateInput(i, { required: e.target.checked })}
                        className="h-4 w-4 rounded border-input"
                      />
                      Required
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeInput(i)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* QA checks */}
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">QA checks</h2>
            <p className="text-sm text-muted-foreground">
              Automated gates run in the sandbox after changes are applied (Phase 5).
            </p>
          </div>
          <div className="space-y-2">
            {qa.map((q, i) => (
              <div
                key={q.type}
                className="flex items-start justify-between gap-4 rounded-lg border bg-card p-3"
              >
                <label className="flex flex-1 items-start gap-3">
                  <input
                    type="checkbox"
                    checked={q.enabled}
                    onChange={(e) => updateQa(i, { enabled: e.target.checked })}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    <span className="text-sm font-medium">{QA_CHECK_LABELS[q.type]}</span>
                    <span className="block text-xs text-muted-foreground">
                      {QA_CHECK_DESCRIPTIONS[q.type]}
                    </span>
                  </span>
                </label>
                {q.enabled && (
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => updateQa(i, { required: e.target.checked })}
                      className="h-4 w-4 rounded border-input"
                    />
                    Required
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Save / publish bar */}
        <div className="sticky bottom-4 space-y-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={save} disabled={saving || publishing}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
            {dirty && !saving && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            {status && <span className="text-sm text-emerald-600 dark:text-emerald-400">{status}</span>}
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Input
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder={`Changelog for v${version.version} (optional)`}
              className="max-w-sm"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={publish}
              disabled={saving || publishing}
            >
              {publishing ? "Publishing…" : `Publish v${version.version}`}
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Publishing freezes v{version.version} as history and opens a fresh draft (v
              {version.version + 1}) for future edits.
            </p>
          </div>
        </div>
      </div>

      {/* Live preview */}
      <aside className="space-y-3">
        <div className="lg:sticky lg:top-4">
          <h2 className="text-sm font-semibold tracking-tight">Run form preview</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            How operators will see the inputs when running this recipe.
          </p>
          <div className="rounded-lg border bg-card p-4">
            <RecipeInputPreview inputs={previewInputs} disabled />
          </div>
        </div>
      </aside>
    </div>
  );
}
