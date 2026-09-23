# Implementation Plan: Step 9 — Shared candidate pool: list + view

**Status: complete.** All tasks done, full local suite green (unit 14, integration 30, e2e 63), PR #13 CI green in 1m22s.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 9 (last Stage 1 step): `GET /candidates` and `GET /candidates/:id`. Candidates are a **shared pool**: any authenticated recruiter can list/view every candidate, including ones who only applied to other recruiters' vacancies (SPEC persona line). Narrowed for Stage 1: list + view, no search/filtering (semantic search is Stage 2). Finishing this closes the stage-1 "Stage 1 complete" checkpoint, which also asks for a demoable end-to-end flow over HTTP.

## Research Findings

- `CandidatesRepository` (`apps/api/src/db/repositories/candidates.repository.ts`): `create`, `findByEmail`, `update`. Needs `findAll` and `findById`. Pattern: RQBv2 `this.txHost.tx.query.candidates.findMany/findFirst` (see `drizzle-vacancies.repository.ts` `findByRecruiterId` for `orderBy: { createdAt: 'desc' }`).
- Auth: global `JwtAuthGuard` (APP_GUARD) — a new controller is guarded by default; no `@UseGuards`, no `@Public()`.
- Module pattern: `apps/api/src/applications/` (module/controller/service, wired in `app.module.ts`); `RepositoriesModule` is `@Global()`. `ParseUUIDPipe` on `:id`.
- Relations exist (`candidates.applications` many) but **must not** be used here: a candidate's applications span other recruiters' vacancies, and SPEC says recruiters see only their own applications. Profile only.

## Architecture Decisions

- **New `candidates/` module** (`CandidatesModule`, `CandidatesController` `@Controller('candidates')`, `CandidatesService`).
- **List**: all candidates, newest first (`orderBy: { createdAt: 'desc' }`), no pagination (not in Stage 1 scope).
- **View**: `findById` → `NotFoundException('Candidate not found')` on miss. Not owner-scoped (shared pool).
- **Response**: raw candidate rows (profile fields only; no applications) — same raw-row convention as other recruiter endpoints.

## Task List

### Task 1: Repository `findAll` + `findById`

**Acceptance criteria:**

- [x] Integration tests (`test/repositories/candidates.repository.integration-spec.ts`): `findAll` returns created candidates newest first (assert relative order of two freshly created ones — DB is shared across tests in the suite); `findById` hit + `null` for unknown uuid
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** None
      **Files:** `candidates.repository.ts`, `drizzle-candidates.repository.ts`, `candidates.repository.integration-spec.ts`
      **Size:** S

### Task 2: `GET /candidates`, `GET /candidates/:id`

**Acceptance criteria:**

- [x] New `test/candidates.e2e-spec.ts` (candidates created via public `POST /apply/:token`): recruiter B's list includes a candidate who applied only to recruiter A's vacancy; view single profile → 200 with submitted profile fields and **no** `applications` key; unknown uuid → 404; malformed id → 400; both routes without cookie → 401
      **Verification:** build + `npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/candidates/{candidates.module,candidates.controller,candidates.service}.ts`, `apps/api/src/app.module.ts`, `apps/api/test/candidates.e2e-spec.ts`
      **Size:** M

### Task 3: Final verification

**Verification:** `rm -f apps/api/tsconfig.build.tsbuildinfo && npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test -w apps/api && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
**Dependencies:** 2 · **Size:** XS

No separate end-to-end journey spec: the per-step e2e suites already cover every hop of the Stage 1 flow (auth → vacancy CRUD → public apply → applicant list → stage move → candidate pool), so a walkthrough would only duplicate them. The stage-1 "demoable end-to-end" checkpoint is satisfied by those suites together.

---

### Checkpoint: Step 9 + Stage 1 complete

- [x] Any recruiter lists/views the full candidate pool; profile only, no cross-recruiter application leak
- [x] Unknown → 404; malformed → 400; unauthenticated → 401
- [x] Full local suite + CI green; stage-1 "Stage 1 complete" checkpoint ticked

## Execution

Sonnet subagents (general-purpose, `model: sonnet`), one per task, self-contained briefs; write code + run verification, **no commits**. I review diffs, re-run suites myself, ask approval before each commit. Push, PR (no test plan, no attribution), poll CI, docs commit.

## Commit Plan

Branch `feat/step-9-candidate-pool` off `main` (PR #12 merged).

| #   | Task          | Commit message                                      |
| --- | ------------- | --------------------------------------------------- |
| 1   | 1: Repository | `feat(db): list and find candidates by id`          |
| 2   | 2: Endpoints  | `feat(candidates): add GET /candidates and /:id`    |
| 3   | Docs          | `docs: mark step 9 and stage 1 complete` (after CI) |

## Risks and Mitigations

| Risk                                                         | Impact | Mitigation                                                       |
| ------------------------------------------------------------ | ------ | ---------------------------------------------------------------- |
| Candidate view leaks other recruiters' applications/pipeline | Medium | No `with: { applications }`; e2e asserts no `applications` key   |
| `findAll` ordering test flaky on shared suite DB             | Low    | Assert relative order of the two candidates created in that test |
| Unbounded list size                                          | Low    | Acceptable for local demo; pagination deferred (noted)           |

## Open Questions

None.
