import type {
  LlmCompleteInput,
  LlmMessage,
  LlmProvider,
  LlmResult,
  StopReason,
  ToolCall,
} from "./types";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Anthropic Messages API adapter. Talks HTTP directly (no SDK) to keep the
 * dependency surface small. Vendor specifics live here and nowhere else.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly id = "anthropic";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.anthropic.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async complete(input: LlmCompleteInput): Promise<LlmResult> {
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: toAnthropicMessages(input.messages),
    };
    if (input.system) body.system = input.system;
    if (typeof input.temperature === "number") body.temperature = input.temperature;
    if (input.tools?.length) {
      body.tools = input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!res.ok) {
      const detail = await safeText(res);
      throw new Error(`Anthropic API error ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id ?? "", name: block.name ?? "", arguments: block.input });
      }
    }

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      stopReason: mapStopReason(data.stop_reason),
    };
  }
}

function toAnthropicMessages(messages: LlmMessage[]): unknown[] {
  const out: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];
  for (const m of messages) {
    if (m.role === "system") continue; // handled via top-level `system`
    if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      // Tool results are carried on a user turn in the Anthropic format.
      out.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content },
        ],
      });
    } else {
      out.push({ role: "user", content: [{ type: "text", text: m.content }] });
    }
  }
  return out;
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "length";
    case "end_turn":
    case "stop_sequence":
      return "end";
    default:
      return "end";
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "(no body)";
  }
}

interface AnthropicResponse {
  content?: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}
