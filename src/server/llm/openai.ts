import type {
  LlmCompleteInput,
  LlmMessage,
  LlmProvider,
  LlmResult,
  StopReason,
  ToolCall,
} from "./types";

const DEFAULT_MAX_TOKENS = 8192;

/**
 * OpenAI Chat Completions adapter (also compatible with Azure/OpenAI-style
 * gateways via OPENAI_BASE_URL). HTTP-only, no SDK.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly id = "openai";
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async complete(input: LlmCompleteInput): Promise<LlmResult> {
    const messages = toOpenAiMessages(input.system, input.messages);
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
    };
    if (typeof input.temperature === "number") body.temperature = input.temperature;
    if (input.tools?.length) {
      body.tools = input.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!res.ok) {
      const detail = await safeText(res);
      throw new Error(`OpenAI API error ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as OpenAiResponse;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseArgs(tc.function.arguments),
    }));

    return {
      text: text ?? "",
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      stopReason: mapStopReason(choice?.finish_reason),
    };
  }
}

function toOpenAiMessages(system: string | undefined, messages: LlmMessage[]): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
    } else if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: stringifyArgs(tc.arguments) },
        }));
      }
      out.push(msg);
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content });
    } else {
      out.push({ role: "user", content: m.content });
    }
  }
  return out;
}

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "length";
    case "stop":
      return "end";
    default:
      return "end";
  }
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function stringifyArgs(args: unknown): string {
  return typeof args === "string" ? args : JSON.stringify(args ?? {});
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "(no body)";
  }
}

interface OpenAiResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
