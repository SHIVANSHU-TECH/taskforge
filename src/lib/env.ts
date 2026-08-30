import { z } from "zod";

/**
 * Server-only environment schema. Validated lazily on first access so that
 * edge/middleware code (which must not import this) never triggers it.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  LLM_PROVIDER: z.enum(["fake", "groq", "anthropic", "openai"]).default("fake"),
  LLM_MODEL: z.string().default("fake-1"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),

  SANDBOX_PROVIDER: z.enum(["local", "e2b", "daytona", "docker"]).default("local"),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  // S3-compatible storage (AWS S3 / Cloudflare R2 / Supabase Storage / MinIO).
  // Required when STORAGE_PROVIDER=s3.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),

  QUEUE_PROVIDER: z.enum(["db", "redis"]).default("db"),

  // Optional: lets GitHub import reach private repos and lifts anonymous rate limits.
  GITHUB_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
