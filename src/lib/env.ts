import { z } from "zod";

/** Treat missing / blank env values as unset so `.optional()` works with Vercel empty keys. */
const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/**
 * Server-only environment schema. Validated lazily on first access so that
 * edge/middleware code (which must not import this) never triggers it.
 *
 * Each var is read as `process.env.NAME` (not `process.env` wholesale) so Next.js
 * static analysis / bundling can resolve server env correctly.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Direct (non-pooled) Postgres URL for migrations / `prisma db push` / pg_dump.
  // On Neon this is the "-pooler"-less host; wired as Prisma `directUrl` in prod.
  DATABASE_URL_UNPOOLED: z.preprocess(emptyToUndef, z.string().optional()),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  LLM_PROVIDER: z.enum(["fake", "groq", "anthropic", "openai", "neon"]).default("fake"),
  LLM_MODEL: z.string().default("fake-1"),
  GROQ_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai"),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  ANTHROPIC_BASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  OPENAI_BASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  // Neon AI Gateway (OpenAI-compatible). BASE_URL is the bare branch host
  // (e.g. https://<branch>-api.ai.<region>.aws.neon.tech); the adapter appends
  // /v1/chat/completions. TOKEN is the nt_live_... credential.
  NEON_AI_GATEWAY_BASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  NEON_AI_GATEWAY_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),

  SANDBOX_PROVIDER: z.enum(["local", "e2b", "daytona", "docker"]).default("local"),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  // S3-compatible storage (AWS S3 / Cloudflare R2 / Supabase Storage / MinIO).
  // Required when STORAGE_PROVIDER=s3.
  S3_ENDPOINT: z.preprocess(emptyToUndef, z.string().url().optional()),
  S3_REGION: z.preprocess(emptyToUndef, z.string().optional()),
  S3_BUCKET: z.preprocess(emptyToUndef, z.string().optional()),
  S3_ACCESS_KEY_ID: z.preprocess(emptyToUndef, z.string().optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  S3_FORCE_PATH_STYLE: z.preprocess(
    emptyToUndef,
    z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
  ),

  QUEUE_PROVIDER: z.enum(["db", "redis"]).default("db"),

  // Optional: lets GitHub import reach private repos and lifts anonymous rate limits.
  GITHUB_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Explicit key map — required for reliable Next.js server env resolution. */
function readRawEnv(): Record<string, string | undefined> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_BASE_URL: process.env.GROQ_BASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    NEON_AI_GATEWAY_BASE_URL: process.env.NEON_AI_GATEWAY_BASE_URL,
    NEON_AI_GATEWAY_TOKEN: process.env.NEON_AI_GATEWAY_TOKEN,
    SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER,
    STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    QUEUE_PROVIDER: process.env.QUEUE_PROVIDER,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  };
}

export function getEnv(): Env {
  // In dev, never cache — .env edits + HMR otherwise leave STORAGE_PROVIDER=s3
  // with stale/missing S3_* and break ZIP upload until a full restart.
  if (cached && process.env.NODE_ENV === "production") return cached;

  const parsed = schema.safeParse(readRawEnv());
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
