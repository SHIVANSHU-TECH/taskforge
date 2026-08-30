# TaskForge AI — Master Build Specification (Cursor Prompt)

> **Paste this entire document into Cursor as the first message of a new project.**
> It establishes vision, architecture, data model, and the rules Cursor must follow.
> It deliberately does **not** ask Cursor to build everything at once. Step 0 tells Cursor
> to analyze and plan first. You will then feed smaller implementation prompts one at a time.

---

## 0. Instructions to Cursor (read first, obey strictly)

You are a **senior full-stack engineer** building a production application called **TaskForge AI**.

**Do not implement the whole application in response to this message.** Your first and only job right now is to:

1. Read this entire specification.
2. Confirm your understanding of the product, architecture, and constraints in a short summary.
3. Produce an **implementation plan** broken into ordered phases (see §35), each phase being small enough to build and verify independently.
4. Produce the **database schema** (§6) and **folder structure** (§7) as concrete files, and nothing else.
5. **Stop and wait.** Do not write feature code until I send a per-phase implementation prompt.

**Absolute rules for all future work in this project:**

- **No fake implementations.** No mocked returns, no `// TODO: implement`, no hardcoded sample data standing in for real logic, unless a stub is explicitly requested and clearly labeled `// STUB (phase N)`.
- **No placeholder AI calls.** The LLM and sandbox layers are real interfaces with real adapters.
- **Type-safe end to end.** `strict: true`. No `any` unless justified in a comment. No `@ts-ignore` without a reason.
- **Server-only secrets.** No API keys, tokens, or provider credentials in client bundles. Validate all env vars at boot with a schema (`zod`).
- **Untrusted input everywhere.** Every uploaded ZIP, GitHub repo, and client project is untrusted. Treat file paths, filenames, and file contents as hostile (path traversal, zip-slip, symlinks, oversized files).
- **Every external boundary is validated** with `zod` (API request/response, env, LLM tool arguments, recipe inputs).
- **Errors are typed and surfaced**, never swallowed. User-facing errors are actionable; internal errors are logged with correlation IDs.
- **Match the codebase.** Follow existing patterns, naming, and structure once established. Ask before introducing a new library.
- When a per-phase prompt arrives, follow the **prompt template in §34** and honor its `DO NOT DO` list.

If any requirement here is ambiguous or conflicts with a platform limitation, **flag it in your plan** rather than guessing.

---

## 1. Product vision

TaskForge AI is an **internal automation platform** for a development agency/operator who repeatedly performs the **same categories of modification** on client web projects — rebranding, adding analytics, wiring integrations, mapping data — and delivers the finished project to the client.

The core insight and competitive advantage: **the operator already has a library of completed jobs** — the original project, the finished project, the exact prompt used, the inputs provided, and the resulting diff. TaskForge turns each of these into a reusable, self-improving **Recipe** with **reference examples**, so new jobs are executed by an AI engine that has concrete before/after ground truth to imitate, not just a naked instruction.

**Loop:** ingest a new project → pick a Recipe → collect inputs → AI plans and applies changes using the recipe's reference examples → automated QA in a sandbox → repair on failure → preview → package and deliver to the client.

---

## 2. Users & scope (v1)

- **Single tenant, internal.** One organization. The operator and optionally a small team log in. **No client-facing logins.** Clients receive **delivery links and reports only** (unauthenticated, tokenized, expiring URLs).
- **No billing/subscriptions** in v1.
- **Roles:** `owner`, `member` (can run tasks), `viewer` (read-only). Keep roles in the schema even though v1 usage is small.
- **SaaS-readiness is NOT a v1 goal**, but do not paint yourself into a corner: keep an `organizationId` (or `workspaceId`) foreign key on all tenant-scoped tables so a future multi-tenant switch is additive, not a rewrite.

---

## 3. Complete feature set

```text
TaskForge AI
├── Dashboard                     # runs overview, recent projects, QA status, activity
├── Workspaces                    # logical grouping of projects
│   ├── Upload ZIP
│   ├── Import GitHub
│   ├── Project Analyzer          # detect framework, package manager, scripts, structure
│   └── Project Files             # browse/inspect ingested files
├── Task Recipes                  # reusable modification definitions
│   ├── Rebranding
│   ├── GA4
│   ├── GHL Webhook
│   ├── Endorsely
│   ├── PAP
│   ├── Coupon API
│   └── Custom Tasks
├── Reference Library             # ground-truth examples per recipe
│   ├── Original Project
│   ├── Completed Project
│   ├── Prompt
│   ├── Inputs
│   ├── Diff
│   └── QA Results
├── AI Execution
│   ├── Analyze
│   ├── Plan
│   ├── Modify
│   ├── Validate
│   └── Repair
├── QA
│   ├── Build
│   ├── TypeScript
│   ├── Lint
│   ├── API
│   ├── E2E
│   └── Visual
├── Preview
└── Client Delivery
    ├── Preview URL
    ├── QA Report
    ├── Change Log
    └── Final Project
```

---

## 4. Recommended tech stack

- **Framework:** Next.js (App Router) + React + TypeScript (`strict`).
- **Styling/UI:** Tailwind CSS + shadcn/ui + lucide-react icons.
- **Validation:** zod (env, API, forms, LLM tool args, recipe inputs).
- **Database:** PostgreSQL. **ORM:** Prisma. (Provider e.g. Neon/Supabase/Render Postgres — connection string via env only.)
- **Auth:** Auth.js (NextAuth v5) with email/password or a single OAuth provider; sessions in the DB. Keep it simple — internal tool.
- **Background jobs / queue:** a durable queue — **BullMQ + Redis** (recommended), or a DB-backed job table if Redis is unavailable. Long-running work (ingestion, AI runs, QA) **must not** run inside request handlers.
- **File/object storage:** S3-compatible bucket (AWS S3 / Cloudflare R2 / Supabase Storage). Store uploaded ZIPs, extracted trees (as archives), diffs, screenshots, and delivery bundles here — **not** on the app server's local disk (Vercel has no persistent disk).
- **LLM:** provider-agnostic `LLMProvider` interface (§15). Adapters for Anthropic Claude and OpenAI. Model IDs and keys via env.
- **Sandbox/execution:** provider-agnostic `SandboxProvider` interface (§22). Default adapter = a managed sandbox API; scale adapter = self-hosted Docker worker on Render.
- **Testing:** Vitest (unit), Playwright (E2E + visual). ESLint + Prettier.
- **Observability:** structured logging (pino), error tracking (Sentry optional), per-run correlation IDs.

> Pin exact versions in `package.json` when scaffolding. Prefer the current stable major of each library.

---

## 5. High-level architecture

TaskForge is **three cooperating processes**, not one:

```text
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Web App (Next.js)          │        │  Worker (Node service)        │
│  - UI (dashboard, recipes)  │  jobs  │  - consumes queue             │
│  - API routes / actions     │ ─────► │  - ingestion, AI runs, QA     │
│  - auth, DB reads/writes    │ Redis  │  - talks to LLMProvider       │
│  - enqueues jobs            │ ◄───── │  - talks to SandboxProvider   │
│  Host: Vercel OR Render     │ status │  Host: Render (long-running)  │
└─────────────┬───────────────┘        └───────────────┬──────────────┘
              │                                         │
              │                    ┌────────────────────▼───────────────┐
        ┌─────▼──────┐             │  SandboxProvider                    │
        │ Postgres   │             │  - managed sandbox API (default), or│
        │ (Prisma)   │             │  - Docker worker (scale path)       │
        └─────┬──────┘             │  runs: install/build/lint/tsc/e2e   │
              │                    └─────────────────────────────────────┘
        ┌─────▼──────┐
        │ Object     │  ZIPs, extracted archives, diffs, screenshots, delivery bundles
        │ Storage(S3)│
        └────────────┘
```

**Critical platform constraint (must be honored):** `npm install`, `build`, `tsc`, `lint`, and Playwright **cannot run inside Vercel/serverless functions** (ephemeral, time-limited, read-only FS, no browser system deps, no Docker). They run **only** in the Worker via the `SandboxProvider`. The web app **enqueues** work and **reads status/results**; it never executes untrusted project code itself.

---

## 6. Data model (Prisma — produce this in step 0)

Design the schema to cover at least the following entities. Names are guidance; refine as needed but keep the relationships.

- **Organization** — single row in v1; FK anchor for future multi-tenancy.
- **User** — `email`, `role` (`owner|member|viewer`), auth fields.
- **Workspace** — `name`, `organizationId`. Groups projects.
- **Project** — `workspaceId`, `name`, `sourceType` (`zip|github`), `sourceRef` (repo URL/commit or upload id), `storageKey` (archive in S3), detected metadata (see ProjectAnalysis).
- **ProjectAnalysis** — `projectId`, `framework`, `packageManager`, `scripts` (json), `nodeVersion`, `entryPoints` (json), `envVarsDetected` (json), `fileCount`, `sizeBytes`.
- **ProjectFile** — optional index of notable files (path, size, hash) for browsing; do not store all blobs in Postgres.
- **Recipe** — `name`, `slug`, `description`, `category`, `isActive`.
- **RecipeVersion** — `recipeId`, `version`, `prompt` (the modification prompt), `systemPrompt`, `model` (optional override), `changelog`. Prompts are **versioned**; runs pin a version.
- **RecipeInput** — `recipeVersionId`, `key`, `label`, `type` (`text|color|url|file|image|csv|boolean|select`), `required`, `options` (json), `validation` (json/zod descriptor). Drives the dynamic input form (§16).
- **RecipeQACheck** — `recipeVersionId`, `type` (`build|typescript|lint|api|e2e|visual|branding`), `config` (json). Which QA gates apply.
- **ReferenceExample** — `recipeVersionId`, `title`, `originalStorageKey`, `completedStorageKey`, `promptUsed`, `inputs` (json), `diffStorageKey`, `qaResult` (json). The **before/after ground truth**.
- **Run** — a single execution: `projectId`, `recipeVersionId`, `status` (`queued|analyzing|planning|modifying|validating|repairing|passed|failed|delivered|canceled`), `inputs` (json), `startedAt`, `finishedAt`, `error`, `correlationId`.
- **RunStep** — `runId`, `phase`, `status`, `startedAt`, `finishedAt`, `logStorageKey`, `tokensIn`, `tokensOut`, `costEstimate`. Full audit trail.
- **Diff** — `runId`, `storageKey` (unified diff / patch), `filesChanged`, `insertions`, `deletions`, `summary`.
- **QAResult** — `runId`, `check` (matches RecipeQACheck.type), `status` (`pass|fail|skip`), `details` (json), `artifactStorageKey` (screenshots, reports).
- **DeliveryArtifact** — `runId`, `previewUrl`, `qaReportStorageKey`, `changeLogStorageKey`, `finalBundleStorageKey`, `shareToken`, `expiresAt`.
- **AuditLog** — `userId`, `action`, `entity`, `entityId`, `metadata`, `createdAt`.

All tenant-scoped tables carry `organizationId`. Timestamps (`createdAt`, `updatedAt`) on everything.

---

## 7. Folder structure

```text
taskforge/
├── apps/
│   ├── web/                     # Next.js app (UI + API + enqueue). Vercel/Render.
│   │   ├── app/                 # App Router routes
│   │   ├── components/          # shadcn/ui + feature components
│   │   ├── lib/                 # client/server utils, auth, db client
│   │   └── ...
│   └── worker/                  # Node long-running service. Render.
│       ├── src/
│       │   ├── jobs/            # ingestion, run, qa job handlers
│       │   ├── engine/          # AI orchestration loop
│       │   ├── sandbox/         # SandboxProvider adapters
│       │   └── index.ts         # queue consumer bootstrap
│       └── ...
├── packages/
│   ├── db/                      # Prisma schema + client + migrations
│   ├── core/                    # shared domain types, zod schemas, recipe engine
│   ├── llm/                     # LLMProvider interface + adapters
│   ├── sandbox/                 # SandboxProvider interface + adapters
│   └── config/                  # env schema, shared config
├── package.json                 # workspaces (pnpm recommended)
└── ...
```

> Use a **pnpm workspace monorepo**. The web app and worker share `packages/*`. If you prefer a single app + separate worker without a monorepo, justify it in the plan — but the app/worker split is mandatory.

---

## 8. Authentication

- Auth.js (NextAuth v5), DB session strategy, Prisma adapter.
- Email/password (hashed with a modern KDF) **or** a single OAuth provider — your call, keep it minimal.
- Middleware guards all authenticated routes. Public routes: sign-in, and tokenized delivery pages (§27).
- Role checks in server actions/API handlers, not just UI.

---

## 9. Workspace architecture

- Users see workspaces within the org; a project always belongs to exactly one workspace.
- Workspace switcher in the app shell.
- All queries scoped by `workspaceId`; authorization checked server-side.

---

## 10. Project ingestion (ZIP + GitHub)

**ZIP upload:**
- Accept upload → store raw ZIP in S3 → enqueue an ingestion job.
- Worker extracts **safely**: reject zip-slip (`..`, absolute paths), symlinks, files over a size cap, archives over a total-size/entry-count cap. Skip `node_modules`, `.git`, build outputs on extract (configurable).
- Re-archive the clean tree to S3 as the canonical project snapshot.

**GitHub import:**
- Accept repo URL (+ optional branch/PAT for private). Shallow clone in the worker sandbox, not the web app.
- Store the same canonical snapshot in S3.

**Both paths feed the Project Analyzer.**

---

## 11. Project Analyzer

Runs in the worker after ingestion. Detects and records into `ProjectAnalysis`:
- Framework (Next.js/Vite/CRA/Astro/plain node/etc.) via config files + dependencies.
- Package manager (lockfile-based: pnpm/yarn/npm).
- Available scripts (`build`, `dev`, `start`, `lint`, `test`).
- Node version hints (`.nvmrc`, `engines`).
- Entry points and notable files (analytics snippets, layout files, env usage).
- Detected env vars referenced in code (names only — never values).

This analysis is fed to the AI engine as context.

---

## 12. Reference Recipe system

A **Recipe** is a versioned, reusable modification definition:
- Metadata + a **versioned prompt** (`RecipeVersion`), so you can iterate prompts without losing history and pin runs to a version.
- A set of **typed inputs** (`RecipeInput`) that generate a dynamic form (§16).
- A set of **QA checks** (`RecipeQACheck`) that gate success.
- Zero or more **reference examples** (§13).

CRUD UI to create/edit recipes, edit the prompt, add inputs, toggle QA checks, and manage versions. Cloning a recipe version to iterate is first-class.

---

## 13. Prompt/version management & before/after storage (Reference Library)

- Every prompt edit creates a new `RecipeVersion` (immutable once a run has used it).
- **Reference examples** capture real completed jobs: upload the **original** project and the **completed** project (ZIPs → S3), the exact prompt/inputs used, and let the system compute and store the **diff** and any known **QA result**.
- The Reference Library UI lets you browse examples per recipe: original vs completed, the prompt, inputs, the diff, and QA outcome.
- These examples are retrieved at run time (§15) as concrete few-shot ground truth for the engine.

---

## 14. Diff engine

- Compute unified diffs between two project trees (original vs modified, and original vs completed for references).
- Ignore-list aware (`node_modules`, lockfiles optional, build output).
- Output: per-file patches, files-changed/insertions/deletions summary, and a human-readable change summary. Store patch in S3, summary in Postgres.
- Used for: reference examples, run change logs, and delivery.

---

## 15. AI orchestration engine (provider-agnostic)

**`LLMProvider` interface** (in `packages/llm`) — adapters for Anthropic and OpenAI, chosen via env/config. Never call a vendor SDK directly outside its adapter.

```ts
export interface LlmMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string }
export interface ToolDef { name: string; description: string; parameters: JSONSchema } // zod-derived
export interface ToolCall { id: string; name: string; arguments: unknown }
export interface LlmResult {
  text: string
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
  stopReason: 'end' | 'tool_use' | 'length' | 'error'
}
export interface LlmProvider {
  readonly id: string
  complete(input: {
    system?: string
    messages: LlmMessage[]
    tools?: ToolDef[]
    model: string
    temperature?: number
    maxTokens?: number
    signal?: AbortSignal
  }): Promise<LlmResult>
}
```

**Agentic loop** (in `packages/core` / `apps/worker/engine`) drives the five AI Execution phases. The model is given **tools** to operate on the sandboxed project:

- `read_file(path)`, `list_dir(path)`, `search(query)`
- `write_file(path, contents)`, `apply_patch(diff)`
- `run_command(cmd)` — **only** through the SandboxProvider, allow-listed commands
- `finish(summary)`

**Phases:**
1. **Analyze** — engine assembles context: ProjectAnalysis + relevant files + the recipe prompt + **retrieved reference examples** (before/after + diff for this recipe) + collected inputs.
2. **Plan** — model produces a concrete, ordered change plan (files to touch, why). Persist as a `RunStep`. (Optionally require plan approval for high-risk recipes.)
3. **Modify** — model executes the plan via tools inside the sandbox. Enforce max iterations, max tokens, timeouts.
4. **Validate** — hand off to the QA engine (§23).
5. **Repair** — on QA failure, feed the failing check's output back to the model (§30) for a bounded number of repair attempts, re-validating each time.

Every phase logs tokens, cost estimate, and full transcript (to S3, referenced by `RunStep`). All loops are **bounded** (iterations, wall-clock, tokens) and cancelable via `AbortSignal`.

**Reference retrieval:** for the chosen recipe, pull its `ReferenceExample`s (start simple — most recent / best-QA examples for that recipe version; leave room for embeddings-based similarity later). Include original→completed diffs so the model imitates a proven transformation.

---

## 16. Dynamic input collection

- `RecipeInput` definitions render a **dynamically generated, zod-validated form** per run.
- Types: `text`, `color` (picker), `url`, `file`, `image` (logo/favicon), `csv`, `boolean`, `select`.
- File/image/csv inputs upload to S3 and pass references into the run.
- Validate on client and server; required inputs block run start.

---

## 17–21. Recipe workflows (seed recipes)

Implement these as **data-driven recipes** (prompt + inputs + QA checks + reference examples), not hardcoded branches. The engine is generic; recipes differ only by their configuration.

- **§17 Rebranding** — inputs: brand name, logo, favicon, color palette, optional reference site. QA: build, branding check (old brand strings/assets absent, new present), visual check, E2E.
- **§18 GA4** — inputs: measurement ID, placement prefs. QA: build, GA4 script/tag present and firing (detect in built output / via Playwright network), E2E.
- **§19 GHL webhook** — inputs: webhook URL, event mapping, field mapping. QA: build, form/submit posts to webhook (intercept in E2E), API check.
- **§20 Endorsely / PAP (affiliate)** — inputs: program/site IDs, script snippet, placement. QA: build, tracking script present and initialized, E2E.
- **§21 Coupon API + CSV/site-ID mapping** — inputs: API endpoint/keys, CSV mapping of site IDs → values. QA: build, API integration returns expected shape, mapping applied correctly.

Each ships with at least one **reference example** slot (the operator uploads their real completed job).

---

## 22. Sandbox execution (provider-agnostic)

**`SandboxProvider` interface** (in `packages/sandbox`). The engine and QA layer depend only on this interface.

```ts
export interface SandboxHandle { id: string }
export interface ExecResult { exitCode: number; stdout: string; stderr: string; durationMs: number; timedOut: boolean }
export interface SandboxProvider {
  readonly id: string
  create(input: { projectArchiveKey: string; nodeVersion?: string; env?: Record<string,string> }): Promise<SandboxHandle>
  writeFile(h: SandboxHandle, path: string, contents: string): Promise<void>
  readFile(h: SandboxHandle, path: string): Promise<string>
  exec(h: SandboxHandle, cmd: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<ExecResult>
  startServer(h: SandboxHandle, cmd: string, port: number): Promise<{ url: string }> // for E2E/preview
  snapshotArchive(h: SandboxHandle): Promise<{ storageKey: string }> // modified tree back to S3
  destroy(h: SandboxHandle): Promise<void>
}
```

**Adapters:**
- **Default (v1): managed sandbox API** (E2B / Daytona / Modal-style ephemeral micro-VM/container). Zero infra to operate; strong isolation out of the box; callable from a Vercel- or Render-hosted worker. Recommended starting point.
- **Scale path: self-hosted Docker worker on Render.** Each run gets a fresh container from a pinned base image; no network egress except allow-listed; CPU/mem/pids/disk limits; hard wall-clock timeout; container destroyed after the run.

**Hard rule:** never `exec` arbitrary project scripts in the web app or in a Vercel function. All execution is via `SandboxProvider` in the worker.

---

## 23. QA engine

Runs in the worker against the sandbox after Modify. Configurable per recipe via `RecipeQACheck`. Pipeline (stop-on-hard-fail or collect-all, configurable):

```text
install → typescript (tsc --noEmit) → lint → build → start app → API checks → Playwright E2E → visual QA → PASS/FAIL
```

Each check writes a `QAResult` (status + details + artifacts). A run is `passed` only if all **required** checks pass.

- **Build** — package-manager-aware install + build; capture logs.
- **TypeScript** — `tsc --noEmit`, parse diagnostics.
- **Lint** — project's lint script or a sane default; report errors vs warnings.
- **API** — recipe-defined HTTP assertions against the started app or external integration.
- **E2E** — Playwright flows (§24).
- **Visual** — screenshots + analysis (§25).
- **Branding** (for rebranding) — assert old brand strings/assets absent and new present.

---

## 24. Playwright testing

- Playwright runs **in the worker/sandbox**, never in the web app.
- Start the built app in the sandbox (`startServer`), get its URL, run flows: page loads, key user journeys, form submissions, network interception (verify GA4 hit, GHL webhook POST, affiliate script load).
- Capture traces, videos, and screenshots to S3; reference them from `QAResult`.
- Recipe-specific flows are defined per recipe; provide a small library of reusable flow primitives.

---

## 25. Visual QA

- Capture screenshots at defined breakpoints of key pages.
- Compare against a reference (from the recipe's reference example) where available (pixel/perceptual diff), and/or run a **multimodal LLM check** ("does the logo/brand/color match these inputs? any obvious layout breakage?") via the `LLMProvider` (vision-capable model).
- Produce a pass/fail with annotated evidence.

---

## 26. Preview environments

- After a passing run, the modified project can be served for preview.
- v1: build a static/exported preview or run the app in a preview sandbox and expose a **temporary URL**; store artifacts in S3. Keep this behind the `SandboxProvider`/hosting abstraction — do not couple the UI to a specific preview mechanism.
- Preview URL is included in the delivery bundle.

---

## 27. Client delivery

- A **DeliveryArtifact** bundles: **Preview URL**, **QA Report** (human-readable, from QAResults), **Change Log** (from the diff summary), and the **Final Project** (downloadable archive from S3).
- Exposed via a **tokenized, expiring, unauthenticated** share page (`shareToken`, `expiresAt`). No client login. Revocable.
- Delivery is an explicit, confirmed action by an authenticated user — never automatic.

---

## 28. Logging & observability

- Structured logs (pino) with a **correlationId per run** threaded through app → queue → worker → sandbox.
- `RunStep` records phase timings, token usage, cost estimates.
- Full LLM transcripts and command logs stored in S3, referenced from the DB.
- Optional Sentry for exceptions. A run's timeline is viewable in the UI.

---

## 29. Security requirements

- **Untrusted code isolation** is the #1 concern. All execution via `SandboxProvider` with: no ambient credentials, network egress allow-list, CPU/mem/disk/pid/time limits, ephemeral lifecycle, destroy-after-run.
- **Zip-slip / path traversal**: canonicalize and confine every extracted/written path to the project root. Reject symlinks and absolute paths.
- **Resource caps**: max upload size, max entries, max extracted size, max run duration, max tokens.
- **Secrets**: server-only, env-validated at boot, never logged, never sent to the LLM. Project env values are never captured — only variable names.
- **Command allow-list**: `run_command` only permits vetted commands (package manager, build, test, tsc, lint). No arbitrary shell escapes.
- **SSRF**: GitHub import and any URL input validated; block internal address ranges.
- **AuthZ** enforced server-side on every mutation; delivery tokens are high-entropy and expiring.
- **Prompt injection**: treat project file contents and analyzer output as untrusted data within LLM context; never let file contents override system instructions or tool policies.

---

## 30. Error recovery / Repair agent

- On any QA failure, construct a **repair context**: the failing check, its logs/diagnostics, the current diff, and the relevant files.
- Re-enter the Modify→Validate loop for a **bounded** number of repair attempts (e.g. ≤3, configurable per recipe).
- If still failing, mark the run `failed`, persist all evidence, and surface a clear, actionable report. Never deliver a failing run.
- Ingestion/analysis/sandbox errors are retried with backoff where safe; hard failures are recorded on the run.

---

## 31. Testing strategy

- **Unit (Vitest):** diff engine, zip extraction/safety, recipe input validation, env schema, provider adapters (with fakes), reference retrieval.
- **Integration:** a full run against a **fixture project** using a **fake `LLMProvider`** and a **local `SandboxProvider`** so CI needs no external services.
- **E2E (Playwright):** the TaskForge UI itself — create recipe, ingest project, run, view QA, deliver.
- Every phase's implementation prompt must include tests as an acceptance criterion.

---

## 32. Deployment

- **Web app:** Vercel **or** Render (Next.js). Env vars via platform secrets. No local disk reliance.
- **Worker:** **Render** background worker / private service (long-running; can host Docker sandbox adapter). **Not** Vercel.
- **Redis + Postgres + S3 bucket:** managed services; connection strings via env.
- **Sandbox:** managed sandbox API (default) or Docker on the Render worker (scale path).
- Provide `.env.example`, migration commands, and a README describing the two-process deploy and why execution cannot live on Vercel.
- CI: typecheck, lint, unit + integration tests on every PR.

---

## 33. Acceptance criteria (definition of done for v1)

1. Operator can sign in; roles enforced.
2. Ingest a project by **ZIP** and by **GitHub**; analyzer records framework/scripts/etc.; malicious archives are rejected.
3. Create a **Recipe** with a versioned prompt, typed inputs, and QA checks; add a **reference example** (original + completed + computed diff).
4. Start a **Run**: dynamic input form → analyze → plan → modify (real edits in sandbox) → validate → repair-on-fail.
5. **QA** runs real install/tsc/lint/build/E2E/visual in the sandbox and produces per-check results with artifacts.
6. A passing run yields a **preview URL**, **QA report**, **change log**, and **downloadable final project**, shared via an expiring token.
7. No secrets in client bundles; all untrusted execution isolated in the sandbox; caps and allow-lists enforced.
8. Full run timeline with logs, token usage, and correlation IDs.
9. Unit + integration + UI E2E tests pass in CI without external paid services (via fakes/local adapters).

---

## 34. Per-phase prompt template (how I will send future work)

Every subsequent implementation prompt I send will use this shape. Honor each section, especially `DO NOT DO`.

```text
OBJECTIVE            — the single outcome of this phase
CONTEXT              — where this fits; relevant prior phases
REQUIREMENTS         — concrete, testable requirements
FILES TO CREATE      — exact paths
FILES TO MODIFY      — exact paths
ARCHITECTURE RULES   — patterns/interfaces to respect (LLMProvider, SandboxProvider, app/worker split)
SECURITY REQUIREMENTS— what must be enforced
ERROR HANDLING       — failure modes to cover
TEST REQUIREMENTS    — unit/integration/E2E expected
ACCEPTANCE CRITERIA  — how we verify done
DO NOT DO            — explicit out-of-scope / anti-patterns to avoid
```

---

## 35. Implementation phases (produce a detailed plan for these, then stop)

Propose an ordered plan (adjust if you see a better sequence, and flag risks):

1. **Foundation** — monorepo, Next.js + TS + Tailwind + shadcn/ui, env schema, DB + Prisma schema (§6), auth (§8), app shell, dashboard skeleton, worker skeleton + queue wiring.
2. **Workspaces & ingestion** — workspace CRUD, ZIP upload + safe extraction, GitHub import, S3 storage, Project Analyzer.
3. **Recipe system** — recipe/version/input/QA-check CRUD, dynamic input forms, Reference Library + diff engine, reference example upload.
4. **AI execution engine** — `LLMProvider` interface + one real adapter + a fake; agentic loop with tools; analyze/plan/modify; reference retrieval; bounded loops + logging.
5. **Sandbox + QA engine** — `SandboxProvider` interface + local/managed adapter; QA pipeline (install/tsc/lint/build); Playwright E2E; visual QA; repair loop.
6. **Preview & delivery** — preview environment, QA report, change log, final bundle, tokenized delivery page.
7. **Seed recipes** — Rebranding, GA4, GHL, Endorsely/PAP, Coupon/CSV as data-driven recipes with reference slots.
8. **Hardening** — security review (§29), full test suite (§31), deploy config (§32), docs.

**Now:** summarize your understanding, output the **Prisma schema** and **folder structure**, propose the **phase plan**, and **wait for the Phase 1 prompt.** Do not build features yet.

---

*End of Master Specification. Do not exceed the scope of Step 0.*
