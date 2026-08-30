import { getEnv } from "../../lib/env";
import { LocalSandboxProvider } from "./local";
import type { SandboxProvider } from "./types";

let cached: SandboxProvider | null = null;

export function getSandboxProvider(): SandboxProvider {
  if (cached) return cached;
  const env = getEnv();
  switch (env.SANDBOX_PROVIDER) {
    case "local":
      cached = new LocalSandboxProvider();
      return cached;
    case "e2b":
    case "daytona":
    case "docker":
      throw new Error(
        `Sandbox provider "${env.SANDBOX_PROVIDER}" is not wired yet (Phase 5). ` +
          `Set SANDBOX_PROVIDER=local for now.`,
      );
    default:
      throw new Error(`Unknown SANDBOX_PROVIDER: ${env.SANDBOX_PROVIDER as string}`);
  }
}

export type {
  SandboxProvider,
  SandboxHandle,
  ExecResult,
  ExecOptions,
  CreateSandboxInput,
} from "./types";
