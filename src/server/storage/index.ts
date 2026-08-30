import { getEnv } from "../../lib/env";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const env = getEnv();
  switch (env.STORAGE_PROVIDER) {
    case "local":
      cached = new LocalStorageProvider();
      return cached;
    case "s3":
      cached = new S3StorageProvider();
      return cached;
    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER as string}`);
  }
}

export type { StorageProvider, PutOptions } from "./types";
