# Implementation Plan: Step 7 — List applicants for one of my vacancies

**Status: complete.** All tasks done, full local suite green (unit 14, integration 24, e2e 47), PR #11 CI green in 1m28s.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 7: `GET /vacancies/:id/applications` — a recruiter sees every candidate who applied to one of **their** vacancies, with each application's pipeline stage. Unranked in Stage 1 (Stage 2 adds fit-score ranking). Owner-scoped: non-owner and unknown vacancy both 404 (existing convention). This also covers the "applications" half of Step 4's "see only what I created" story. Builds on Step 6 (PR #10, merged): `ApplicationsRepository`, `CandidatesRepository`, and the public `POST /apply/:token` that creates applications.

## Research Findings

- `VacanciesService.getOwnedVacancy(recruiterId, vacancyId)` (`apps/api/src/vacancies/vacancies.service.ts`) already does the 404-for-missing-or-not-owned check — reuse it; no new owner-scoping logic.
- `VacanciesController` (`apps/api/src/vacancies/vacancies.controller.ts`) is guarded by the global `JwtAuthGuard` (APP_GUARD) — nothing to add for auth; `:id` uses `ParseUUIDPipe`.
- `ApplicationsRepository` (`apps/api/src/db/repositories/applications.repository.ts`) has `create`, `findByVacancyAndCandidate` — needs a list method that also returns the candidate.
- `schema.ts` ends with `export const dbRelations = defineRelations(schema)` — **no relations defined**, so RQBv2 `with: { candidate: true }` isn't available yet. Relations are TS-only (no migration). drizzle-orm `1.0.0-rc.4` uses `defineRelations(schema, (r) => ({ applications: { candidate: r.one.candidates({ from: r.applications.candidateId, to: r.candidates.id }) } }))` — exact shape to be checked against `node_modules/drizzle-orm/relations.d.ts`.

## Architecture Decisions

- **Define relations** in `schema.ts`: `applications.candidate` + `applications.vacancy` (one), `candidates.applications` + `vacancies.applications` (many), `vacancies.recruiter` (one). Only `applications.candidate` is used now; the rest are the natural inverse/sibling definitions Steps 8–9 will need (Step 8 scopes an application via its vacancy's owner). Kept minimal otherwise.
- **Repository**: `findByVacancyIdWithCandidate(vacancyId): Promise<ApplicationWithCandidate[]>` via `query.applications.findMany({ where: { vacancyId }, with: { candidate: true }, orderBy: { createdAt: 'desc' } })` — one query, newest first (matches `GET /vacancies`). `ApplicationWithCandidate = Application & { candidate: Candidate }`.
- **Service**: `VacanciesService.findApplications(recruiterId, vacancyId)` → `getOwnedVacancy` then repository call. Lives in `VacanciesService` because the resource is nested under `/vacancies/:id`; a dedicated applications module comes in Step 8 (`PATCH /applications/:id`).
- **Response**: array of `{ id, stage, createdAt, vacancyId, candidateId, candidate: { full profile } }` — raw rows like the rest of the recruiter API. Full candidate profile is fine: recruiters can see any candidate in the shared pool (SPEC, Step 9).

## Task List

### Task 1: Relations + repository list method

**Description:** Add relations to `defineRelations` in `schema.ts`; add `ApplicationWithCandidate` type + `findByVacancyIdWithCandidate` to `ApplicationsRepository` / `DrizzleApplicationsRepository`.
**Acceptance criteria:**

- [x] `npm run db:generate -w apps/api` produces **no** new migration (relations are TS-only) — if it does, stop
- [x] Integration tests (`test/repositories/applications.repository.integration-spec.ts`): returns only that vacancy's applications, newest first, each with populated `candidate`; empty array for a vacancy with none
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/db/schema.ts`, `apps/api/src/db/repositories/applications.repository.ts`, `apps/api/src/db/repositories/drizzle-applications.repository.ts`, `apps/api/test/repositories/applications.repository.integration-spec.ts`
      **Size:** S

### Task 2: `GET /vacancies/:id/applications`

**Description:** Inject `APPLICATIONS_REPOSITORY` into `VacanciesService`, add `findApplications`; add `@Get(':id/applications')` (`ParseUUIDPipe`) to `VacanciesController`.
**Acceptance criteria:**

- [x] E2E (`test/vacancies.e2e-spec.ts`, new describe; applications created via public `POST /apply/:token`): happy path — 2 applicants listed with stage `applied` and candidate name/email; applicant to a _different_ vacancy not included; empty list → 200 `[]`; non-owner → 404; unknown id → 404; malformed id → 400; no cookie → 401
      **Verification:** build + `npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/vacancies/vacancies.service.ts`, `apps/api/src/vacancies/vacancies.controller.ts`, `apps/api/test/vacancies.e2e-spec.ts`
      **Size:** S

### Task 3: Final verification

**Verification:** `rm -f apps/api/tsconfig.build.tsbuildinfo && npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test -w apps/api && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
**Dependencies:** 2 · **Size:** XS

---

### Checkpoint: Step 7 complete

- [x] Owner sees all applicants (with stage + candidate profile) for their vacancy; empty list works
- [x] Non-owner / unknown → 404; malformed → 400; unauthenticated → 401
- [x] Full local suite green; CI green on PR

## Execution

Sonnet subagents (general-purpose, `model: sonnet`), one per task, self-contained briefs; they write code + run verification but **do not commit**. I review each diff and re-run the suites myself (don't trust reported counts — last step's were wrong), then ask approval before each commit. Push, PR (no test plan, no attribution), poll CI, docs commit.

## Commit Plan

Branch `feat/step-7-vacancy-applications` off `main` (PR #10 merged).

| #   | Task                | Commit message                                                 |
| --- | ------------------- | -------------------------------------------------------------- |
| 1   | 1: Relations + repo | `feat(db): define relations, list applications with candidate` |
| 2   | 2: Endpoint         | `feat(vacancies): add GET /vacancies/:id/applications`         |
| 3   | Docs                | `docs: mark step 7 complete` (after CI green)                  |

## Risks and Mitigations

| Risk                                                                    | Impact | Mitigation                                                                  |
| ----------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| Relations change unexpectedly generates a migration                     | Low    | Explicit `db:generate` check in Task 1; stop if a migration appears         |
| Defining relations changes existing `findFirst`/`findMany` result types | Low    | Relations only add opt-in `with`; full suite re-run confirms no regressions |
| Listing leaks another vacancy's applicants                              | Medium | E2E seeds an applicant on a second vacancy and asserts absence              |

## Open Questions

None.
