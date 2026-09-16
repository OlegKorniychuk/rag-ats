# Implementation Plan: Step 2 — Create vacancy + auto-generated apply link

**Status: complete.** All 3 tasks done, full local suite green, PR #5 CI green in 1m26s.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 2 is: `POST /vacancies` — a recruiter creates a vacancy (title + requirements) and the response includes an auto-generated, unguessable public apply link/token (`nanoid`), per SPEC.md stories 1 and 2 (one endpoint covers both). Owner = the requesting recruiter (from the JWT cookie session built in Step 1).

The `vacancies` table already exists in `apps/api/src/db/schema.ts` (Phase 0): `id`, `recruiterId` (FK → `recruiters.id`), `title`, `requirements`, `applyToken` (unique), `status` (enum `open`/`closed`, default `open`), `createdAt`. No migration needed — schema is untouched by this step.

`main` (post-PR #4) is now native ESM (`apps/api/package.json` `"type": "module"`, `tsconfig.json` `moduleResolution: NodeNext`). This step's new files follow that: relative imports need explicit `.js` extensions, and type-only imports from our own modules must use `import type` (or an inline `type` modifier) — real ESM's strict module linker throws at runtime otherwise (see `docs/plans/esm-migration-plan.md`'s Research Findings for why).

This step follows the exact module/repository/DTO conventions established in Step 1 (`auth/`) and Phase 0 (`db/repositories/recruiters.repository.ts` + Drizzle impl), and SPEC.md's own example snippet for `vacancies.controller.ts` (`@Controller('vacancies')`, `@UseGuards(JwtAuthGuard)`, `@CurrentUser() user: AuthUser`, owner-scoped service call).

## Research Findings

- **`nanoid` needs no version pin now.** Previously (pre-ESM-migration) `nanoid`'s latest majors (v5/v6) were ESM-only and broke this project's then-CommonJS Jest setup — the same trap that hit `@nestjs/jwt@12`. Now that `apps/api` is native ESM, latest `nanoid@6.0.1` (pure ESM, confirmed via `npm view nanoid version type`) works with no special handling. Use latest, unpinned.
- **Schema already complete** — no Drizzle migration needed for this step. `applyToken` is already `.notNull().unique()`, so a DB-level uniqueness guarantee backs the app-level nanoid generation (astronomically unlikely to collide at this data scale, but the constraint is a free safety net).
- **Repository pattern to mirror exactly** (re-verified against current, post-ESM-migration `main`): `db/repositories/recruiters.repository.ts` (interface + `Injectable`/`NewX`/`X` types + a `Symbol` DI token, exported as `export type X = ...` and imported elsewhere via `import type`) and `db/repositories/drizzle-recruiters.repository.ts` (`TransactionHost<AppTransactionAdapter>`, `this.txHost.tx` read fresh per call — never cached, since the repository is a singleton; type-only imports marked `import type`). Register the new provider in `db/repositories.module.ts` (already `@Global()`, so no re-import needed in `VacanciesModule`).
- **Owner-scoping**: SPEC.md's "Always do" list requires owner-scoping enforced in the _service_ layer, not just the controller. For this step (create-only, no read/update yet) that means: the service always sets `recruiterId` from the authenticated `AuthUser`, never from client input — the `CreateVacancyDto` has no `recruiterId` field at all, so there's nothing for a client to override.
- **Validation**: mirror `RegisterDto`'s style (`class-validator` decorators, `whitelist: true` global pipe already strips unknown fields). `title`/`requirements` both required non-empty strings.
- **ESM import-style checklist for all new files** (from `docs/plans/esm-migration-plan.md`): every relative import ends in `.js`; any import that's purely a type (interfaces, `type` aliases like `Vacancy`/`NewVacancy`) must be `import type { X } from './y.js'`, or use an inline `type` modifier when mixed with a value in the same statement (e.g. `import { RECRUITERS_REPOSITORY, type RecruitersRepository } from '...'`).

## Architecture Decisions

- **New `vacancies/` module**, structured exactly like `auth/`: `vacancies.module.ts`, `vacancies.controller.ts`, `vacancies.service.ts`, `dto/create-vacancy.dto.ts`.
- **New `db/repositories/vacancies.repository.ts`** (interface) + **`db/repositories/drizzle-vacancies.repository.ts`** (impl), registered in `repositories.module.ts` alongside `RECRUITERS_REPOSITORY`. Only a `create` method is needed for this step (list/get arrive in Steps 3–4).
- **nanoid generation lives in the service**, not the repository — the repository just persists whatever `applyToken` it's given (keeps it a thin persistence layer, consistent with `RecruitersRepository`, and matches how `AuthService` does bcrypt hashing itself before calling `.create()`).
- **Response shape**: return the full created vacancy row (id, title, requirements, applyToken, status, createdAt) — the client builds the shareable link client-side from `applyToken` (`/apply/:token`), consistent with SPEC.md not specifying a full URL (no base-URL config exists yet).
- **`VacanciesModule` imports nothing beyond what's needed** — `RECRUITERS_REPOSITORY`/`VACANCIES_REPOSITORY` come from the global `RepositoriesModule`; `JwtAuthGuard`/`CurrentUser`/`AuthUser` are imported directly from `auth/` (no barrel file exists, matching current single-file-import style).
- **`nanoid` added as a Task 1 dependency**, unpinned (latest).

## Task List

### Task 1: Vacancies repository

**Description:** Add `VacanciesRepository` interface (`db/repositories/vacancies.repository.ts`, `create(data: NewVacancy): Promise<Vacancy>`, `VACANCIES_REPOSITORY` token) + Drizzle impl (`db/repositories/drizzle-vacancies.repository.ts`, mirroring `drizzle-recruiters.repository.ts`'s `txHost.tx` pattern and `import type` usage). Register in `repositories.module.ts`.
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] New integration test (`test/repositories/vacancies.repository.integration-spec.ts`, Testcontainers) covers: `create` persists a row with a recruiter FK; unique `applyToken` constraint is enforced (duplicate token insert rejected)
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/db/repositories/vacancies.repository.ts`, `apps/api/src/db/repositories/drizzle-vacancies.repository.ts`, `apps/api/src/db/repositories.module.ts`, `apps/api/test/repositories/vacancies.repository.integration-spec.ts`
      **Size:** S

### Task 2: `POST /vacancies` endpoint

**Description:** Add `nanoid` dependency (latest, unpinned). Create `CreateVacancyDto` (`title`, `requirements`: both `@IsString() @MinLength(1)`). Create `VacanciesService.create(recruiterId: string, dto: CreateVacancyDto)` — generates the apply token via `nanoid()`, calls the repository with `{ recruiterId, title: dto.title, requirements: dto.requirements, applyToken }`. Create `VacanciesController` (`@Controller('vacancies')`, `@UseGuards(JwtAuthGuard)`, `POST /` reads `@CurrentUser() user: AuthUser` and `@Body() dto: CreateVacancyDto`). Create `VacanciesModule` (controller + service + provider wiring) and import it into `AppModule`.
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] New e2e suite (`test/vacancies.e2e-spec.ts`): happy path (authenticated, valid body → 201, response includes a non-empty `applyToken` and `status: 'open'`); unauthenticated request (no cookie) → 401; validation errors (missing `title`, missing `requirements`) → 400
      **Verification:** `npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/package.json`, `apps/api/src/vacancies/vacancies.module.ts`, `apps/api/src/vacancies/vacancies.controller.ts`, `apps/api/src/vacancies/vacancies.service.ts`, `apps/api/src/vacancies/dto/create-vacancy.dto.ts`, `apps/api/src/app.module.ts`, `apps/api/test/vacancies.e2e-spec.ts`
      **Size:** M

### Task 3: Final verification

**Description:** Full local suite in sequence: build, lint, `prettier --check .`, unit, integration, e2e. Confirm no regression in existing `auth.e2e-spec.ts`/`app.e2e-spec.ts`.
**Acceptance criteria:**

- [x] All of the above green locally
      **Verification:** `npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test --workspaces && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
      **Dependencies:** 2
      **Files:** none (verification only)
      **Size:** XS

---

### Checkpoint: Step 2 complete

- [x] `POST /vacancies` creates a vacancy owned by the authenticated recruiter with a working, unique apply token
- [x] Unauthenticated and validation-error cases rejected correctly
- [x] Full local suite green; matches Step 2's E2E acceptance criteria in `stage-1-api-plan.md`
- [x] CI green on a real PR

## Commit Plan

One commit per task, in dependency order (per CLAUDE.md: ask before each actual commit).

| #   | Task                       | Commit message                                                                               |
| --- | -------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 1: Vacancies repository    | `feat(db): add vacancies repository`                                                         |
| 2   | 2: Create-vacancy endpoint | `feat(vacancies): add POST /vacancies with apply token`                                      |
| 3   | 3: Docs/checkpoint update  | `docs: mark step 2 complete` (only after CI verified, mirroring Step 1/typed-config pattern) |

## Risks and Mitigations

| Risk                                                                                                | Impact                                                               | Mitigation                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forgetting the post-ESM-migration import conventions (`.js` extensions, `import type`) in new files | Medium (runtime `SyntaxError`/module-not-found, not caught by `tsc`) | Full e2e suite (not just build) is required verification for Task 2 — this class of bug only surfaces at Jest runtime, per `docs/plans/esm-migration-plan.md` |
| Client could try to set `recruiterId`/`status` on create                                            | Low (owner-scoping bypass)                                           | `CreateVacancyDto` has no such fields; global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` strips/rejects any extra body fields          |
| `applyToken` collision                                                                              | Very low                                                             | DB `unique()` constraint on `applyToken` backs the nanoid generation                                                                                          |

## Open Questions

None blocking — schema pre-exists, module/repo/DTO conventions are already established by Step 1 and Phase 0, SPEC.md's own example snippet pins the controller shape, and the ESM migration (PR #4, now merged) removes the earlier `nanoid` version-pin concern entirely.
