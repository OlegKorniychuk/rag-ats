# Implementation Plan: Step 3 — Update / close a vacancy

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 3 is: `PATCH /vacancies/:id` — a recruiter edits a vacancy's fields and/or transitions its status to `closed`, owner-scoped in the service layer (SPEC.md's "Always do" list: owner-scoping must live in the service, not just the controller).

Builds directly on Step 2 (PR #5, merged): `vacancies` table, `VacanciesRepository`/`DrizzleVacanciesRepository`, `VacanciesModule`/`VacanciesController`/`VacanciesService` all already exist. This step only adds read/update capability on top.

## Research Findings

- **Current `VacanciesRepository`** (`apps/api/src/db/repositories/vacancies.repository.ts`) only has `create` — needs `findById(id): Promise<Vacancy | null>` (mirrors `RecruitersRepository.findById`'s null-if-missing convention) and `update(id, data: Partial<NewVacancy>): Promise<Vacancy>`.
- **Non-owner vs unknown-id response code**: `stage-1-api-plan.md`'s Step 4 (list/view own vacancies) already sets the precedent — "get-by-id 404s for another recruiter's vacancy" — i.e. don't distinguish "doesn't exist" from "exists but isn't yours" (avoids leaking existence to a recruiter who shouldn't know). Step 3's own line says "non-owner gets 403/404" (either acceptable) — following Step 4's precedent for consistency: **404** for both not-found and not-owned.
- **Malformed `:id` param risk**: Drizzle/node-postgres throws a raw Postgres error ("invalid input syntax for type uuid") if a non-UUID string is compared against a `uuid` column — that would surface as an uncaught 500, not a clean 404. Nest's built-in `ParseUUIDPipe` on the `:id` param catches this before it reaches the service, turning it into a 400 instead. No existing precedent for this in the codebase (first `:id`-param route) — using the built-in pipe, no custom code needed.
- **No existing `NotFoundException` usage yet** (checked — this is the first owner-scoped single-resource route). Nest's built-in `NotFoundException` is the standard, idiomatic choice; no custom exception needed.
- **DTO pattern**: mirrors `CreateVacancyDto`, but every field optional (partial update) — `@IsOptional() @IsString() @MinLength(1) title?`, same for `requirements`, plus `@IsOptional() @IsIn(['open', 'closed']) status?`. `whitelist: true` global pipe already strips unknown fields (still blocks `recruiterId`/`applyToken`/`createdAt` from being set via the body).

## Architecture Decisions

- **Ownership check happens once, in the service**, before any mutation: `findById` the vacancy, `404` if missing or `vacancy.recruiterId !== recruiterId`, otherwise call `update`. `update` itself doesn't re-check ownership — it trusts the service's prior check (same single-request-scope pattern as everywhere else in this codebase; no separate transaction needed since there's no concurrent-delete feature yet).
- **`update` takes a plain partial patch object** — the service builds `{ ...(dto.title && { title: dto.title }), ... }`-style partial data from only the DTO fields that were actually provided, so an omitted field is left untouched in the row (true partial update, not overwritten with `undefined`).
- **`ParseUUIDPipe` on `:id`** — turns a malformed id into a clean `400` instead of a raw DB error leaking as `500`.

## Task List

### Task 1: Repository read/update methods

**Description:** Add `findById(id: string): Promise<Vacancy | null>` and `update(id: string, data: Partial<NewVacancy>): Promise<Vacancy>` to `VacanciesRepository` + `DrizzleVacanciesRepository` (mirrors `DrizzleRecruitersRepository.findById`'s `eq(...)` + null-coalesce pattern for the former; `.update(vacancies).set(data).where(eq(vacancies.id, id)).returning()` for the latter).
**Acceptance criteria:**

- [ ] `npm run build --workspaces` succeeds
- [ ] New integration tests in `test/repositories/vacancies.repository.integration-spec.ts`: `findById` returns the row / `null` for an unknown id; `update` persists a partial change and leaves untouched fields as-is
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/db/repositories/vacancies.repository.ts`, `apps/api/src/db/repositories/drizzle-vacancies.repository.ts`, `apps/api/test/repositories/vacancies.repository.integration-spec.ts`
      **Size:** S

### Task 2: `PATCH /vacancies/:id` endpoint

**Description:** Create `UpdateVacancyDto` (`vacancies/dto/update-vacancy.dto.ts`, all fields optional per Research Findings). Add `VacanciesService.update(recruiterId: string, vacancyId: string, dto: UpdateVacancyDto): Promise<Vacancy>` — `findById`, throw `NotFoundException` if missing/not-owned, else build the partial patch and call `update`. Add `VacanciesController`'s `@Patch(':id')` handler (`@Param('id', ParseUUIDPipe) id: string`, `@CurrentUser() user: AuthUser`, `@Body() dto: UpdateVacancyDto`).
**Acceptance criteria:**

- [ ] `npm run build --workspaces` succeeds
- [ ] New e2e cases in `test/vacancies.e2e-spec.ts`: happy path field update; happy path close (`status: 'closed'`); non-owner (second recruiter) → 404; unknown id → 404; validation error (invalid `status` value) → 400
      **Verification:** `npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/vacancies/dto/update-vacancy.dto.ts`, `apps/api/src/vacancies/vacancies.service.ts`, `apps/api/src/vacancies/vacancies.controller.ts`, `apps/api/test/vacancies.e2e-spec.ts`
      **Size:** M

### Task 3: Final verification

**Description:** Full local suite in sequence: build, lint, `prettier --check .`, unit, integration, e2e. Confirm no regression in existing auth/vacancy-create e2e tests.
**Acceptance criteria:**

- [ ] All of the above green locally
      **Verification:** `npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test --workspaces && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
      **Dependencies:** 2
      **Files:** none (verification only)
      **Size:** XS

---

### Checkpoint: Step 3 complete

- [ ] `PATCH /vacancies/:id` updates fields and/or closes a vacancy owned by the authenticated recruiter
- [ ] Non-owner and unknown-id both return 404 (no existence leak); malformed id returns 400
- [ ] Full local suite green; matches Step 3's E2E acceptance criteria in `stage-1-api-plan.md`
- [ ] CI green on a real PR

## Commit Plan

One commit per task, in dependency order (per CLAUDE.md: ask before each actual commit).

| #   | Task                      | Commit message                                        |
| --- | ------------------------- | ----------------------------------------------------- |
| 1   | 1: Repository read/update | `feat(db): add vacancy findById and update`           |
| 2   | 2: PATCH endpoint         | `feat(vacancies): add PATCH /vacancies/:id`           |
| 3   | 3: Docs/checkpoint update | `docs: mark step 3 complete` (only after CI verified) |

## Risks and Mitigations

| Risk                                                                                               | Impact            | Mitigation                                                                                                |
| -------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| Malformed `:id` causes a raw Postgres error instead of a clean HTTP error                          | Medium (500 leak) | `ParseUUIDPipe` on the route param                                                                        |
| Ownership check bypass if `update` doesn't trust the service's prior `findById` check consistently | Low               | Single code path — service always calls `findById` then `update`, no alternate route into `update` exists |

## Open Questions

None blocking — this step is a straightforward extension of Step 2's already-established repository/module/DTO pattern, with response-code precedent already set by Step 4's plan description.
