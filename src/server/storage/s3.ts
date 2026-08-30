import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getEnv } from "../../lib/env";
import type { PutOptions, StorageProvider } from "./types";

/** Normalize + confine a storage key (forward-slash relative path). Mirrors LocalStorageProvider. */
function safeKey(key: string): string {
  const norm = key.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts: string[] = [];
  for (const seg of norm.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new Error(`Invalid storage key: ${key}`);
    parts.push(seg);
  }
  const clean = parts.join("/");
  if (!clean) throw new Error(`Invalid storage key: ${key}`);
  return clean;
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // Node.js runtime: the SDK returns a Readable stream for the object body.
  const stream = body as AsyncIterable<Uint8Array> | undefined;
  if (!stream || typeof (stream as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function") {
    // Fallback for web ReadableStream / Blob-like bodies.
    if (body && typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
      return Buffer.from(await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray());
    }
    throw new Error("Unsupported S3 object body type");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * S3-compatible object storage. Works with AWS S3, Cloudflare R2, Supabase
 * Storage, MinIO, and any S3 API. Configured entirely from env:
 *   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   S3_FORCE_PATH_STYLE (true for Supabase/MinIO, false/omit for R2/AWS).
 */
export class S3StorageProvider implements StorageProvider {
  readonly id = "s3";
  private client: S3Client;
  private bucket: string;

  constructor() {
    const env = getEnv();
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'STORAGE_PROVIDER="s3" requires S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.',
      );
    }
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      // R2 uses "auto"; AWS needs a real region. Endpoint is required for R2/Supabase/MinIO.
      region: env.S3_REGION ?? "auto",
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(key: string, data: Buffer | string, opts?: PutOptions): Promise<{ key: string }> {
    const k = safeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: k,
        Body: typeof data === "string" ? Buffer.from(data, "utf8") : data,
        ContentType: opts?.contentType,
      }),
    );
    return { key: k };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
    );
    return streamToBuffer(res.Body);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }
}
