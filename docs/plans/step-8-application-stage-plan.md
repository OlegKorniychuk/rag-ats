# Implementation Plan: Step 8 — Move an application through pipeline stages

**Status: complete.** All tasks done, full local suite green (unit 14, integration 27, e2e 57), PR #12 CI green in 1m17s.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 8: `PATCH /applications/:id` — a recruiter moves an applicant through the pipeline (`applied → screened → interview → rejected/hired`). Scoped via the **parent vacancy's owner**: only the recruiter who owns the application's vacancy may change it. Per Stage 1 decisions, transitions are **not** order-restricted — any valid enum value is accepted. Builds on Step 7 (PR #11, merged): Drizzle relations (`applications.vacancy`, non-optional) and `ApplicationsRepository` already exist. Completes the stage-1 "Pipeline management" checkpoint.

## Research Findings

- `applicationStageEnum` in `apps/api/src/db/schema.ts` — `pgEnum('application_stage', ['applied','screened','interview','rejected','hired'])`; `.enumValues` gives the tuple, so the DTO can reuse it instead of re-listing values (unlike `UpdateVacancyDto`, which hardcodes `['open','closed']`).
- `ApplicationsRepository` (`apps/api/src/db/repositories/applications.repository.ts`): `create`, `findByVacancyAndCandidate`, `findByVacancyIdWithCandidate`. Needs a read that includes the vacancy (for owner check) and an update. Relation `applications.vacancy` is defined with `optional: false` → `with: { vacancy: true }` types non-nullable.
- Owner-scoping convention: 404 for both "doesn't exist" and "not yours" (`VacanciesService.getOwnedVacancy`). Same here, enforced in the service layer (SPEC "Always do").
- Auth: global `JwtAuthGuard` (APP_GUARD) — new controller is guarded by default, no `@UseGuards`. `@CurrentUser() user: AuthUser` gives recruiter id. `ParseUUIDPipe` on `:id` for malformed → 400.
- Module pattern: `apps/api/src/vacancies/` (module/controller/service/dto), wired in `app.module.ts`; `RepositoriesModule` is `@Global()`.

## Architecture Decisions

- **New `applications/` module** (`ApplicationsModule`, `ApplicationsController` `@Controller('applications')`, `ApplicationsService`) — the resource isn't nested under `/vacancies`, and Stage 2 fit scoring will also hang off applications.
- **Repository**: `findByIdWithVacancy(id): Promise<ApplicationWithVacancy | null>` (`query.applications.findFirst({ where: { id }, with: { vacancy: true } })`) + `updateStage(id, stage): Promise<Application>` (`.update().set({ stage }).where(eq(id)).returning()`). `ApplicationWithVacancy = Application & { vacancy: Vacancy }`.
- **Service** `updateStage(recruiterId, applicationId, dto)`: load with vacancy → `NotFoundException('Application not found')` if missing or `vacancy.recruiterId !== recruiterId` → update. No transaction needed (single write after a read; no concurrent-delete feature).
- **DTO** `UpdateApplicationDto`: `stage` required, `@IsIn(applicationStageEnum.enumValues)`; type `(typeof applicationStageEnum.enumValues)[number]`.
- **Response**: updated application row (raw, like other recruiter endpoints) — no candidate/vacancy nesting.

## Task List

### Task 1: Repository read-with-vacancy + update stage

**Description:** Add `ApplicationWithVacancy`, `findByIdWithVacancy`, `updateStage` to `ApplicationsRepository` / `DrizzleApplicationsRepository`.
**Acceptance criteria:**

- [x] Integration tests: `findByIdWithVacancy` returns row with populated `vacancy` (check `vacancy.recruiterId`) / `null` for unknown id; `updateStage` persists new stage, leaves vacancyId/candidateId untouched
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/db/repositories/applications.repository.ts`, `drizzle-applications.repository.ts`, `apps/api/test/repositories/applications.repository.integration-spec.ts`
      **Size:** S

### Task 2: `PATCH /applications/:id`

**Description:** `applications/` module: DTO, service (owner check via vacancy), controller (`@Patch(':id')`, `ParseUUIDPipe`), wired into `app.module.ts`.
**Acceptance criteria:**

- [x] New `test/applications.e2e-spec.ts` (application created via public `POST /apply/:token`): owner moves `applied → screened` → 200 with `stage: 'screened'`; then `→ hired` (no order restriction; also verify skip e.g. `applied → interview` works); change visible via `GET /vacancies/:id/applications`; invalid stage → 400; missing stage → 400; another recruiter → 404 (and stage unchanged); unknown uuid → 404; malformed id → 400; no cookie → 401
      **Verification:** build + `npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/applications/{applications.module,applications.controller,applications.service}.ts`, `apps/api/src/applications/dto/update-application.dto.ts`, `apps/api/src/app.module.ts`, `apps/api/test/applications.e2e-spec.ts`
      **Size:** M

### Task 3: Final verification

**Verification:** `rm -f apps/api/tsconfig.build.tsbuildinfo && npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test -w apps/api && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
**Dependencies:** 2 · **Size:** XS

---

### Checkpoint: Step 8 complete (closes stage-1 "Pipeline management" checkpoint)

- [x] Owner can move an applicant to any stage; visible in the vacancy's applicant list
- [x] Non-owner / unknown → 404 (owner check in service layer); invalid stage/malformed id → 400; unauthenticated → 401
- [x] Full local suite green; CI green on PR

## Execution

Sonnet subagents (general-purpose, `model: sonnet`), one per task, self-contained briefs; write code + run verification, **no commits**. I review diffs, re-run suites myself, ask approval before each commit. Push, PR (no test plan, no attribution), poll CI, docs commit (tick pipeline checkpoint in stage-1 plan).

## Commit Plan

Branch `feat/step-8-application-stage` off `main` (PR #11 merged).

| #   | Task          | Commit message                                          |
| --- | ------------- | ------------------------------------------------------- |
| 1   | 1: Repository | `feat(db): load application with vacancy, update stage` |
| 2   | 2: Endpoint   | `feat(applications): add PATCH /applications/:id`       |
| 3   | Docs          | `docs: mark step 8 complete` (after CI green)           |

## Risks and Mitigations

| Risk                                                  | Impact | Mitigation                                                                        |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| Non-owner can change another recruiter's pipeline     | High   | Service-layer check on `vacancy.recruiterId`; e2e asserts 404 and stage unchanged |
| Stage enum values duplicated in DTO drift from schema | Low    | DTO derives from `applicationStageEnum.enumValues`                                |

## Open Questions

None.
