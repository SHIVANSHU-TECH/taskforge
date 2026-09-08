import { getEnv } from "../../lib/env";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

let cached: StorageProvider | null = null;

function s3CredentialsPresent(): boolean {
  const env = getEnv();
  return Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

export function getStorageProvider(): StorageProvider {
  // Avoid stale provider after .env changes in `next dev`.
  if (cached && process.env.NODE_ENV === "production") return cached;

  const env = getEnv();
  switch (env.STORAGE_PROVIDER) {
    case "local":
      cached = new LocalStorageProvider();
      return cached;
    case "s3": {
      if (!s3CredentialsPresent()) {
        // Local/dev convenience: fall back so ZIP upload still works when
        // STORAGE_PROVIDER=s3 is set but credentials are missing/empty.
        // On Vercel, set S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY.
        if (process.env.VERCEL || process.env.NODE_ENV === "production") {
          throw new Error(
            'STORAGE_PROVIDER="s3" requires S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.',
          );
        }
        console.warn(
          '[storage] STORAGE_PROVIDER="s3" but S3 credentials are missing; falling back to local filesystem.',
        );
        cached = new LocalStorageProvider();
        return cached;
      }
      cached = new S3StorageProvider();
      return cached;
    }
    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${env.STORAGE_PROVIDER as string}`);
  }
}

export type { StorageProvider, PutOptions } from "./types";
