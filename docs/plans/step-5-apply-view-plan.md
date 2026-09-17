# Implementation Plan: Step 5 — Public: view a vacancy by apply token

**Status: complete.** All 3 tasks done, full local suite green, PR #9 CI green in 1m10s.

## Context

Per `docs/plans/stage-1-api-plan.md`, Step 5: `GET /apply/:token` (public, unguarded) — an applicant opens a vacancy's public link and sees role details before applying. This is the first entirely public (unauthenticated) route in the API. Every route so far has been guarded by explicitly adding `@UseGuards(JwtAuthGuard)` per-controller/route (opt-in). Dude wanted to flip that: make `JwtAuthGuard` apply app-wide by default, and mark the few genuinely public routes with an explicit `@Public()` decorator instead — the safer default for an API where "forgot to add the guard" is a real risk as more routes get added (Step 5 onward adds the first ones that are _supposed_ to be public, so this is the right moment to make the default fail closed).

This is Nest's own documented pattern for global auth (`APP_GUARD` + a `Reflector`-based `@Public()`/`SetMetadata` decorator) — not a custom invention.

## Research Findings

- **Every current guard site** (confirmed via `grep -rn "@UseGuards" apps/api/src`): `VacanciesController` (controller-level, guards all 4 routes) and `AuthController.me()` (method-level). `register`/`login`/`logout` on `AuthController` and `AppController.getHello()` are implicitly public (no guard was ever added) — once the guard becomes global, these need an explicit `@Public()` or they'll start 401ing, breaking `app.e2e-spec.ts`'s `GET / returns 200` and the register/login e2e flows.
- **`JwtAuthGuard`** (`apps/api/src/auth/jwt-auth.guard.ts`) needed the standard Nest override: inject `Reflector`, check `IS_PUBLIC_KEY` via `getAllAndOverride` before delegating to `super.canActivate()`.
- **Global registration**: `AuthModule` already provides `JwtStrategy`/`JwtModule`/`PassportModule` and is imported into `AppModule` — `{ provide: APP_GUARD, useClass: JwtAuthGuard }` added to `AuthModule`'s `providers` is the natural place; Nest resolves `APP_GUARD` globally regardless of which imported module declares it.
- **No test instantiated `JwtAuthGuard` directly**, so adding the `Reflector` constructor param was safe — Nest's DI resolves it automatically.
- `RepositoriesModule` is `@Global()` — the new `ApplyModule` injects `VACANCIES_REPOSITORY` directly, same as `VacanciesModule`.
- Per the closed-vacancy Stage-Split Decision in `stage-1-api-plan.md`: the public apply page still resolves for closed vacancies (GET works); only submitting (POST, Step 6) is rejected.
- Response shape: must not leak `recruiterId` or echo `applyToken`/`id` back. "Role details" → `title`, `requirements`, `status` is the minimal public-safe projection — the first response in this codebase needing field-level shaping.

## Architecture Decisions

- **`@Public()` decorator** (`apps/api/src/auth/public.decorator.ts`): `SetMetadata`-based, lives in `auth/` alongside the guard it toggles.
- **Global guard via `APP_GUARD`** in `AuthModule` — `VacanciesController` needs no decorator at all (guarded by default). `AuthController`: `@Public()` on `register`/`login`/`logout`, nothing on `me()`. `AppController.getHello()`: `@Public()`.
- **New `apply/` module** (`apps/api/src/apply/`): `ApplyModule`, `ApplyController` (`@Controller('apply')`, `@Public()` at controller level), `ApplyService`. Mirrors `vacancies/`'s module/controller/service shape, no repository of its own.
- **`ApplyService.getByToken(token)`**: `NotFoundException` on a missed lookup, else maps the row down to `{ title, requirements, status }`.

## Task List

### Task 1: Global auth guard + `@Public()` decorator

**Description:** Add `public.decorator.ts`. Update `JwtAuthGuard` to check `IS_PUBLIC_KEY` via `Reflector` before delegating to `super.canActivate()`. Register `{ provide: APP_GUARD, useClass: JwtAuthGuard }` in `AuthModule`. Remove `@UseGuards(JwtAuthGuard)` from `VacanciesController` (controller-level) and `AuthController.me()`. Add `@Public()` to `AuthController.register/login/logout` and `AppController.getHello()`.
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] Full existing e2e suite still passes unchanged (`app.e2e-spec.ts`, `auth.e2e-spec.ts`, `vacancies.e2e-spec.ts`)
      **Verification:** build + `npm run test:e2e -w apps/api`
      **Dependencies:** None
      **Files:** `apps/api/src/auth/public.decorator.ts`, `apps/api/src/auth/jwt-auth.guard.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/vacancies/vacancies.controller.ts`, `apps/api/src/app.controller.ts`
      **Size:** S

### Task 2: `GET /apply/:token`

**Description:** Add `findByApplyToken` to `VacanciesRepository`/`DrizzleVacanciesRepository` (RQBv2 `findFirst`, same null-coalesce pattern as `findById`). Create `apps/api/src/apply/` module: `ApplyService.getByToken(token)` (404 on miss, else `{ title, requirements, status }`), `ApplyController` (`@Controller('apply')`, `@Public()`, `@Get(':token')`). Wire `ApplyModule` into `app.module.ts`.
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] New integration test in `test/repositories/vacancies.repository.integration-spec.ts`: `findByApplyToken` returns the row for a known token / `null` for an unknown token
- [x] New e2e file `test/apply.e2e-spec.ts`: valid token → 200 with `{ title, requirements, status }`; unknown token → 404; closed vacancy's token still resolves 200 (status `closed`)
      **Verification:** build + `npm run test:integration -w apps/api` + `npm run test:e2e -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/db/repositories/vacancies.repository.ts`, `apps/api/src/db/repositories/drizzle-vacancies.repository.ts`, `apps/api/src/apply/apply.module.ts`, `apps/api/src/apply/apply.controller.ts`, `apps/api/src/apply/apply.service.ts`, `apps/api/src/app.module.ts`, `apps/api/test/repositories/vacancies.repository.integration-spec.ts`, `apps/api/test/apply.e2e-spec.ts`
      **Size:** M

### Task 3: Final verification

**Description:** Full local suite in sequence: build, lint, `prettier --check .`, unit, integration, e2e.
**Acceptance criteria:**

- [x] All of the above green locally
      **Verification:** `npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
      **Dependencies:** 2
      **Files:** none (verification only)
      **Size:** XS

---

### Checkpoint: Step 5 complete

- [x] Auth guard is global by default; only explicitly `@Public()`-marked routes skip it
- [x] `GET /apply/:token` returns role details (title/requirements/status) for a valid token, with no auth required
- [x] Unknown token → 404; closed-vacancy token still resolves
- [x] Response never includes `id`, `recruiterId`, or `applyToken`
- [x] Full local suite green; matches Step 5's E2E acceptance criteria in `stage-1-api-plan.md`
- [x] CI green on a real PR

## Commit Plan

Branch: `feat/step-5-apply-view` off `main` (has PR #8 merged). One commit per task (per CLAUDE.md: ask before each actual commit).

| #   | Task                          | Commit message                                            |
| --- | ----------------------------- | --------------------------------------------------------- |
| 1   | 1: Global guard + `@Public()` | `refactor(auth): make JwtAuthGuard global, add @Public()` |
| 2   | 2: `GET /apply/:token`        | `feat(apply): add public GET /apply/:token`               |
| 3   | 3: Docs/checkpoint update     | `docs: mark step 5 complete` (only after CI verified)     |

## Risks and Mitigations

| Risk                                                            | Impact | Mitigation                                                                                            |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Global guard flip silently 401s a route that should stay public | High   | Task 1 verified against the entire existing e2e suite before any new feature code was written         |
| Response accidentally leaks `recruiterId`/internal `id`         | Medium | Service explicitly picks only `title`/`requirements`/`status`; e2e test asserts happy-path body shape |
| Closed-vacancy view accidentally blocked                        | Low    | Dedicated e2e case: create + close a vacancy, then GET its token, expect 200                          |

## Open Questions

None blocking.
