import { getEnv } from "../../lib/env";
import { AnthropicLlmProvider } from "./anthropic";
import { OpenAiLlmProvider } from "./openai";
import { ScriptedLlmProvider } from "./scripted";
import type { LlmProvider } from "./types";

let cached: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cached) return cached;
  const env = getEnv();
  switch (env.LLM_PROVIDER) {
    case "fake":
      cached = new ScriptedLlmProvider();
      return cached;
    case "groq":
      if (!env.GROQ_API_KEY) {
        throw new Error("LLM_PROVIDER=groq requires GROQ_API_KEY to be set.");
      }
      // Groq exposes an OpenAI-compatible Chat Completions API, so it reuses the
      // OpenAI adapter pointed at Groq's base URL.
      cached = new OpenAiLlmProvider(env.GROQ_API_KEY, env.GROQ_BASE_URL);
      return cached;
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set.");
      }
      cached = new AnthropicLlmProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_BASE_URL);
      return cached;
    case "openai":
      if (!env.OPENAI_API_KEY) {
        throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY to be set.");
      }
      cached = new OpenAiLlmProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL);
      return cached;
    case "neon":
      if (!env.NEON_AI_GATEWAY_TOKEN || !env.NEON_AI_GATEWAY_BASE_URL) {
        throw new Error(
          "LLM_PROVIDER=neon requires NEON_AI_GATEWAY_TOKEN and NEON_AI_GATEWAY_BASE_URL to be set.",
        );
      }
      // Neon AI Gateway is OpenAI-compatible, so it reuses the OpenAI adapter
      // pointed at the branch's gateway host.
      cached = new OpenAiLlmProvider(env.NEON_AI_GATEWAY_TOKEN, env.NEON_AI_GATEWAY_BASE_URL);
      return cached;
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${env.LLM_PROVIDER as string}`);
  }
}

/** Resolve the model id for a run: recipe override → env default. */
export function resolveModel(recipeModel?: string | null): string {
  return recipeModel?.trim() || getEnv().LLM_MODEL;
}

export type {
  LlmProvider,
  LlmCompleteInput,
  LlmResult,
  LlmMessage,
  ToolDef,
  ToolCall,
  StopReason,
} from "./types";
