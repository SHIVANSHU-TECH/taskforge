import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { getStorageProvider } from "../storage";
import type {
  CreateSandboxInput,
  ExecOptions,
  ExecResult,
  SandboxHandle,
  SandboxProvider,
} from "./types";

const BASE = path.join(os.tmpdir(), "taskforge-sandboxes");

/** Default per-command wall-clock cap. Install/build get longer via ExecOptions. */
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
/** Cap captured output per stream so a chatty build can't blow up memory/logs. */
const MAX_STREAM_CHARS = 256 * 1024;

/** Directories never included in a snapshot (deps/build output/VCS). */
const SNAPSHOT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
]);
/** Skip individual files larger than this in a snapshot (kept lean for preview bundles). */
const SNAPSHOT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/** How long a preview server has to start accepting connections before we give up. */
const SERVER_READY_TIMEOUT_MS = 60_000;

/** Resolve once a TCP connection to the port succeeds, false on error/timeout. */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll a port until it accepts connections, the server exits early, or we time out. */
async function waitForPort(port: number, timeoutMs: number, exitedEarly: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitedEarly()) return false;
    if (await checkPort(port)) return true;
    await sleep(400);
  }
  return false;
}

/** Confine a relative path to the sandbox root (prevents traversal). */
function resolveInRoot(root: string, p: string): string {
  const full = path.resolve(root, p);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes sandbox root: ${p}`);
  }
  return full;
}

/** Keep the tail of a stream (build/compiler errors surface at the end). */
function appendCapped(existing: string, chunk: string): string {
  const combined = existing + chunk;
  return combined.length > MAX_STREAM_CHARS ? combined.slice(combined.length - MAX_STREAM_CHARS) : combined;
}

/** Best-effort process-tree kill (Node's child.kill leaves grandchildren on Windows). */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * LOCAL DEV ADAPTER — NOT a security boundary.
 *
 * Runs real commands and real file ops in a per-sandbox temp directory so the QA
 * engine can be exercised end-to-end without a managed sandbox. It does NOT
 * isolate the host: commands run as the current user with normal filesystem and
 * network access. Production isolation is provided by swapping in a managed
 * sandbox (e2b/daytona) or a Docker worker behind this same interface — set
 * SANDBOX_PROVIDER accordingly. Execution always happens in the long-running
 * Worker, never in a serverless function.
 */
export class LocalSandboxProvider implements SandboxProvider {
  readonly id = "local";
  private roots = new Map<string, string>();
  private envs = new Map<string, Record<string, string>>();
  private servers = new Map<string, ChildProcess[]>();

  async create(input: CreateSandboxInput): Promise<SandboxHandle> {
    await fs.mkdir(BASE, { recursive: true });
    const dir = await fs.mkdtemp(path.join(BASE, "sbx-"));
    const id = path.basename(dir);
    this.roots.set(id, dir);
    if (input.env) this.envs.set(id, input.env);

    if (input.projectArchiveKey) {
      const buf = await getStorageProvider().get(input.projectArchiveKey);
      const zip = new AdmZip(buf);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const full = resolveInRoot(dir, entry.entryName);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, entry.getData());
      }
    }
    return { id };
  }

  private root(handle: SandboxHandle): string {
    const r = this.roots.get(handle.id);
    if (!r) throw new Error(`Unknown sandbox: ${handle.id}`);
    return r;
  }

  async writeFile(handle: SandboxHandle, filePath: string, contents: string): Promise<void> {
    const full = resolveInRoot(this.root(handle), filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, contents, "utf8");
  }

  async readFile(handle: SandboxHandle, filePath: string): Promise<string> {
    const full = resolveInRoot(this.root(handle), filePath);
    return fs.readFile(full, "utf8");
  }

  async exec(handle: SandboxHandle, cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    const root = this.root(handle);
    const cwd = opts?.cwd ? resolveInRoot(root, opts.cwd) : root;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const start = Date.now();

    return new Promise<ExecResult>((resolve) => {
      const child = spawn(cmd, {
        cwd,
        shell: true,
        windowsHide: true,
        detached: process.platform !== "win32", // own process group so we can kill the tree
        env: {
          ...process.env,
          ...(this.envs.get(handle.id) ?? {}),
          CI: "1",
          // Keep installs non-interactive and quiet.
          npm_config_fund: "false",
          npm_config_audit: "false",
          ADBLOCK: "1",
        },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, durationMs: Date.now() - start, timedOut });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
      }, timeoutMs);

      child.stdout?.on("data", (d: Buffer) => {
        stdout = appendCapped(stdout, d.toString("utf8"));
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr = appendCapped(stderr, d.toString("utf8"));
      });
      child.on("error", (err) => {
        stderr = appendCapped(stderr, `\n[spawn error] ${err.message}`);
        finish(-1);
      });
      child.on("close", (code) => finish(code ?? -1));
    });
  }

  /**
   * Launch a long-running preview server for the project and wait until it
   * accepts connections. The command inherits the sandbox env plus `PORT`/`HOST`
   * (most dev servers honor these). The child is tracked and torn down by
   * `destroy`. This adapter binds to loopback only — it is a dev convenience,
   * not a hardened public preview (production uses a managed sandbox that
   * exposes a proper URL).
   */
  async startServer(handle: SandboxHandle, cmd: string, port: number): Promise<{ url: string }> {
    const root = this.root(handle);
    const child = spawn(cmd, {
      cwd: root,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...(this.envs.get(handle.id) ?? {}),
        PORT: String(port),
        HOST: "127.0.0.1",
      },
    });

    const list = this.servers.get(handle.id) ?? [];
    list.push(child);
    this.servers.set(handle.id, list);

    let earlyExit: string | null = null;
    child.on("exit", (code) => {
      earlyExit = `server process exited (code ${code ?? "unknown"})`;
    });
    child.on("error", (err) => {
      earlyExit = `spawn error: ${err.message}`;
    });

    const ready = await waitForPort(port, SERVER_READY_TIMEOUT_MS, () => earlyExit !== null);
    if (!ready) {
      killTree(child.pid);
      throw new Error(
        `Preview server did not become ready on port ${port}` + (earlyExit ? ` — ${earlyExit}.` : " (timed out)."),
      );
    }
    return { url: `http://127.0.0.1:${port}` };
  }

  async snapshotArchive(handle: SandboxHandle): Promise<{ storageKey: string }> {
    const root = this.root(handle);
    const zip = new AdmZip();

    const walk = async (dir: string, rel: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SNAPSHOT_EXCLUDE_DIRS.has(entry.name)) continue;
          await walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name);
        } else if (entry.isFile()) {
          const abs = path.join(dir, entry.name);
          const stat = await fs.stat(abs);
          if (stat.size > SNAPSHOT_MAX_FILE_BYTES) continue;
          zip.addFile(rel ? `${rel}/${entry.name}` : entry.name, await fs.readFile(abs));
        }
      }
    };
    await walk(root, "");

    const key = `sandbox-snapshots/${handle.id}-${randomUUID()}.zip`;
    await getStorageProvider().put(key, zip.toBuffer(), { contentType: "application/zip" });
    return { storageKey: key };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    for (const child of this.servers.get(handle.id) ?? []) killTree(child.pid);
    this.servers.delete(handle.id);

    const r = this.roots.get(handle.id);
    if (r) {
      await fs.rm(r, { recursive: true, force: true });
      this.roots.delete(handle.id);
      this.envs.delete(handle.id);
    }
  }
}
