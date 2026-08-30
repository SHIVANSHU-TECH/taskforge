/** Provider-agnostic blob storage interface (project archives, diffs, screenshots, bundles). */

export interface PutOptions {
  contentType?: string;
}

export interface StorageProvider {
  readonly id: string;
  put(key: string, data: Buffer | string, opts?: PutOptions): Promise<{ key: string }>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
