// Deploy-time datasource swap: SQLite (local dev) → PostgreSQL (production).
//
// Prisma requires the datasource `provider` to be a static string, so we cannot
// switch it via env alone. This script rewrites prisma/schema.prisma in place to
// use PostgreSQL, and is meant to run in the CI/host build step BEFORE
// `prisma generate` / `prisma db push` (see package.json "build:prod").
//
// It is idempotent and only edits the datasource block. Local dev leaves the
// committed schema on sqlite and never runs this.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "prisma", "schema.prisma");

const original = readFileSync(schemaPath, "utf8");

// Replace the provider line only inside the `datasource db { ... }` block.
let swapped = original.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"sqlite"/,
  '$1"postgresql"',
);

// Add a `directUrl` for migrations (Neon: pooled `url` for the app, direct
// `DATABASE_URL_UNPOOLED` for `prisma db push`). Insert right after the `url`
// line, and only if not already present.
if (!/directUrl\s*=/.test(swapped)) {
  swapped = swapped.replace(
    /(\n[ \t]*url\s*=\s*env\("DATABASE_URL"\))/,
    '$1\n  directUrl = env("DATABASE_URL_UNPOOLED")',
  );
}

if (swapped === original) {
  if (/datasource\s+db\s*\{[^}]*?provider\s*=\s*"postgresql"/.test(original)) {
    console.log("[use-postgres] datasource already postgresql — no change.");
  } else {
    console.error("[use-postgres] could not find a sqlite datasource to swap. Aborting.");
    process.exit(1);
  }
} else {
  writeFileSync(schemaPath, swapped, "utf8");
  console.log("[use-postgres] datasource provider set to postgresql (+ directUrl).");
}
