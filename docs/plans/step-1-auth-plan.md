# Implementation Plan: Step 1 — Recruiter Auth (JWT httpOnly Cookie)

## Context

Phase 0 (foundation) is done and merged (PR #1): monorepo, Drizzle schema, repository pattern with working `@Transactional()` support, Testcontainers integration harness, CI. `docs/plans/stage-1-api-plan.md` sequences 9 per-story steps on top of that; this is the detailed breakdown of **Step 1**: recruiter registration, login, session via JWT httpOnly cookie — the first real feature and the auth foundation every later guarded/owner-scoped endpoint depends on.

Refresh-token flow was considered and explicitly dropped for now (SPEC.md line 53 is explicit: "Single JWT, fixed ~7-day expiry, no refresh-token flow" — kept as-is, no SPEC change).

Per SPEC.md's Testing Strategy, this step is exercised via **e2e tests (Jest + Supertest, `@nestjs/testing`)** against a real Postgres — unlike Phase 0 (no HTTP layer existed yet), Step 1 has actual controllers/HTTP routes, so real e2e is now possible and required. Per CLAUDE.md, integration/e2e tests use **Testcontainers** (no shared/manual test DB), continuing Phase 0's pattern but now booting the _full_ `AppModule` (HTTP layer, guards, pipes) instead of just the DB/repository layer.

## Research Findings

- `@nestjs/passport@^12` requires `@nestjs/common ^11||^12` — **incompatible** with this project's Nest 10 (same class of pitfall as the earlier `@nestjs/config@12` issue). Fix: pin `@nestjs/passport@^10.0.3` (peer: `@nestjs/common ^8||^9||^10`, `passport ^0.7.0`).
- `@nestjs/jwt@^12` peers `@nestjs/common` fine, but ships as `"type": "module"` (pure ESM `dist/index.js`, `import jsonwebtoken from 'jsonwebtoken'`) — breaks under this project's ts-jest/CommonJS setup with `SyntaxError: Cannot use import statement outside a module` in every Jest suite that imports `AuthModule` (unit/integration/e2e alike). Discovered when Task 1.4's e2e tests failed. Fix: pin `@nestjs/jwt@^11.0.0` (confirmed CJS output; peers `@nestjs/common ^8||^9||^10||^11`).
- `passport-jwt`'s built-in extractors are header-based only; the httpOnly-cookie requirement (SPEC.md line 53) needs a small custom extractor function reading `req.cookies['access_token']`, which requires `cookie-parser` middleware mounted in `main.ts` before Nest can populate `req.cookies`.
- SPEC.md's Commands section already names a **separate** script, `npm run test:e2e -w apps/api`, distinct from Phase 0's `test:integration`. Phase 0's integration tests compile only `DbModule`/`RepositoriesModule` (no HTTP). Step 1 introduces a genuinely new harness: a full `AppModule` compiled via `@nestjs/testing`, `DRIZZLE` overridden with a Testcontainers Postgres, driven with Supertest — this is the `test:e2e` script SPEC.md already expects.

## Architecture Decisions

- **Cookie name:** `access_token`. Flags: `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, `maxAge` derived from `JWT_EXPIRES_IN` (via the `ms` package, single source of truth shared with the JWT's own `expiresIn`). `NODE_ENV` is added to `env.validation.ts` (`Joi.string().valid('development','production','test').default('development')`) since nothing currently declares it.
- **Global `ValidationPipe`** (`whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`) wired once in `main.ts`, matching SPEC's "DTOs + class-validator" convention — every controller from here on relies on it, so it's Step 1 infra, not repeated per-module.
- **Same 401 for wrong password vs unknown email** (`AuthService.login`) — standard no-user-enumeration practice; not spec'd explicitly but a reasonable default, flagged as a decision rather than silently assumed.
- **Password rule:** `@MinLength(8)` on register/login DTOs — SPEC.md doesn't specify a minimum; picked as a sane default, flagged as a decision.
- **bcrypt salt rounds:** 10 (library default), per SPEC's "hash passwords with bcrypt" boundary.
- **`GET /auth/me`** (guarded) and **`POST /auth/logout`** are added as necessary plumbing (not separate SPEC stories) — `/me` is required to e2e-test the guard's _happy_ path and gives the future frontend a session-check endpoint; `logout` clears the cookie. Both follow the precedent already set for Step 1 in `stage-1-api-plan.md`.
- **`AuthUser` type + `@CurrentUser()` decorator** live in `src/auth/` and are the exact shape SPEC.md's own code sample uses (`@CurrentUser() user: AuthUser`) — every later owner-scoped controller (vacancies, applications) reuses these with zero new wiring.
- **New e2e harness reuses Phase 0's Testcontainers helper** (`test/testcontainers-db.util.ts`, unchanged) but adds a second layer: compile the real `AppModule` via `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(DRIZZLE).useValue(testDb.db)`, call `app.init()`, drive it with `supertest(app.getHttpServer())` (or `supertest.agent(...)` where a session must persist across requests, e.g. login → /me → logout). Required env vars (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`) are set on `process.env` in `beforeAll` before `compile()` so `ConfigModule`'s Joi validation passes; `DATABASE_URL`'s value is irrelevant since `DRIZZLE` is overridden (the real `Pool` DbModule builds from it is never queried, only closed on shutdown).
- **New `jest.e2e.config.ts`** (sibling to `jest.integration.config.ts`, `testRegex: 'test/.*\\.e2e-spec\\.ts$'`) + `test:e2e` script in `apps/api/package.json` and root `package.json`, matching SPEC.md's Commands section exactly. CI gets a new step running it.

## Task List

### Task 1.0: Update general plan

**Description:** Add a pointer from `docs/plans/stage-1-api-plan.md`'s Step 1 section to this new subplan (same pattern as Phase 0's pointer), and update its "Delivers" line to include `GET /auth/me`.
**Acceptance criteria:**

- [x] Step 1 section links `docs/plans/step-1-auth-plan.md`
- [x] "Delivers" line includes `GET /auth/me`
      **Verification:** visual diff review
      **Dependencies:** None
      **Files:** `docs/plans/stage-1-api-plan.md`
      **Size:** XS

### Task 1.1: Auth dependencies + global validation/cookie middleware

**Description:** Install `@nestjs/jwt`, `@nestjs/passport@^10.0.3`, `passport@^0.7.0`, `passport-jwt` (+ `@types/passport-jwt`), `bcrypt` (+ `@types/bcrypt`), `cookie-parser` (+ `@types/cookie-parser`), `class-validator`, `class-transformer`, `ms` (+ `@types/ms`). Wire `app.use(cookieParser())` and `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` in `main.ts`. Add `NODE_ENV` to `env.validation.ts`.
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] App still boots (`npm run start:dev -w apps/api`)
      **Verification:** build + manual boot
      **Dependencies:** None
      **Files:** `apps/api/package.json`, `apps/api/src/main.ts`, `apps/api/src/config/env.validation.ts`, `apps/api/.env.example` (add `NODE_ENV`)
      **Size:** S

### Task 1.2: E2E test harness (Testcontainers + Supertest, full app)

**Description:** `apps/api/test/e2e-app.util.ts` — helper `createTestApp()`: sets required `process.env` vars, calls `createTestDatabase()` (reused from Phase 0), compiles `AppModule` with `DRIZZLE` overridden, `app.init()`, returns `{ app, testDb }`; `closeTestApp()` closes both. `jest.e2e.config.ts`. `apps/api/test/app.e2e-spec.ts` — smoke test hitting the existing `GET /` route to prove the harness end-to-end before any auth code exists. `test:e2e` script (api + root). New CI step.
**Acceptance criteria:**

- [x] `npm run test:e2e -w apps/api` boots the real `AppModule` against an ephemeral Testcontainers Postgres and gets `200` from `GET /`
- [x] Container + app close cleanly (`afterAll`, no leftover container, no open-handle warnings)
- [ ] CI runs the new step as its own visible gate (config added to `ci.yml`; not yet confirmed on a real PR run)
      **Verification:** `npm run test:e2e -w apps/api` locally, then confirm the new CI step passes on the PR
      **Dependencies:** 1.1
      **Files:** `apps/api/test/e2e-app.util.ts`, `apps/api/jest.e2e.config.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/package.json`, `package.json` (root), `.github/workflows/ci.yml`
      **Size:** M

### Task 1.3: Register (`POST /auth/register`)

**Description:** `src/auth/auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `dto/register.dto.ts` (`email: @IsEmail()`, `password: @IsString() @MinLength(8)`). `AuthService.register`: `RECRUITERS_REPOSITORY.findByEmail` → `ConflictException` if taken; else `bcrypt.hash` → `create`; controller returns `{ id, email }` (never the hash). Unguarded route. `AuthModule` imported into `AppModule`.
**Acceptance criteria:**

- [x] Happy path: `201`, body has `id`/`email`, no `passwordHash`
- [x] Duplicate email: `409`
- [x] Missing/invalid email or short password: `400` (global `ValidationPipe`)
      **Verification:** `npm run test:e2e -w apps/api` (new `test/auth.e2e-spec.ts`)
      **Dependencies:** 1.2
      **Files:** `apps/api/src/auth/**`, `apps/api/src/app.module.ts`, `apps/api/test/auth.e2e-spec.ts`
      **Size:** M

### Task 1.4: Login (`POST /auth/login`) — issues JWT cookie

**Description:** `dto/login.dto.ts`. `JwtModule.registerAsync` in `AuthModule` (secret/expiresIn from `ConfigService`). `AuthService.login`: `findByEmail` → `bcrypt.compare`; either failure → same `UnauthorizedException` (no enumeration). On success, sign `{ sub: recruiter.id, email }`, set `access_token` cookie (`httpOnly`, `sameSite: 'lax'`, `secure` per `NODE_ENV`, `maxAge` via `ms(JWT_EXPIRES_IN)`) via `@Res({ passthrough: true })`.
**Acceptance criteria:**

- [x] Happy path: `200`/`201`, `Set-Cookie: access_token=...; HttpOnly; SameSite=Lax` present
- [x] Wrong password: `401`
- [x] Unknown email: `401` (same shape as wrong password)
      **Verification:** `npm run test:e2e -w apps/api` (extends `auth.e2e-spec.ts`)
      **Dependencies:** 1.3
      **Files:** `apps/api/src/auth/**`, `apps/api/test/auth.e2e-spec.ts`
      **Size:** M

### Task 1.5: JwtStrategy, JwtAuthGuard, `@CurrentUser()`, `GET /auth/me`, `POST /auth/logout`

**Description:** `JwtStrategy` (`passport-jwt`) with a custom extractor reading `req.cookies['access_token']`; `validate(payload)` returns `AuthUser` (`{ id, email }`), attached to `req.user`. `JwtAuthGuard extends AuthGuard('jwt')`. `@CurrentUser()` param decorator reads `req.user`. `GET /auth/me` (guarded) returns `AuthUser`. `POST /auth/logout` clears the cookie (`clearCookie` with matching options), unguarded (idempotent no-op if already logged out).
**Acceptance criteria:**

- [x] Valid cookie → `/auth/me` returns the current user
- [x] No cookie → `/auth/me` → `401`
- [x] Tampered/invalid cookie → `/auth/me` → `401`
- [x] `login` → `/me` succeeds → `logout` → same session's next `/me` → `401` (via `supertest.agent`, proving the cookie is actually cleared, not just that logout returns `200`)
      **Verification:** `npm run test:e2e -w apps/api` (completes `auth.e2e-spec.ts` — matches `stage-1-api-plan.md`'s full Step 1 e2e list)
      **Dependencies:** 1.4
      **Files:** `apps/api/src/auth/**`, `apps/api/test/auth.e2e-spec.ts`
      **Size:** M

---

### Checkpoint: Step 1 complete

- [x] `npm run build --workspaces`, `npm run test -w apps/api`, `npm run test:integration -w apps/api`, `npm run test:e2e -w apps/api` all pass
- [x] Full e2e list from `stage-1-api-plan.md` covered: register success; duplicate-email rejected; login success + cookie set; wrong-password rejected; guarded route rejects no-cookie and tampered-cookie requests (13 e2e tests total)
- [ ] GitHub Actions green on a real PR (new e2e step included) — not yet pushed
- [x] `RECRUITERS_REPOSITORY`, `AuthUser`, `@CurrentUser()`, `JwtAuthGuard` ready for Step 2 (vacancies) to consume with zero additional wiring

## Commit Plan

One commit per task, in dependency order (per CLAUDE.md: ask before each actual commit; this table is the intended sequence, not pre-approval to skip asking).

| #   | Task                    | Commit message                                                      |
| --- | ----------------------- | ------------------------------------------------------------------- |
| 1   | 1.0 Update general plan | `docs: link step 1 auth subplan`                                    |
| 2   | 1.1 Deps + middleware   | `chore(api): add auth deps and global validation/cookie middleware` |
| 3   | 1.2 E2E harness         | `test(api): add testcontainers e2e harness`                         |
| 4   | 1.3 Register            | `feat(auth): add recruiter registration`                            |
| 5   | 1.4 Login               | `feat(auth): add recruiter login with jwt cookie`                   |
| 6   | 1.5 Guard/me/logout     | `feat(auth): add jwt guard, current user, me, and logout`           |

## Risks and Mitigations

| Risk                                                                                 | Impact                           | Mitigation                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/passport` latest major requires Nest 11/12                                  | High (build breaks)              | Pin `^10.0.3`, confirmed peer-compatible with Nest 10 (same pitfall as `@nestjs/config` in Phase 0)                                                         |
| Cookie `maxAge` drifts out of sync with JWT `expiresIn` if hand-typed twice          | Low (silent session-length bug)  | Both derived from one `JWT_EXPIRES_IN` env var, cookie `maxAge` computed via `ms()` at the same call site                                                   |
| e2e tests accidentally hit a real/dev DB instead of the ephemeral Testcontainers one | Medium (flaky/destructive tests) | `DRIZZLE` is provider-overridden in `Test.createTestingModule`, never falls back to the real factory; `DATABASE_URL`'s value is never actually connected to |

## Open Questions

None blocking — defaults documented above under Architecture Decisions (cookie name, password min length, bcrypt rounds, same-401 no-enumeration). Flag if any should change.
