# TaskForge AI

Internal AI task-automation platform. Ingest a client project → pick a **Recipe** →
collect inputs → an AI engine plans & applies changes using real before/after
reference examples → automated QA in a sandbox → repair on failure → preview →
deliver to the client.

This repo is being built in phases. **Phase 1 (Foundation)** is in place: auth, database,
app shell, the worker process, and the provider interfaces the rest of the system plugs into.

## Requirements

- Node 20+ (tested on 22)
- npm

No Docker/Postgres/Redis needed for local dev — see "Architecture choices" below.

## Quick start

```bash
npm install
cp .env.example .env        # then edit AUTH_SECRET etc.
npm run db:push             # create the SQLite database from the schema
npm run db:seed             # create the owner account + a Default workspace
npm run dev                 # http://localhost:3000
```

Sign in with the seeded credentials printed by `db:seed`
(defaults: `owner@taskforge.local` / `changeme123` — change these in `.env`).

Run the background worker in a second terminal:

```bash
npm run worker
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` | Prisma generate + Next.js production build |
| `npm run start` | Start the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run worker` | Long-running job worker (DB queue poller) |
| `npm run db:push` | Sync the Prisma schema to the database |
| `npm run db:seed` | Seed org + owner + default workspace |
| `npm run db:studio` | Prisma Studio (DB browser) |

## Architecture choices (dev vs prod)

Everything untrusted runs behind a provider interface, chosen by env var, so dev runs with
**zero external services** and production swaps adapters without touching app logic.

| Concern | Dev (now) | Prod target | Env |
| --- | --- | --- | --- |
| Repo | single Next.js app + `worker/` | app on Vercel/Render, worker on Render | — |
| Database | SQLite (Prisma) | PostgreSQL | `DATABASE_URL` (+ change datasource provider) |
| Queue | DB `Job` table + poller | Redis / BullMQ | `QUEUE_PROVIDER` |
| Storage | local `./.storage` | S3 / R2 | `STORAGE_PROVIDER` |
| LLM | `FakeLlmProvider` | Anthropic / OpenAI | `LLM_PROVIDER` + API key |
| Sandbox | local dev adapter (files only) | managed sandbox (e2b/daytona) or Docker | `SANDBOX_PROVIDER` |
| Auth | `jose` JWT cookie + bcrypt | same | `AUTH_SECRET` |

> **Why the sandbox can't live on Vercel:** `npm install` / build / Playwright on untrusted
> client projects cannot run in serverless functions (ephemeral, time-limited, read-only FS,
> no browser deps). The web app **enqueues** work; the **worker** executes it via
> `SandboxProvider`. This split is deliberate.

### Portable schema note

SQLite has no native enums or JSON column type, so the Prisma schema models "enum" fields as
`String` (validated in `src/lib/constants.ts`) and JSON payloads as `*Json` string columns.
This keeps one schema portable to Postgres later.

## Layout

```
src/
  app/            Next.js App Router (login, dashboard, workspaces, recipes, runs, auth API)
  components/     UI (shadcn-style primitives + app shell)
  lib/            env, db, auth/session, password, constants, utils
  server/         provider interfaces + dev adapters (llm / sandbox / storage / queue)
  middleware.ts   route protection
worker/           long-running job worker (uses the DB queue)
prisma/           schema + seed
```

## Roadmap

1. **Foundation** ✅ — auth, DB, app shell, worker, provider interfaces
2. Workspaces & ingestion (ZIP + GitHub, project analyzer)
3. Recipe system (versioned prompts, typed inputs, QA checks, reference library, diff engine)
4. AI execution engine (real LLM adapter, agentic loop: analyze/plan/modify)
5. Sandbox + QA engine (install/tsc/lint/build, Playwright, visual, repair loop)
6. Preview & client delivery
7. Seed recipes (Rebranding, GA4, GHL, Endorsely/PAP, Coupon/CSV)
8. Hardening (security, tests, deploy)

See `MASTER_CURSOR_PROMPT.md` for the full specification.
"# taskforge" 
