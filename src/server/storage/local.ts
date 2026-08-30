import { promises as fs } from "node:fs";
import path from "node:path";
import { getEnv } from "../../lib/env";
import type { PutOptions, StorageProvider } from "./types";

/** Normalize + confine a storage key (forward-slash relative path). */
function safeKey(key: string): string {
  const norm = path.posix.normalize(key).replace(/^(\.\.(\/|$))+/, "");
  if (norm === "" || norm.startsWith("..") || norm.startsWith("/")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return norm;
}

/** Local filesystem storage for dev. Swap STORAGE_PROVIDER=s3 in production. */
export class LocalStorageProvider implements StorageProvider {
  readonly id = "local";
  private base: string;

  constructor(baseDir?: string) {
    this.base = path.resolve(baseDir ?? getEnv().STORAGE_LOCAL_DIR);
  }

  private full(key: string): string {
    return path.join(this.base, safeKey(key));
  }

  async put(key: string, data: Buffer | string, _opts?: PutOptions): Promise<{ key: string }> {
    const full = this.full(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
    return { key };
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.full(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.full(key), { force: true });
  }
}
