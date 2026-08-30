/**
 * Provider-agnostic sandbox interface. All execution of untrusted project code
 * (install/build/tsc/lint/e2e) goes through an adapter of this interface — never
 * in the web app and never in a serverless function.
 */

export interface SandboxHandle {
  id: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CreateSandboxInput {
  /** Storage key of a project archive to hydrate into the sandbox. */
  projectArchiveKey?: string;
  nodeVersion?: string;
  env?: Record<string, string>;
}

export interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
}

export interface SandboxProvider {
  readonly id: string;
  create(input: CreateSandboxInput): Promise<SandboxHandle>;
  writeFile(handle: SandboxHandle, path: string, contents: string): Promise<void>;
  readFile(handle: SandboxHandle, path: string): Promise<string>;
  exec(handle: SandboxHandle, cmd: string, opts?: ExecOptions): Promise<ExecResult>;
  startServer(handle: SandboxHandle, cmd: string, port: number): Promise<{ url: string }>;
  snapshotArchive(handle: SandboxHandle): Promise<{ storageKey: string }>;
  destroy(handle: SandboxHandle): Promise<void>;
}
