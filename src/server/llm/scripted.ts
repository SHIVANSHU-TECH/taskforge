import type { LlmCompleteInput, LlmProvider, LlmResult, ToolCall } from "./types";

/**
 * Markers the engine uses to hand the scripted provider a machine-readable view
 * of the run inputs. Real model providers ignore these and read the prose; this
 * deterministic stand-in relies on them so the full execution pipeline can be
 * exercised locally with no API key.
 */
export const INPUTS_BLOCK_OPEN = "<taskforge:inputs>";
export const INPUTS_BLOCK_CLOSE = "</taskforge:inputs>";

interface ScriptedInput {
  key: string;
  label?: string;
  type?: string;
  value?: string;
}

/**
 * Deterministic, no-network provider for local dev and tests. It does NOT
 * reason — it applies a predictable heuristic: any pair of inputs that looks
 * like old→new (e.g. `oldName`/`newName`, or keys prefixed from/to) becomes a
 * project-wide `replace_in_files` call. Everything else is left to real models.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly id = "fake";

  async complete(input: LlmCompleteInput): Promise<LlmResult> {
    const inputs = extractInputs(input);
    const pairs = derivePairs(inputs);

    // Plan phase: engine calls without tools. Return a short deterministic plan.
    const hasTools = (input.tools?.length ?? 0) > 0;
    if (!hasTools) {
      const plan = pairs.length
        ? "Plan (scripted): apply project-wide replacements — " +
          pairs.map((p) => `"${p.find}" → "${p.replace}"`).join(", ") +
          ". Then finish."
        : "Plan (scripted): no old→new input pair detected, so no automatic edits will be made. " +
          "Connect a real LLM provider (LLM_PROVIDER=anthropic|openai) for open-ended changes.";
      return textResult(plan, input);
    }

    // Modify phase. If we've already acted (history has an assistant tool turn),
    // finish. Otherwise emit the replacement tool calls.
    const alreadyActed = input.messages.some((m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0);
    if (alreadyActed || pairs.length === 0) {
      const summary = pairs.length
        ? `Applied ${pairs.length} replacement${pairs.length === 1 ? "" : "s"} across the project.`
        : "No automatic edits (no old→new input pair detected).";
      return toolResult(
        [{ id: "call_finish", name: "finish", arguments: { summary } }],
        input,
      );
    }

    const calls: ToolCall[] = pairs.map((p, i) => ({
      id: `call_replace_${i}`,
      name: "replace_in_files",
      arguments: { find: p.find, replace: p.replace },
    }));
    return toolResult(calls, input);
  }
}

const OLD_PREFIXES = ["old", "from", "current", "previous", "prev", "source", "existing"];
const NEW_PREFIXES = ["new", "to", "target", "dest", "replacement", "updated"];

interface Pair {
  find: string;
  replace: string;
}

/**
 * Pair inputs that look like an old→new rename. Matches by shared remainder
 * after stripping a known prefix (oldName/newName → remainder "name"). Only
 * pairs with non-empty, distinct values are used.
 */
function derivePairs(inputs: ScriptedInput[]): Pair[] {
  const byKey = new Map(inputs.map((i) => [i.key.toLowerCase(), i]));
  const pairs: Pair[] = [];
  const used = new Set<string>();

  for (const input of inputs) {
    const lower = input.key.toLowerCase();
    if (used.has(lower)) continue;
    for (const op of OLD_PREFIXES) {
      if (!lower.startsWith(op)) continue;
      const remainder = lower.slice(op.length);
      for (const np of NEW_PREFIXES) {
        const counterpart = byKey.get(np + remainder);
        if (!counterpart) continue;
        const find = (input.value ?? "").trim();
        const replace = (counterpart.value ?? "").trim();
        if (find && replace && find !== replace) {
          pairs.push({ find, replace });
          used.add(lower);
          used.add((np + remainder));
        }
        break;
      }
      if (used.has(lower)) break;
    }
  }
  return pairs;
}

function extractInputs(input: LlmCompleteInput): ScriptedInput[] {
  const haystack =
    (input.system ?? "") + "\n" + input.messages.map((m) => m.content).join("\n");
  const start = haystack.indexOf(INPUTS_BLOCK_OPEN);
  const end = haystack.indexOf(INPUTS_BLOCK_CLOSE);
  if (start === -1 || end === -1 || end < start) return [];
  const json = haystack.slice(start + INPUTS_BLOCK_OPEN.length, end).trim();
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as ScriptedInput[]) : [];
  } catch {
    return [];
  }
}

function approxTokens(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

function inputTokens(input: LlmCompleteInput): number {
  return (
    approxTokens(input.system ?? "") +
    input.messages.reduce((n, m) => n + approxTokens(m.content), 0)
  );
}

function textResult(text: string, input: LlmCompleteInput): LlmResult {
  return {
    text,
    toolCalls: [],
    usage: { inputTokens: inputTokens(input), outputTokens: approxTokens(text) },
    stopReason: "end",
  };
}

function toolResult(calls: ToolCall[], input: LlmCompleteInput): LlmResult {
  const text = "";
  return {
    text,
    toolCalls: calls,
    usage: {
      inputTokens: inputTokens(input),
      outputTokens: approxTokens(JSON.stringify(calls)),
    },
    stopReason: "tool_use",
  };
}
