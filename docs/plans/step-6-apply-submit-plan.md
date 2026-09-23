# Implementation Plan: Step 6 — Public: submit an application

**Status: complete.** All tasks done, full local suite green (unit 14, integration 22, e2e 41), PR #10 CI green in 1m13s.

Changes vs the plan during implementation:

- Email normalization (trim + lowercase) lives in `SubmitApplicationDto` via `@Transform`, not in the service.
- Experience dedupe matches whole `\n\n`-separated blocks instead of a substring check. A substring check would drop a short submission that only prefixes an existing block, and would miss a duplicate of the first block.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 6: `POST /apply/:token` — an applicant (no account) submits a structured profile form for a vacancy and gets a confirmation. Candidates are a deduped shared pool keyed by email: a repeat applicant reuses their `candidates` row with the new submission merged in, and a new `applications` row (stage `applied`) links them to the vacancy. Closed vacancies reject submissions. Builds on Step 5 (merged, PR #9): `ApplyModule`/`ApplyController` (`@Public()`) and `VacanciesRepository.findByApplyToken` already exist.

Decisions made with dude during planning:

- **Merge rules** (repeat email): `skills`/`projects` → deduped union; `experience` → new text appended after the old (history kept); `summary`/`name` → latest wins; `githubUrl`/`portfolioUrl` → latest wins only when provided.
- **Same email, same vacancy twice** → `409 Conflict`, backed by a new `unique(vacancy_id, candidate_id)` on `applications` (new migration).

## Research Findings

- Schema (`apps/api/src/db/schema.ts`): `candidates` has `email` unique, `skills text[]`, `projects text[]`, `experience text`, `summary text` (all not null), `githubUrl`/`portfolioUrl` nullable. `applications` has `vacancyId`/`candidateId` FKs + `stage` default `applied` — **no** composite unique today (checked `migrations/20260914130555_next_genesis/migration.sql`).
- Migrations: `npm run db:generate -w apps/api` (drizzle-kit `1.0.0-rc.4`, diffs schema vs snapshot, no DB needed); test DBs apply them via `migrate()` in `test/testcontainers-db.util.ts`, so the new migration is exercised automatically by integration + e2e runs.
- No candidates/applications repositories yet — only recruiters/vacancies. Pattern to copy: `vacancies.repository.ts` (types via `$inferSelect/$inferInsert`, Symbol token, interface) + `drizzle-vacancies.repository.ts` (`TransactionHost`, `this.txHost.tx` read fresh per call, RQBv2 `query.*.findFirst` for reads, `.insert/.update().returning()` for writes) + registration in `@Global()` `RepositoriesModule`.
- Transactions: `@Transactional()` from `@nestjs-cls/transactional` is already wired app-wide (`app.module.ts`) and proven by the commit/rollback tests in `recruiters.repository.integration-spec.ts`. The submit flow (candidate upsert + application insert) must be one transaction so a failure (e.g. duplicate) can't leave a half-merged candidate.
- Validation: global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` in `main.ts` and mirrored in `test/e2e-app.util.ts`; DTO style = `class-validator` decorators (see `create-vacancy.dto.ts`).
- Unit tests: root `jest` config runs `src/**/*.spec.ts` — a good home for the pure merge function's tests (no DB needed).

## Architecture Decisions

- **Pure merge function** `mergeCandidateProfile(existing, submission)` in `apps/api/src/apply/merge-candidate-profile.ts` — all merge rules in one side-effect-free function, unit-tested directly. Skills dedupe case-insensitive (keep first-seen casing); projects dedupe exact after trim; experience appended with `\n\n` (skipped if identical to existing).
- **Email normalized** (trim + lowercase) before lookup/insert, so `A@x.com` and `a@x.com` hit the same candidate row.
- **`ApplyService.submit(token, dto)` is `@Transactional()`**, order: vacancy by token (404) → closed → `409` ("Vacancy is closed") → candidate by email → if existing, check `applications` for (vacancy, candidate) → `409` ("Already applied") **before** merging → create or merge-update candidate → create application. Explicit duplicate check gives a clean 409; the unique index is the race backstop.
- **Response**: `201` `{ success: true }` — mirrors auth's confirmation shape; leaks no candidate/application ids to an unauthenticated caller.
- DTO `SubmitApplicationDto`: `name` (non-empty), `email` (`IsEmail`), `skills` (string[], ≥1, each non-empty), `experience` (non-empty), `projects` (string[], may be empty), `summary` (non-empty), `githubUrl`/`portfolioUrl` (optional, `IsUrl`).

## Task List

### Task 1: Unique (vacancy, candidate) on applications

**Description:** Add `unique().on(t.vacancyId, t.candidateId)` to `applications` in `schema.ts`; run `npm run db:generate -w apps/api` to produce the migration.
**Acceptance criteria:**

- [x] New migration folder contains only the unique constraint addition
- [x] `npm run build --workspaces` succeeds; existing integration suite still green (migration applies cleanly on a fresh container)
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/<new>/`
      **Size:** XS

### Task 2: Candidates + applications repositories

**Description:** `CandidatesRepository` (`findByEmail`, `create`, `update(id, partial)`) and `ApplicationsRepository` (`create`, `findByVacancyAndCandidate`) — interfaces + Drizzle impls, registered/exported in `RepositoriesModule`.
**Acceptance criteria:**

- [x] Integration tests: candidate create/findByEmail (hit + null)/update persists arrays; application create defaults stage `applied`; `findByVacancyAndCandidate` hit + null; inserting a duplicate (vacancy, candidate) rejects
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/db/repositories/{candidates,applications}.repository.ts`, `drizzle-{candidates,applications}.repository.ts`, `repositories.module.ts`, `test/repositories/{candidates,applications}.repository.integration-spec.ts`
      **Size:** M

### Task 3: `POST /apply/:token`

**Description:** `SubmitApplicationDto`; `mergeCandidateProfile` + unit spec; `ApplyService.submit` (`@Transactional()`, flow above); `ApplyController` `@Post(':token')` (already `@Public()` at controller level).
**Acceptance criteria:**

- [x] Unit tests for `mergeCandidateProfile`: skills case-insensitive union, projects union, experience appended (and not duplicated when identical), summary/name latest, links only overwritten when provided
- [x] E2E (`test/apply.e2e-spec.ts`): new candidate → 201 `{ success: true }`; same email on a second vacancy → 201, still one candidate row with merged data, two applications; same email same vacancy → 409; unknown token → 404; closed vacancy → 409; validation errors (missing name, invalid email, empty skills, bad URL) → 400; no auth needed
      **Verification:** build + `npm test -w apps/api` + `npm run test:e2e -w apps/api`
      **Dependencies:** 2
      **Files:** `apps/api/src/apply/dto/submit-application.dto.ts`, `apps/api/src/apply/merge-candidate-profile.ts`, `apps/api/src/apply/merge-candidate-profile.spec.ts`, `apps/api/src/apply/apply.service.ts`, `apps/api/src/apply/apply.controller.ts`, `apps/api/test/apply.e2e-spec.ts`
      **Size:** M

E2E DB-state assertions (single candidate row, two applications) read via `testApp`'s Drizzle instance (`DRIZZLE` override in `e2e-app.util.ts`) — no read endpoints for candidates/applications exist until Steps 7/9.

### Task 4: Final verification

**Description:** build, lint, `prettier --check .`, unit, integration, e2e.
**Acceptance criteria:**

- [x] All green locally
      **Verification:** `npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test -w apps/api && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
      **Dependencies:** 3
      **Files:** none
      **Size:** XS

---

### Checkpoint: Step 6 complete (also closes "Public apply flow" checkpoint in stage-1 plan)

- [x] Applicant can view (Step 5) and submit without an account, end-to-end
- [x] Dedup-by-email + merge rules verified (unit + e2e)
- [x] Closed vacancy: view ok, submit 409; duplicate same-vacancy submit 409
- [x] CI green on a real PR

## Commit Plan

Branch: `feat/step-6-apply-submit` off `main` (PR #9 merged). Ask before each commit (CLAUDE.md); no attribution lines, no test plan in PR body.

| #   | Task                 | Commit message                                           |
| --- | -------------------- | -------------------------------------------------------- |
| 1   | 1: Unique constraint | `feat(db): unique application per vacancy and candidate` |
| 2   | 2: Repositories      | `feat(db): add candidates and applications repositories` |
| 3   | 3: Submit endpoint   | `feat(apply): add public POST /apply/:token`             |
| 4   | Docs update          | `docs: mark step 6 complete` (after CI green)            |

## Execution

Dude's instruction: auto mode, Sonnet model. Each task implemented by a Sonnet subagent (general-purpose, `model: sonnet`) with a self-contained brief; subagents write code and run verification but **do not commit**. I review each diff, then ask approval before each commit (CLAUDE.md rule survives auto mode), push, open PR, poll CI.

## Risks and Mitigations

| Risk                                                                          | Impact | Mitigation                                                                                 |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Concurrent first submissions with the same new email → unique-email violation | Low    | Rare in local demo; surfaces as 500. Not handled beyond the transaction (noted, not built) |
| Half-applied merge when later step fails                                      | Medium | Whole submit flow in one `@Transactional()`; duplicate check runs before merge anyway      |
| Migration generated with unintended diffs                                     | Low    | Review generated SQL before commit — must contain only the unique constraint               |
| Public endpoint abuse (spam submissions)                                      | Low    | Explicitly deferred to Stage 2 per stage-1 plan (no paid API called in Stage 1)            |

## Open Questions

None — merge rules and duplicate handling decided above.
