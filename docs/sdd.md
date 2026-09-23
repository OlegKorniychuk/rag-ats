# Software Design Document — RAG-ATS (Stage 1, as-built)

## 1. Purpose & scope

This document describes the system **as it exists in code today**: Stage 1 of `SPEC.md`'s scope — plain CRUD, auth, and the public apply flow, with no AI/RAG. `SPEC.md` remains the source of requirements/intent and full (Stage 1 + Stage 2) product vision; it is not edited here and should not be treated as current-state truth where it disagrees with code.

**Stage 1 (this document): built and complete.** Recruiter auth, vacancy CRUD, public apply link view + submission, applicant pipeline management, shared candidate pool.

**Stage 2 (RAG/AI): not started.** No pgvector, no CV upload/parsing, no semantic search, no fit scoring, no eval script. See §11.

It replaces the per-step implementation plans, which were removed once Stage 1 was complete. Design decisions from them that are still true live in §8.

## 2. Architecture

- **npm workspaces**: `apps/api` (NestJS backend), `packages/shared` (shared TS types — see §7, currently unused by `apps/api`).
- **NestJS 10**, native ESM (`apps/api/package.json` has `"type": "module"`, `tsconfig.json` uses `NodeNext` resolution). See §12 for the resulting import conventions.
- **Drizzle ORM `1.0.0-rc.4`** (`drizzle-orm`, `drizzle-kit`), relational query API v2 (`defineRelations`, exported as `dbRelations` from `apps/api/src/db/schema.ts`), driven over `pg` (node-postgres).
- **Postgres 17** via Docker Compose (`docker-compose.yml`, plain `postgres:17` image — no pgvector in Stage 1).
- **Repository pattern**: one `interface XRepository` + one `class DrizzleXRepository implements XRepository` per aggregate (`apps/api/src/db/repositories/`), bound to a `Symbol` DI token, registered in `apps/api/src/db/repositories.module.ts` (`@Global()` `RepositoriesModule` — injectable anywhere with no per-module re-import).
- **Transactions**: `@nestjs-cls/transactional` + `@nestjs-cls/transactional-adapter-drizzle-orm`, wired once in `apps/api/src/app.module.ts` (`ClsModule.forRoot` with `middleware.mount: true`). Repositories inject `TransactionHost<AppTransactionAdapter>` and read `this.txHost.tx` fresh on every call (never cached on `this`) so `@Transactional()` on a service method transparently swaps every repository call's db handle for the current transaction. Only `ApplyService.submit` currently uses `@Transactional()`.
- **Config**: `nest-typed-config` (`TypedConfigModule.forRoot({ schema: EnvConfig, load: dotenvLoader() })` in `app.module.ts`) — a single typed `EnvConfig` class (`apps/api/src/config/env.config.ts`) validated with `class-validator` at boot; every consumer injects `EnvConfig` by type (no stringly-keyed `ConfigService.get()` anywhere). See §9.
- **Global `ValidationPipe`** (`whitelist: true, forbidNonWhitelisted: true, transform: true`), wired in `apps/api/src/main.ts` and replicated in the e2e test harness (`apps/api/test/e2e-app.util.ts`) since `Test.createTestingModule` never runs `main.ts`.

## 3. Module map

| Module         | Path                         | Responsibility                                                                                                                                                          |
| -------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`         | `apps/api/src/auth/`         | Register/login/logout, JWT httpOnly-cookie session, global auth guard (`APP_GUARD`) + `@Public()` opt-out, `@CurrentUser()`                                             |
| `vacancies`    | `apps/api/src/vacancies/`    | Recruiter-owned vacancy CRUD; nested applicant listing (`GET /vacancies/:id/applications`)                                                                              |
| `applications` | `apps/api/src/applications/` | Pipeline-stage transitions, scoped via the parent vacancy's owner                                                                                                       |
| `apply`        | `apps/api/src/apply/`        | Public, unauthenticated: view a vacancy by apply token, submit an application (candidate dedupe/merge)                                                                  |
| `candidates`   | `apps/api/src/candidates/`   | Shared, profile-only candidate pool — any authenticated recruiter                                                                                                       |
| `db`           | `apps/api/src/db/`           | Drizzle schema/relations (`schema.ts`), DB client provider (`db.module.ts`, `@Global()`), repository interfaces + Drizzle impls, `repositories.module.ts` (`@Global()`) |
| `config`       | `apps/api/src/config/`       | `EnvConfig` — typed, validated env config                                                                                                                               |
| `common`       | `apps/api/src/common/`       | Shared doc-only response DTOs (`SuccessResponseDto`)                                                                                                                    |

## 4. Data model

All tables live in `apps/api/src/db/schema.ts`; migrations in `apps/api/src/db/migrations/` (two so far: `20260914130555_next_genesis` — initial schema; `20260923091248_typical_the_fallen` — unique constraint on `applications`).

| Table          | Key columns                                                                                                                                                                                                                                                | Notes                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `recruiters`   | `id` (uuid pk), `email` (text, **unique**, not null), `password_hash` (text, not null), `created_at`                                                                                                                                                       |                                                                                         |
| `vacancies`    | `id` (uuid pk), `recruiter_id` (fk → `recruiters.id`, not null), `title`, `requirements`, `apply_token` (text, **unique**, not null), `status` (`vacancy_status` enum: `open`\|`closed`, default `open`), `created_at`                                     |                                                                                         |
| `candidates`   | `id` (uuid pk), `name`, `email` (text, **unique**, not null), `github_url` (nullable), `portfolio_url` (nullable), `skills` (`text[]`, not null), `experience` (text, not null), `projects` (`text[]`, not null), `summary` (text, not null), `created_at` |                                                                                         |
| `applications` | `id` (uuid pk), `vacancy_id` (fk → `vacancies.id`), `candidate_id` (fk → `candidates.id`), `stage` (`application_stage` enum: `applied`\|`screened`\|`interview`\|`rejected`\|`hired`, default `applied`), `created_at`                                    | **unique** `(vacancy_id, candidate_id)` — `applications_vacancy_id_candidate_id_unique` |

**Relations** (`dbRelations = defineRelations(schema, ...)`, RQBv2, TS-only — no migration): `applications.candidate` (one, non-optional), `applications.vacancy` (one, non-optional), `vacancies.recruiter` (one, non-optional), `vacancies.applications` (many), `candidates.applications` (many — defined but deliberately unused by `CandidatesService` to avoid leaking cross-recruiter application/pipeline data through the shared candidate pool).

**Commands**: `npm run db:generate -w apps/api` (`drizzle-kit generate`, diffs schema vs. migrations), `npm run db:migrate -w apps/api` (`drizzle-kit migrate`); root aliases `npm run db:generate` / `npm run db:migrate` / `npm run db:up` (`docker compose up -d db`).

## 5. Auth

- **Session**: JWT in an httpOnly cookie named `access_token` (`apps/api/src/auth/access-token-cookie.ts`). Cookie flags: `httpOnly: true`, `sameSite: 'lax'`, `secure: EnvConfig.NODE_ENV === 'production'`. `maxAge` on login is derived from `JWT_EXPIRES_IN` via the `ms` package (single source of truth shared with the JWT's own `expiresIn`); logout clears the cookie with matching flags (no `maxAge`, since `res.clearCookie()` sets its own immediate-expiry value).
- **Payload**: `{ sub: recruiter.id, email }` (`apps/api/src/auth/jwt-payload.interface.ts`), signed/verified with `JWT_SECRET`. Extraction is a custom `passport-jwt` extractor reading `req.cookies['access_token']` (`apps/api/src/auth/jwt.strategy.ts`) — no `Authorization` header support.
- **Password hashing**: `bcrypt`, 10 salt rounds (`AuthService`, `apps/api/src/auth/auth.service.ts`). Login returns the same `401 Unauthorized` for both "unknown email" and "wrong password" (no user enumeration).
- **Global guard**: `JwtAuthGuard` (`apps/api/src/auth/jwt-auth.guard.ts`) is registered as `APP_GUARD` in `AuthModule` — every route is guarded by default. `@Public()` (`apps/api/src/auth/public.decorator.ts`, `SetMetadata('isPublic', true)` + `ApiSecurity({})` for Swagger) explicitly opts a route out; the guard checks this via `Reflector` before delegating to `super.canActivate()`.
- **`@CurrentUser()`** (`apps/api/src/auth/current-user.decorator.ts`) reads `req.user` (set by the passport strategy's `validate()`) and returns an `AuthUser` (`{ id, email }`).

## 6. API endpoints

15 operations across 12 paths. "Auth" = `Public` (no cookie needed) or `Cookie` (valid `access_token` cookie required, else `401`).

| Method | Path                          | Auth   | Success                                                | Errors        | Purpose                                                   |
| ------ | ----------------------------- | ------ | ------------------------------------------------------ | ------------- | --------------------------------------------------------- |
| GET    | `/`                           | Public | 200, `string`                                          | —             | Health check                                              |
| POST   | `/auth/register`              | Public | 201, `RegisteredRecruiterResponseDto`                  | 400, 409      | Register a recruiter account                              |
| POST   | `/auth/login`                 | Public | 201, `SuccessResponseDto` (sets `access_token` cookie) | 400, 401      | Log in                                                    |
| POST   | `/auth/logout`                | Public | 201, `SuccessResponseDto` (clears cookie)              | —             | Log out                                                   |
| GET    | `/auth/me`                    | Cookie | 200, `AuthUserResponseDto`                             | 401           | Current session check                                     |
| POST   | `/vacancies`                  | Cookie | 201, `VacancyResponseDto`                              | 400, 401      | Create a vacancy (auto-generates `applyToken`)            |
| GET    | `/vacancies`                  | Cookie | 200, `VacancyResponseDto[]`                            | 401           | List my vacancies (newest first)                          |
| GET    | `/vacancies/:id`              | Cookie | 200, `VacancyResponseDto`                              | 400, 401, 404 | Get one of my vacancies                                   |
| PATCH  | `/vacancies/:id`              | Cookie | 200, `VacancyResponseDto`                              | 400, 401, 404 | Update fields and/or close a vacancy I own                |
| GET    | `/vacancies/:id/applications` | Cookie | 200, `ApplicationWithCandidateResponseDto[]`           | 400, 401, 404 | List applicants (+ candidate profile) for a vacancy I own |
| PATCH  | `/applications/:id`           | Cookie | 200, `ApplicationResponseDto`                          | 400, 401, 404 | Move an application to a pipeline stage                   |
| GET    | `/apply/:token`               | Public | 200, `PublicVacancyResponseDto`                        | 404           | View a vacancy's public role details                      |
| POST   | `/apply/:token`               | Public | 201, `SuccessResponseDto`                              | 400, 404, 409 | Submit an application (candidate dedupe + merge)          |
| GET    | `/candidates`                 | Cookie | 200, `CandidateResponseDto[]`                          | 401           | List the shared candidate pool (newest first)             |
| GET    | `/candidates/:id`             | Cookie | 200, `CandidateResponseDto`                            | 400, 401, 404 | View one candidate's profile                              |

Notes: 400 on `:id`/`:token`-adjacent routes with a `uuid` param covers malformed uuids (`ParseUUIDPipe`) as well as body validation failures. 404 on vacancy/application routes covers both "doesn't exist" and "exists but isn't mine" (§8). `POST /apply/:token`'s 409 covers both "vacancy is closed" and "already applied to this vacancy".

## 7. Contracts — where to find them

- **Swagger UI**: `http://localhost:3000/docs`. **Raw OpenAPI**: `http://localhost:3000/docs-json`. Both served only when `EnvConfig.NODE_ENV !== 'production'` (`apps/api/src/main.ts`).
- **Cookie auth in Swagger UI**: the `Authorize` button cannot set an httpOnly cookie itself. Instead, run `POST /auth/login` from the docs page ("Try it out") — the browser stores the resulting `access_token` cookie and sends it automatically on every later request made from that same page. `apps/api/src/swagger.ts` registers a global `cookie` security scheme (`addCookieAuth`); `@Public()` routes override it per-operation with an empty security requirement so the docs correctly show them as not requiring auth.
- **Request DTOs** (`apps/api/src/*/dto/*.dto.ts`): `auth/dto/register.dto.ts`, `auth/dto/login.dto.ts`, `vacancies/dto/create-vacancy.dto.ts`, `vacancies/dto/update-vacancy.dto.ts`, `applications/dto/update-application.dto.ts`, `apply/dto/submit-application.dto.ts`.
- **Doc-only response classes** (`*-response.dto.ts`) — each `implements` the corresponding Drizzle-inferred row type (or a service-level shape), so schema/type drift fails compilation, not just docs: `auth/dto/registered-recruiter-response.dto.ts`, `auth/dto/auth-user-response.dto.ts` (`implements AuthUser`), `vacancies/dto/vacancy-response.dto.ts` (`implements Vacancy`), `applications/dto/application-response.dto.ts` (`implements Application`), `applications/dto/application-with-candidate-response.dto.ts` (`extends ApplicationResponseDto implements ApplicationWithCandidate`), `apply/dto/public-vacancy-response.dto.ts` (`implements PublicVacancy`), `candidates/dto/candidate-response.dto.ts` (`implements Candidate`).
- **`apps/api/src/common/dto/success-response.dto.ts`**: `SuccessResponseDto { success: true }` — the confirmation shape for login, logout, and apply-submit.
- **`packages/shared/src/types.ts`**: hand-written domain interfaces (`Recruiter`, `Vacancy`, `Candidate`, `CandidateProfile`, `Application`, `ApplicationStage`, `VacancyStatus`, `ScoreResult`) intended as a frontend/backend shared contract. **Currently unused** — nothing in `apps/api/src` imports `@rag-ats/shared`, and no `apps/web` consumer exists yet. It has already drifted from the real schema: its `Candidate` nests `skills`/`experience`/`projects`/`summary` under a `profile: CandidateProfile` field, while the actual `candidates` table (and `CandidateResponseDto`) has them as flat top-level columns. Treat it as aspirational, not authoritative.
- **Validation**: global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — any unknown body field is a `400`, not silently dropped.
- The OpenAPI document is generated straight from these classes (`DocumentBuilder` + `SwaggerModule.createDocument` in `swagger.ts`, scanning controllers' `@Api*` decorators and the DTOs above) — change a DTO, the docs follow with no manual sync step.

## 8. Design decisions

- **404 for both "not found" and "not owned"** on vacancy/application lookups — never lets a client distinguish the two.
- **Owner-scoping is enforced in the service layer**, not just the controller (`VacanciesService.getOwnedVacancy`, `ApplicationsService.updateStage` checking `application.vacancy.recruiterId`).
- **Public vacancy projection is minimal**: `GET /apply/:token` returns only `title`/`requirements`/`status` — never `id`, `recruiterId`, or `applyToken`.
- **Closed vacancy**: public view (`GET /apply/:token`) still resolves; submitting (`POST /apply/:token`) is rejected with `409`.
- **Candidate dedupe key is a normalized email** (trim + lowercase), applied in `SubmitApplicationDto` via `@Transform` — not in the service — so `A@x.com` and `a@x.com` hit the same candidate row.
- **Merge rules for a repeat candidate submission** (`apply/merge-candidate-profile.ts`): skills — case-insensitive union, first-seen casing kept; projects — exact-after-trim union; experience — new text appended as a new `\n\n`-separated block, unless an identical block already exists; name/summary — latest submission wins; `githubUrl`/`portfolioUrl` — only overwritten when the new submission provides a value, otherwise the existing value is kept.
- **`ApplyService.submit` runs in one `@Transactional()`**, checking for a duplicate application (same vacancy + candidate) _before_ merging the submission into the candidate profile, so a rejected duplicate never mutates data. The `409` is also backed by the `applications_vacancy_id_candidate_id_unique` DB constraint as a race backstop.
- **Pipeline stages accept any enum value in any order** — no state-machine restriction (`applied → screened → interview → rejected/hired` is a suggested flow, not enforced).
- **Candidate pool is shared across all recruiters and profile-only** — `GET /candidates`/`GET /candidates/:id` never include a candidate's `applications`, even though the `candidates.applications` relation exists in schema (deliberately unused there) — prevents leaking another recruiter's pipeline data through the shared pool.
- **Lists are newest-first** (`orderBy: { createdAt: 'desc' }`) with **no pagination** anywhere in Stage 1.
- **Malformed uuid path params → `400`** via `ParseUUIDPipe`, instead of a raw Postgres error surfacing as `500`.
- **Same `401` for wrong password vs. unknown email** on login — no user-enumeration signal.
- **Repositories never cache `TransactionHost.tx`** — read fresh on every call, since repositories are singleton providers and a cached reference would leak across concurrent requests/transactions.
- **Global `JwtAuthGuard` (fail-closed default) + `@Public()` opt-out**, rather than per-route `@UseGuards` — safer default as new routes get added.

## 9. Configuration

Validated at boot via `nest-typed-config` (`EnvConfig`, `apps/api/src/config/env.config.ts`); the app refuses to boot if a required var is missing or invalid.

| Var              | Default                                                   | Effect                                                                                                                                                |
| ---------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | _(required)_                                              | Postgres connection string for the `pg.Pool`/Drizzle client; must be `postgres://`/`postgresql://` (`require_tld: false`, so `localhost` is accepted) |
| `JWT_SECRET`     | _(required)_                                              | HMAC secret used to sign and verify session JWTs (min length 1)                                                                                       |
| `JWT_EXPIRES_IN` | `'7d'`                                                    | JWT `signOptions.expiresIn` **and** the `access_token` cookie's `maxAge` (via `ms()`) — single source of truth for both                               |
| `PORT`           | `3000`                                                    | Port `app.listen()`s on (`0`–`65535`; the e2e harness uses `PORT=0` to let the OS pick one)                                                           |
| `NODE_ENV`       | _(required — one of `development`\|`production`\|`test`)_ | `secure` cookie flag is `true` only when `production`; Swagger (`/docs`, `/docs-json`) is served only when **not** `production`                       |

## 10. Testing & CI

| Layer       | Tooling                                                                                                                       | Command                                                                   | Location                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Unit        | Jest                                                                                                                          | `npm run test -w apps/api` (root: `npm test`)                             | `apps/api/src/**/*.spec.ts` (e.g. `apply/merge-candidate-profile.spec.ts`) |
| Integration | Jest + Testcontainers (`@testcontainers/postgresql`), real ephemeral Postgres per suite, repository/CLS wiring only (no HTTP) | `npm run test:integration -w apps/api` (root: `npm run test:integration`) | `apps/api/test/repositories/*.repository.integration-spec.ts`              |
| E2E         | Jest + Supertest + Testcontainers, full `AppModule` via `Test.createTestingModule` with `DRIZZLE` overridden                  | `npm run test:e2e -w apps/api` (root: `npm run test:e2e`)                 | `apps/api/test/*.e2e-spec.ts`                                              |

Harness details: `apps/api/test/testcontainers-db.util.ts` (starts/migrates/tears down the container), `apps/api/test/e2e-app.util.ts` (`createTestApp`/`closeTestApp` — replicates `main.ts`'s cookie-parser + `ValidationPipe` wiring, since `Test.createTestingModule` never runs `main.ts`), `apps/api/test/jest-e2e-setup.ts` (seeds required `process.env` vars before `AppModule` is imported, since `TypedConfigModule.forRoot` validates at module-metadata-build time, not lazily).

**CI** (`.github/workflows/ci.yml`, `ubuntu-latest`, triggered on push/PR to `main`), steps in order: checkout → setup Node 22 (npm cache) → `npm ci` → lint (`npm run lint -w apps/api`) → format check (`npx prettier --check .`) → build (`npm run build --workspaces`) → unit tests → integration tests → e2e tests. Each is its own visible step.

## 11. Known limitations / next

- **No pagination** on any list endpoint (`GET /vacancies`, `GET /vacancies/:id/applications`, `GET /candidates`) — acceptable for local-demo data volumes, not production-ready.
- **Concurrent first submissions with the same new email** can race past the pre-merge duplicate check and hit the `candidates.email` unique constraint, surfacing as an uncaught `500` rather than a clean error — not handled beyond the transaction boundary.
- **No submission abuse cap** on `POST /apply/:token` — deferred to Stage 2 (the guard exists to protect the paid LLM parsing step, which Stage 1 doesn't call).
- **Stage 2 (RAG/AI) not started**: pgvector extension/embedding column, CV PDF upload + parsing into a structured profile, semantic candidate search, grounded/cited fit scoring, candidate ranking by fit score, and the eval script (`SPEC.md`'s Commands section names `apps/api/scripts/eval.ts` — that path does not exist yet) — none of this exists yet.

## 12. Dev notes

- **Native ESM**: `apps/api` is `"type": "module"`. Every relative import needs an explicit `.js` extension (even in `.ts` source — TypeScript does not rewrite extensions; you write what the compiled output will have), e.g. `import { AppService } from './app.service.js'`.
- **`isolatedModules` + type-only imports**: because ts-jest's ESM mode transpiles each file in isolation (no whole-program type info), a plain `import { X }` of a type-only export (`interface`/`type` alias) from one of our own relative modules survives into the emitted ESM output. Node's strict ESM linker then throws `SyntaxError: The requested module '...' does not provide an export named 'X'` **at runtime** — a class of bug `tsc`'s own build does not catch (it only errors where its emit is genuinely ambiguous, e.g. decorator metadata). Fix: mark every such import `import type { X } from '...'` (or an inline `type` modifier when mixed with a value import in the same statement). This only surfaces by running the actual test suites (integration/e2e), not by `npm run build`.
