# Implementation Plan: Step 4 — List/view my own vacancies

**Status: complete.** Both tasks done, full local suite green, PR #8 CI green in 1m14s.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 4: `GET /vacancies` (mine only) and `GET /vacancies/:id` (mine, 404 otherwise). Depends on Step 2 (merged), which already built `VacanciesRepository`/`DrizzleVacanciesRepository`, `VacanciesModule`/`Controller`/`Service`. Step 3 (merged) added `findById`/`update` and the 404-for-both-cases owner-scoping convention. This step is a pure read-side addition on top of that — no schema change.

Prior branch (`fix/drizzle-query-api`, PR #7, merged) migrated repository reads to Drizzle's RQBv2 query API (`db.query.<table>.findFirst`); this step's new reads follow the same convention (`findMany`).

## Research Findings

- `VacanciesRepository` (`apps/api/src/db/repositories/vacancies.repository.ts`) currently has `create`, `findById`, `update` — needs `findByRecruiterId(recruiterId: string): Promise<Vacancy[]>`.
- `DrizzleVacanciesRepository.findById` already uses `this.txHost.tx.query.vacancies.findFirst({ where: { id } })` (RQBv2) — `findByRecruiterId` mirrors this with `findMany({ where: { recruiterId }, orderBy: { createdAt: 'desc' } })`. Newest-first is the obvious useful default for a list endpoint and RQBv2 supports it as a one-line option — no extra code/complexity.
- `VacanciesService.update` (`vacancies.service.ts:28-47`) already has the exact "404 if missing or not owned" check needed for `GET /vacancies/:id` — duplicating that logic for the new `findOne` would drift over time. Extracting it into a private `getOwnedVacancy(recruiterId, vacancyId)` helper (used by both `update` and the new `findOne`) removes the duplication and is a small, contained refactor of a method already being touched this step.
- No DTOs needed — both new endpoints are parameterless reads (list takes nothing but the authenticated user; get-by-id takes just `:id`, already validated via `ParseUUIDPipe` like `PATCH /vacancies/:id`).
- Route ordering: `@Get()` and `@Get(':id')` on the same controller don't conflict in Nest (exact path vs param path); consistent with the existing `@Post()` / `@Patch(':id')` pair already in `VacanciesController`.

## Architecture Decisions

- **List is newest-first** (`orderBy: { createdAt: 'desc' }`) — no pagination in Stage 1 (not in SPEC.md/stage-1-api-plan for this step; would be scope creep).
- **`getOwnedVacancy` private helper** in `VacanciesService`, shared by `update` and the new `findOne`, keeping the 404-for-both-cases (not-found vs not-owned) convention in exactly one place.
- **No response DTO/mapper** — matches existing `create`/`update` handlers, which return the raw `Vacancy` row type directly.

## Task List

### Task 1: Repository + service + controller for list/view

**Description:** Add `findByRecruiterId` to `VacanciesRepository`/`DrizzleVacanciesRepository`. Refactor `VacanciesService` to extract `getOwnedVacancy(recruiterId, vacancyId)` from `update`, and add `findAllMine(recruiterId)` (calls `findByRecruiterId`) and `findOne(recruiterId, vacancyId)` (calls `getOwnedVacancy`). Add `VacanciesController` handlers: `@Get()` → `findAllMine`, `@Get(':id')` (`ParseUUIDPipe`) → `findOne`.
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] New integration test in `test/repositories/vacancies.repository.integration-spec.ts`: `findByRecruiterId` returns only that recruiter's vacancies, newest first; empty array for a recruiter with none
- [x] New e2e cases in `test/vacancies.e2e-spec.ts`: `GET /vacancies` returns only the authenticated recruiter's vacancies (seed a second recruiter with their own vacancy, assert it's excluded); unauthenticated → 401; `GET /vacancies/:id` happy path; non-owner → 404; unknown id → 404; unauthenticated → 401
      **Verification:** build + `npm run test:integration -w apps/api` + `npm run test:e2e -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/db/repositories/vacancies.repository.ts`, `apps/api/src/db/repositories/drizzle-vacancies.repository.ts`, `apps/api/src/vacancies/vacancies.service.ts`, `apps/api/src/vacancies/vacancies.controller.ts`, `apps/api/test/repositories/vacancies.repository.integration-spec.ts`, `apps/api/test/vacancies.e2e-spec.ts`
      **Size:** M

### Task 2: Final verification

**Description:** Full local suite in sequence: build, lint, `prettier --check .`, unit, integration, e2e. Confirm no regression in existing vacancy create/update e2e tests.
**Acceptance criteria:**

- [x] All of the above green locally
      **Verification:** `npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** none (verification only)
      **Size:** XS

---

### Checkpoint: Step 4 complete

- [x] `GET /vacancies` returns only the authenticated recruiter's vacancies
- [x] `GET /vacancies/:id` returns the vacancy if owned, 404 otherwise (no existence leak); malformed id → 400
- [x] Full local suite green; matches Step 4's E2E acceptance criteria in `stage-1-api-plan.md`
- [x] CI green on a real PR

## Commit Plan

Branch: `feat/step-4-vacancy-list` off `main` (has PR #7 merged). One commit per task (per CLAUDE.md: ask before each actual commit).

| #   | Task                      | Commit message                                               |
| --- | ------------------------- | ------------------------------------------------------------ |
| 1   | 1: List/view endpoints    | `feat(vacancies): add GET /vacancies and GET /vacancies/:id` |
| 2   | 2: Docs/checkpoint update | `docs: mark step 4 complete` (only after CI verified)        |

## Risks and Mitigations

| Risk                                                                  | Impact | Mitigation                                                                                 |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Extracting `getOwnedVacancy` accidentally changes `update`'s behavior | Low    | Pure extraction, no logic change; existing Step 3 e2e tests re-verify `update` still works |
| List leaks other recruiters' vacancies if `where` filter is wrong     | Medium | Dedicated e2e test seeds a second recruiter and asserts their vacancy is absent            |

## Open Questions

None blocking — straightforward read-side extension of the existing Step 2/3 pattern.
