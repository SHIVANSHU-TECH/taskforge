/**
 * Provider-agnostic LLM interface. Vendor SDKs (Anthropic, OpenAI, ...) are only
 * ever touched inside an adapter that implements LlmProvider — never called directly
 * elsewhere in the codebase.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /**
   * Tool calls made by an `assistant` turn. Carried back into the next request
   * so a multi-turn tool loop stays coherent across providers.
   */
  toolCalls?: ToolCall[];
  /** Set on a `tool` turn: the id of the tool call this message answers. */
  toolCallId?: string;
  /** Set on a `tool` turn: the name of the tool this message answers (some providers require it). */
  toolName?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments (typically derived from a zod schema). */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end" | "tool_use" | "length" | "error";

export interface LlmResult {
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
  stopReason: StopReason;
}

export interface LlmCompleteInput {
  system?: string;
  messages: LlmMessage[];
  tools?: ToolDef[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly id: string;
  complete(input: LlmCompleteInput): Promise<LlmResult>;
}
