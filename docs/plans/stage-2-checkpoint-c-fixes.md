# Stage 2 · Checkpoint C fixes — six gaps from the walkthrough

Source: `docs/eval/checkpoint-c.md` (gaps G1–G8) and the matching sdd §12 bullets. Branch: `fix/checkpoint-c-gaps`, off `main` **after PR #37 merges** (it adds the §12 bullets this work removes).

## Overview

Checkpoint C passed with no blockers but logged eight gaps. Six of them are straightforward code fixes and are planned here. The other two are quality problems that need measurement, not guesses, so they move to step 11:

- **G4**: full_text scoring ignores GitHub evidence;
- **G5**: Find matches false positives.

Step 11's harness measures retrieval precision/recall and score agreement, so tuning them belongs there.

| Gap | Fix                                                                    | Layer    |
| --- | ---------------------------------------------------------------------- | -------- |
| G1  | Reject a session whose recruiter no longer exists                      | API      |
| G3  | Skip the re-parse when a repeat applicant re-uploads the identical PDF | API + DB |
| G6  | Persist a grounding failure's problems for diagnosis                   | API + DB |
| G7  | Stop polling behind a failed parse                                     | Web      |
| G8  | Keep the previous score visible when a rescore fails                   | Web      |
| G2  | Show new applications on an open, settled board                        | Web      |

## Architecture decisions

- **No contract change.** Every fix works with the current `packages/shared/src/api.ts`:
  - G6's details are internal and never exposed;
  - G8 uses the `result` the API already returns for a `failed` score (`stale: true`);
  - G7 uses `score.waitingForParse` plus `candidate.parseStatus`, both already on `ApplicationWithCandidateResponse`.
- **G1: a DB lookup per authenticated request.**
  - `JwtStrategy.validate` becomes async and calls `RecruitersRepository.findById(payload.sub)`. It returns `null` when the recruiter is missing, and Passport turns that into a 401.
  - The `AuthUser` shape is unchanged, and the email comes from the DB row, so it can't drift from the token.
  - Cost: one primary-key lookup per request. That's fine at this scale and needs no cache.
- **G3: content hash on `cv_documents`.**
  - A new nullable `content_sha256 text` column. The migration backfills existing rows with `encode(sha256(content), 'hex')` (Postgres ≥ 11 built-in).
  - New rows get the hash in the app (`node:crypto`).
  - In `ApplyService.saveApplication`, for an existing candidate the latest CV is reused when **all** of these hold:
    - its hash equals the upload's;
    - the candidate is `parsed`;
    - the GitHub URL is unchanged (a new URL must re-fetch GitHub, which changes the profile).
  - When the CV is reused: no new `cv_documents` row, no reset to `pending`, no parse enqueue. The application and its pending score are still created, and the score job is enqueued; the candidate is parsed, so it scores at once.
  - Otherwise the current behavior stays. That includes a `failed` candidate re-uploading the same file, since re-applying is a legitimate way to retry.
- **G6: `application_scores.failure_details jsonb`, nullable.**
  - `LlmGroundingError` carries the last attempt's `problems: string[]`.
  - `markFailed(applicationId, error, details?)` stores them. Other failures store `null`, and a successful save clears the column.
  - Never mapped into the API (the mapper already drops internal columns). A warn-level log line names the column, so whoever reads the log knows where to look.
  - The CV text is already in the DB, so storing CV excerpts there adds no new exposure; logs stay free of CV text.
- **G7: "in flight" excludes scores that can't progress.**
  - `hasScoreInFlight` (web `pipeline/score.ts`) ignores an application whose score is `pending` with `waitingForParse` while its `candidate.parseStatus === 'failed'`.
  - The badge still shows "Waiting for CV" (spinner). It should become a static chip "Waiting for CV (parse failed)" with no spinner, so the board doesn't look busy.
- **G8: a failed score with a previous result shows that result greyed out**, like a stale one, with the error colour and the tooltip "Last rescore failed — showing the previous score".
  - The badge's aria-label adds "(last rescore failed)".
  - Board ordering already counts a stale result's number, so the order is unchanged.
  - A `failed` score with no previous result keeps "Score failed".
- **G2: background polling at a slow interval (30 s) when nothing is in flight**, instead of `false`.
  - The fast intervals stay. Focus refetch already covers returning to the tab.
  - The cost is a GET every 30 s per open board, which is acceptable locally.
  - No websockets/SSE; that stays a §12 limitation.

## Task list

### Phase 1: API

#### Task 1: Reject sessions of missing recruiters (G1) — S

**Description:** Make `JwtStrategy.validate` look the recruiter up and return `null` when the row is gone, so the guard answers 401 and the web's existing 401 handling logs the user out.

**Acceptance criteria:**

- [ ] A valid token for a deleted or unknown recruiter id gets 401 on a guarded route and on `GET /auth/me`.
- [ ] A valid token for an existing recruiter still works; `@Public()` routes are unaffected.
- [ ] `AuthUser.email` comes from the DB row.

**Verification:** unit spec for the strategy (found / not found); an e2e case in `auth.e2e-spec.ts` that signs a token for a random UUID with the test secret → 401; `npm run test -w apps/api`, `npm run test:e2e -w apps/api`.

**Dependencies:** none. **Files:** `apps/api/src/auth/jwt.strategy.ts`, `jwt.strategy.spec.ts` (new), `apps/api/test/auth.e2e-spec.ts`.

#### Task 2: Identical re-upload skips the re-parse (G3) — M

**Description:** Add `cv_documents.content_sha256` (migration + backfill), compute it on create, expose `findLatestByCandidate` with the hash, and branch in `ApplyService` as decided above.

**Acceptance criteria:**

- [ ] Re-applying to another vacancy with the byte-identical PDF and the same GitHub URL creates the application and scores it, with no new CV row, no parse job and no parse status change.
- [ ] A different PDF, a changed GitHub URL, or a candidate that isn't `parsed` keeps today's behavior (new CV row, `pending`, parse job).
- [ ] The migration backfills existing rows, and new rows always have a hash.

**Verification:** repository integration spec (the hash is stored and returned for the latest CV); e2e cases in `apply.e2e-spec.ts` for all three branches, using the MSW parse handler and `waitForParseStatus`, asserting the CV count via `GET /candidates/:id` and the OpenAI request count via the MSW capture; `npm run test:integration`, `npm run test:e2e -w apps/api`.

**Dependencies:** none. **Files:** `apps/api/src/db/schema.ts`, a new migration in `apps/api/src/db/migrations/`, `drizzle-cv-documents.repository.ts` + interface, `apps/api/src/apply/apply.service.ts`, `apps/api/test/apply.e2e-spec.ts`, `apps/api/test/repositories/cv-documents.repository.integration-spec.ts`.

#### Task 3: Persist grounding-failure details (G6) — S/M

**Description:** Add `application_scores.failure_details` (migration), let `LlmGroundingError` carry its problems, store them in `markFailed`, clear them on a successful save, and update the warn log line.

**Acceptance criteria:**

- [ ] A score that fails grounding twice stores the second attempt's problem strings; any other failure stores `null`.
- [ ] A later successful score clears `failure_details`.
- [ ] `GET /vacancies/:id/applications` and the rescore response never contain the field.

**Verification:** a unit spec in `application-scorer.spec.ts` (the error carries the problems); worker integration spec (MSW returns an unverifiable quote twice → row has details; then a valid answer → cleared); the mapper spec asserts the field isn't mapped; `npm run test`, `npm run test:integration`, `npm run test:e2e`.

**Dependencies:** none (separate migration from Task 2; generate them one after another). **Files:** `apps/api/src/db/schema.ts`, migration, `apps/api/src/llm/application-scorer.ts`, `scores.repository.ts` + `drizzle-scores.repository.ts`, `apps/api/src/jobs/score-application.worker.ts`, matching specs.

### Checkpoint: API

- [ ] `npm run test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`, `npm run lint` green.
- [ ] Both migrations apply on a copy of the Checkpoint C DB (`rag_ats_checkpoint_c`), and the backfill hashes all 13 CVs.

### Phase 2: Web

#### Task 4: No polling or spinner behind a failed parse (G7) — S

**Description:** Treat a `pending` score with `waitingForParse` whose candidate parse `failed` as settled in `hasScoreInFlight`, and render its badge as a static "Waiting for CV (parse failed)" chip.

**Acceptance criteria:**

- [ ] `useVacancyApplications` stops fast polling when the only unsettled score is behind a failed parse.
- [ ] The badge shows no spinner in that state, with a matching aria-label; a normal "Waiting for CV" (parse pending or parsing) is unchanged.

**Verification:** `score.test.ts` (helper cases), `ScoreBadge.test.tsx`, `queries.test.tsx` (the interval stops); `npm run test -w apps/web`.

**Dependencies:** none. **Files:** `apps/web/src/pipeline/score.ts`, `ScoreBadge.tsx`, `queries.ts`, tests. `hasScoreInFlight` needs the candidate, so its input type becomes `{ score, candidate: { parseStatus } }[]`; check its other caller in `candidates/queries.ts`.

#### Task 5: A failed rescore keeps the previous score visible (G8) — S

**Description:** In `ScoreBadge`, a `failed` score with `result` shows the previous overall, greyed out, with error colouring, an error icon and the tooltip "Last rescore failed — showing the previous score". The drawer's failed alert adds "Showing the previous score." when a result exists.

**Acceptance criteria:**

- [ ] Failed with a previous result: the number is shown greyed, with the tooltip and aria-label "Fit score N of 100 (last rescore failed)".
- [ ] Failed without a previous result: "Score failed", as today.
- [ ] Board ordering is unchanged (covered by the existing `board.test.ts`).

**Verification:** `ScoreBadge.test.tsx`, `ScoreDrawer.test.tsx`; `npm run test -w apps/web`.

**Dependencies:** none (same files as Task 4: run them sequentially). **Files:** `apps/web/src/pipeline/ScoreBadge.tsx`, `ScoreDrawer.tsx`, tests.

#### Task 6: Settled boards refresh slowly (G2) — XS

**Description:** `useVacancyApplications` returns `BOARD_IDLE_POLL_INTERVAL_MS = 30_000` instead of `false` when nothing is in flight.

**Acceptance criteria:**

- [ ] With every score settled, the query refetches about every 30 s; the fast intervals are unchanged while something is in flight.

**Verification:** `queries.test.tsx` with fake timers; `npm run test -w apps/web`.

**Dependencies:** Task 4 (same function). **Files:** `apps/web/src/pipeline/queries.ts`, `score.ts` (constant), `queries.test.tsx`.

### Checkpoint: Complete

- [ ] All suites, build and lint green; `npx prettier --check .` last.
- [ ] Live re-check on the Checkpoint C DB (API + web dev servers, Claude in Chrome):
  - G1: a pre-existing session from the dev DB is logged out;
  - G3: re-applying Maya's identical PDF to another vacancy makes no parse call in the log;
  - G6: `failure_details` is filled if a rag failure happens (or by forcing one);
  - G7: no network polling behind the "Retry Tester" case;
  - G8: invalid-key rescore → previous number greyed out;
  - G2: an applicant appears on an open board within 30 s.
- [ ] Docs: remove the fixed bullets from sdd §12 (keep G4, G5 and point them at step 11), describe the new behavior in §8/§10, add both migrations to §13, and add a "Fixed after Checkpoint C" note to `docs/eval/checkpoint-c.md`.
- [ ] Ask for commit approval. Proposed commits: plan / G1 / G3 / G6 / web fixes (G7, G8, G2) / docs. Then push, open the PR "Checkpoint C gap fixes", and watch CI.

## Execution

Per memory: Sonnet subagents implement Tasks 1–6, one per task, in order. Tasks 1–3 touch disjoint files except `schema.ts`/migrations (2 and 3 run sequentially). The main session reviews each diff, re-runs the suites, does the live re-check and writes the docs inline.

## Risks and mitigations

| Risk                                                                                                  | Impact | Mitigation                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| G1 adds a DB query to every request; a unit test that fakes `AuthUser` without a recruiter row breaks | Low    | No test signs JWTs by hand today (checked); every e2e session comes from a real register + login                    |
| G3 skips a parse that was actually needed (e.g. a prompt change since the last parse)                 | Low    | Recruiters still have Retry parsing; the reuse requires `parsed` and an unchanged GitHub URL                        |
| Two migrations generated in parallel clash on drizzle's snapshot/journal                              | Med    | Tasks 2 and 3 run sequentially, each with `npm run db:generate`                                                     |
| `failure_details` grows large                                                                         | Low    | Store at most the problem list of one attempt (≤ 1 line per criterion), truncated to 500 characters each            |
| A 30 s idle poll on many open tabs                                                                    | Low    | Acceptable at thesis scale; pauses when the tab is hidden (TanStack's default `refetchIntervalInBackground: false`) |

## Deferred

- **G4** (full_text ignores GitHub) and **G5** (match false positives): step 11, with measured tuning.
