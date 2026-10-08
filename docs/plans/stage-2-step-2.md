# Stage 2 · Step 2 — Async LLM parsing into profile

Parent roadmap: `docs/plans/stage-2.md`, Part A, Step 2. Saved as `docs/plans/stage-2-step-2.md` on approval (committed with Task 1, same as step 1).

## Context

Step 1 (PR #26) stores every applicant's PDF and its extracted text in `cv_documents`, but profile fields (`skills`, `experience`, `projects`, `summary`) stay empty. Step 2 fills them automatically. On apply, a pg-boss job sends the latest CV text to OpenAI with structured outputs, and the result becomes the profile. Recruiters see a parse status everywhere candidates appear, the UI polls until parsing settles, and a failed parse can be retried. The profile shape stays the same 4 fields (dude's call), so the contract only gains status fields.

## Architecture decisions

- **Contract first** (`packages/shared/src/api.ts`):
  - `export type ParseStatus = 'pending' | 'parsing' | 'parsed' | 'failed'`.
  - `CandidateResponse` gains `parseStatus: ParseStatus` and `parseError: string | null`. `ApplicationWithCandidateResponse` picks these up automatically.
  - New `POST /candidates/:id/reparse` returns `CandidateResponse` (202).
- **Schema** (`apps/api/src/db/schema.ts`, one generated migration):
  - `parse_status` pgEnum, not null, default `'pending'`.
  - `parse_error` text null; `parsed_cv_document_id` uuid null FK → `cv_documents`; `parsed_at` timestamp null.
  - Existing dev candidates become `pending`, so the startup sweep (below) backfills them for free.
- **LLM module** `apps/api/src/llm/`:
  - `openai` SDK (latest) behind `LlmClient`; `CvProfileParser.parse(cvText) → ParsedProfile`.
  - Uses the Responses API structured outputs with a zod schema (`zodTextFormat`, add `zod` to api). Schema: `skills: string[]`, `experience: string`, `projects: string[]`, `summary: string`.
  - Post-processing: trim, de-duplicate skills case-insensitively, drop empty entries.
  - System prompt: extract only what the CV states, no invention. The CV text is untrusted data, so it's put in a delimited user message and the prompt says to ignore any instructions inside it.
  - CV text is normalised (collapse whitespace runs) and capped (~40k chars) before sending.
  - Token usage from `response.usage` is logged per call (Nest `Logger`: model, input/output tokens), which serves as the budget check.
  - A refusal or a schema-invalid output throws a typed `LlmParseError`.
  - `EnvConfig`: `OPENAI_API_KEY` (required), `OPENAI_MODEL` (default `gpt-5.4-mini`). The SDK's built-in retries (`maxRetries: 2`) handle 429/5xx.
  - **Secrets rule:** never print `.env` or keys; subagent briefs say so.
- **Jobs module** `apps/api/src/jobs/`:
  - `pg-boss` v12 (ESM, Node ≥22.12, fine on 22.17). A provider builds `PgBoss` on the **same Pool as Drizzle** (`db.$client` from the `DRIZZLE` token, via pg-boss's `db.executeSql` adapter), so e2e's `DRIZZLE` override covers it automatically.
  - `start()` in `onApplicationBootstrap`, `stop()` on shutdown. pg-boss creates its own `pgboss` schema; Drizzle migrations don't touch it.
  - Queue `parse-candidate`, payload `{ candidateId, cvDocumentId }`. Job-level `retryLimit: 0`: transient errors are already retried by the SDK, and any thrown error marks the parse `failed`. Small local concurrency (2).
  - `JOBS_POLL_INTERVAL_SECONDS` env (default 2, e2e uses 0.5).
- **Worker flow** (`ParseCandidateWorker`), idempotent and race-safe:
  1. Load the candidate and its latest CV. If `cvDocumentId` is no longer the latest, or it already equals `parsed_cv_document_id` with status `parsed`, finish without doing anything (a newer job owns the work).
  2. Set `parsing`. Call the LLM **outside** any transaction.
  3. In a transaction, re-check that the CV is still the latest. If it is, write the profile, `parsed`, `parsed_cv_document_id`, `parsed_at`, and clear `parse_error`. If not, drop the result.
  4. On error, set `failed` plus a short, safe `parse_error` ("Could not parse the CV" or the `LlmParseError` message, never raw SDK or HTTP details), again only if the CV is still the latest.
- **Enqueue on apply.** `ApplyService.saveApplication` sets `parse_status = 'pending'` inside the existing transaction. **After commit**, `submit` enqueues `parse-candidate` for the new CV. A crash between commit and enqueue is covered by a **startup sweep**: on bootstrap, any candidate in `pending`/`parsing` gets a job for its latest CV. The worker's idempotency check makes duplicate jobs harmless.
  - A repeat applicant keeps the old profile visible while the new CV is pending, then the profile is replaced.
- **Reparse.** `POST /candidates/:id/reparse` (cookie auth, shared pool):
  - Allowed when the status is `parsed` or `failed`: sets `pending`, enqueues the latest CV, returns 202 with the candidate.
  - Returns 409 while `pending`/`parsing`, and 404 for an unknown candidate.
- **Web:**
  - `ParseStatusChip` (Pending / Parsing… / Parsed hidden or subtle / Failed) on the candidate page header, pool table rows and pipeline cards.
  - `refetchInterval` (3s) on `useCandidate`, `useCandidates` and `useVacancyApplications` while any loaded candidate is `pending`/`parsing`; it stops once everything settles.
  - Candidate page: when `failed`, an Alert shows `parseError` with a "Retry parsing" button (mutation → reparse, then invalidate the candidate detail, the candidate list and vacancy applications). Profile placeholders read "Parsing CV…" while pending/parsing and keep "Not available yet" otherwise.
- **Tests:**
  - OpenAI HTTP is mocked with **MSW** (`msw/node`, api devDependency) in unit, integration and e2e tests, so no live calls.
  - Postgres plus pg-boss run on testcontainers.
  - e2e waits for parse completion with a polling helper (`waitForParseStatus(app, id, status)`).
  - `jest-e2e-setup.ts` sets a dummy `OPENAI_API_KEY` and a small poll interval.

## Task list

Each task is executed by a Sonnet subagent. I review, re-run tests, and ask before committing. Branch: `feat/cv-parsing` off updated `main`.

### Task 1: Contract, schema, repository

- `api.ts` changes above.
- Schema columns plus the migration (`db:generate`, unedited).
- `CandidatesRepository`:
  - `setParseStatus(id, status, error?)`
  - `saveParsedProfile(id, cvDocumentId, profile)`
  - `findParseBacklog()`, returning `pending`/`parsing` candidates with their latest CV id
  - all reads expose the new fields
- DTO plus `contract.check.ts`.
- New candidates default to `pending`.
- Web fixtures get `parseStatus: 'parsed', parseError: null`, so builds stay green.

**Acceptance:** build passes, the contract check passes, and the integration specs cover the new repo methods and backlog query.
**Verify:** `npm run build`, `npm run test:integration`. **Size:** M

### Task 2: LLM module (`CvProfileParser`)

- `openai` + `zod` deps.
- `llm.module.ts`, `llm-client.ts`, `cv-profile-parser.ts`, the prompt, the schema, post-processing and usage logging.
- `EnvConfig` additions.
- `msw` api devDependency plus a shared `test/msw/openai.handlers.ts` that returns a Responses-API JSON body built from a given profile, a refusal, or a 500.

**Acceptance:**

- parse returns the normalised profile;
- a refusal or invalid JSON throws `LlmParseError`;
- a 500 after SDK retries throws;
- the request body contains the model, the JSON schema format, and the CV text inside delimiters;
- usage is logged.

**Verify:** `npm run test -w apps/api` (unit with MSW). **Size:** M · **Risk:** MSW 2 under Jest 29 ESM. Prove it first; fallback is a fake `fetch` passed to the OpenAI client.

### Task 3: Jobs module + parse worker

- `jobs.module.ts` (PgBoss provider on Drizzle's pool, lifecycle, queue creation), `JobsService.enqueueParse(candidateId, cvDocumentId)`, `ParseCandidateWorker`, startup sweep.
- Integration spec (testcontainers + MSW), covering:
  - enqueue → `parsed` with the profile written;
  - LLM failure → `failed` with a safe message;
  - stale job (a newer CV exists) → skipped, newer job wins;
  - duplicate job → one LLM call;
  - sweep enqueues the backlog.

**Verify:** `npm run test:integration`. **Deps:** 1, 2. **Size:** M–L

### Task 4: Apply enqueue + reparse endpoint

- Apply sets `pending` in the transaction and enqueues after commit.
- `POST /candidates/:id/reparse` (202/404/409/400/401) with Swagger docs.
- `jest-e2e-setup.ts` env.
- `test/parse.util.ts` (`waitForParseStatus`) and MSW wiring in e2e.
- e2e:
  - apply → eventually `parsed`, with the profile visible via `GET /candidates/:id` and `GET /vacancies/:id/applications`;
  - re-apply with a new CV → re-parsed from the new text;
  - LLM failure → `failed` → reparse → `parsed`;
  - reparse while pending → 409.
- Existing e2e specs stay green (they now see `pending`/`parsed` statuses; MSW default handler returns a valid profile).

**Verify:** `npm run test:e2e`, all suites. **Deps:** 3. **Size:** M

### Checkpoint: API

- Build, unit, integration and e2e are green.
- **Live smoke:** with the real (rotated) key in `.env`, apply 2–3 varied real PDFs via curl. Check that the profiles look right and record the logged token usage. Never print the key; only check it's set.

### Task 5: Web — status, polling, retry

- Types; `api/candidates.ts` `reparseCandidate`; `ParseStatusChip`.
- `refetchInterval` helper (`hasParseInFlight(candidates)`) used by the 3 queries.
- Candidate page failed Alert plus a retry mutation, and placeholders that depend on status.
- Chip on the pool table and pipeline cards.

**Tests (MSW):**

- the chip renders per status;
- the candidate page polls from pending to parsed (fake timers or a short interval via a param), and polling stops once settled;
- failed → Retry → POST reparse → status shows pending;
- the pool and board show chips.

**Verify:** web tests ×2, build, lint. **Deps:** 1, 4 (contract only). **Size:** M

### Checkpoint: Browser

Apply with a real PDF (live key) → the pipeline card shows Pending/Parsing, then the profile fills in without a reload. Force a failure (temporarily invalid `OPENAI_MODEL`) → Failed and the error appear → fix it → Retry → Parsed. Kill the servers by PID.

### Task 6: Docs

- `docs/sdd.md`:
  - status;
  - data model (parse columns, `pgboss` schema note);
  - modules (`llm/`, `jobs/`);
  - endpoints (reparse);
  - design decisions: the job flow, idempotency and stale-CV guard, enqueue after commit plus sweep, untrusted-CV prompt, no job-level retries, usage logging;
  - frontend (chip, polling, retry);
  - testing (MSW in the API, `waitForParseStatus`);
  - limitations;
  - env vars.
- README env section: `OPENAI_API_KEY`, `OPENAI_MODEL`.

**Verify:** prettier, read-through against the code. **Size:** S

### Checkpoint: Complete

CI-equivalent run locally, then ask for commit approval (commits per task or grouped API/web/docs), then push, then PR "Stage 2 step 2: async LLM CV parsing" (no test plan, no attribution), then watch CI.

## Risks

| Risk                                         | Impact | Mitigation                                                                                                     |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| MSW 2 + Jest 29 ESM interop                  | Med    | Proven in Task 2 first; fallback is a custom `fetch` injected into the OpenAI client (still HTTP-shaped mocks) |
| pg-boss v12 ESM / adapter on Drizzle's pool  | Med    | Task 3 integration test; fallback is pg-boss with its own `connectionString` taken from the pool's options     |
| Flaky e2e from async jobs                    | Med    | 0.5s polling, `waitForParseStatus` with a timeout, `--runInBand` already set                                   |
| Prompt injection via CV text                 | Low    | Delimited untrusted input, strict JSON schema output, no tools; the output is only displayed                   |
| `gpt-5.4-mini` cost/latency unknown          | Low    | Usage logging + live smoke at the checkpoint, concurrency 2, 40k-char cap                                      |
| Stale parse overwriting a newer CV's profile | Med    | CV-is-latest re-check inside the write transaction                                                             |

## Out of scope

GitHub enrichment (step 3), scoring (step 4+), page markers or layout-aware extraction, persisting raw LLM output.
