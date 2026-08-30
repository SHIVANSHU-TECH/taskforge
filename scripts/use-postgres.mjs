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
const swapped = original.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"sqlite"/,
  '$1"postgresql"',
);

if (swapped === original) {
  if (/datasource\s+db\s*\{[^}]*?provider\s*=\s*"postgresql"/.test(original)) {
    console.log("[use-postgres] datasource already postgresql — no change.");
  } else {
    console.error("[use-postgres] could not find a sqlite datasource to swap. Aborting.");
    process.exit(1);
  }
} else {
  writeFileSync(schemaPath, swapped, "utf8");
  console.log("[use-postgres] datasource provider set to postgresql.");
}
