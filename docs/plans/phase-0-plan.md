# Implementation Plan: Phase 0 — Foundation (Stage 1 API)

## Context

`docs/plans/stage-1-api-plan.md` lays out Stage 1 as Phase 0 (foundation, not a user story) followed by 9 per-story steps. This document is the detailed breakdown of **Phase 0 only**: monorepo bootstrap, Postgres via Docker, the full Drizzle schema, and — per explicit requirement — a correctly-wired repository pattern (interfaces + Drizzle implementations) with working `@Transactional()` support, using the **latest Drizzle RC** (`1.0.0-rc.4`, the `rc` dist-tag on both `drizzle-orm` and `drizzle-kit`).

## Research Findings: Drizzle + NestJS + Repository Pattern + Transactions

**The core problem:** Drizzle has no built-in transaction-context propagation. Its GitHub issue #543 ("AsyncLocalStorage for transactions") is still open/unresolved — there's no native way for a nested repository call to automatically know "I'm inside a transaction, use `tx` not the base `db`." Naively injecting the raw Drizzle client into every repository and manually threading a `tx` parameter through every service→repository call is exactly the invasive pattern a clean repository-pattern setup wants to avoid.

**The standard fix:** `@nestjs-cls/transactional` (from the `nestjs-cls` ecosystem) + its official adapter `@nestjs-cls/transactional-adapter-drizzle-orm`. It uses `nestjs-cls`'s AsyncLocalStorage-backed context to make `@Transactional()` on a _service_ method transparently swap what the _current_ db handle resolves to for every repository call made during that method — without passing anything explicitly.

**The specific setup rule that makes-or-breaks it:**

- Repositories must inject `TransactionHost<Adapter>`, **not** the raw Drizzle client.
- They must read `this.txHost.tx` **fresh on every single query call** — never cache/destructure it into a field in the constructor. NestJS providers are singletons by default (not request-scoped), so a cached reference would leak across concurrent requests/transactions. `this.txHost.tx` is a live getter that resolves to whatever the current AsyncLocalStorage context says (the transaction's `tx`, or the base `db` outside any transaction).
- Repositories should stay transaction-_agnostic_ — they never call `db.transaction()` themselves. Only `@Transactional()`-annotated _service_ methods open transaction boundaries; repositories just always ask "what's current."
- `ClsModule.forRoot()` needs its middleware actually mounted (`middleware: { mount: true }`, or an equivalent guard/interceptor) — a very common gotcha is wiring the plugin but forgetting this, which throws "No CLS context available" at runtime the first time anything touches `txHost.tx`.
- Async driver mode: `node-postgres` (the `pg` Pool driver, what this project uses) is supported in the adapter's default **async** transaction mode — no driver blocker.

**Version compatibility (checked live against npm):**

- `drizzle-orm@rc` / `drizzle-kit@rc` both currently resolve to **`1.0.0-rc.4`** — that's "latest RC."
- `@nestjs-cls/transactional-adapter-drizzle-orm`'s peer range is explicitly `"drizzle-orm": "^0 || >=1.0.0-rc.1 <2.0.0"` — **it already supports the 1.0 RC line**, so no compatibility blocker.
- Drizzle 1.0 RC breaking changes vs 0.x (casing API reworked, RQBv1 removed in favor of `defineRelations()` v2, some import path moves) don't affect anything in the Stage 1 schema as planned (no casing customization, no relational-query-v1 usage), so no rework needed on that front.

**Design implication for the repository pattern:** each repository is `interface XRepository { ... }` (the contract, referenced by services) + `class DrizzleXRepository implements XRepository` (the concrete impl, holding `TransactionHost<AppTransactionAdapter>`), bound via a DI token (`Symbol('X_REPOSITORY')`). A service method calls multiple repositories under one `@Transactional()`, and they all transparently share the same `tx`.

Sources: [Drizzle ORM v1 RC changes](https://orm.drizzle.team/docs/v0-v1-changes) · [GitHub issue #543 — AsyncLocalStorage for transactions](https://github.com/drizzle-team/drizzle-orm/issues/543) · [NestJS CLS: Drizzle ORM adapter docs](https://papooch.github.io/nestjs-cls/plugins/available-plugins/transactional/drizzle-orm-adapter) · [@nestjs-cls/transactional-adapter-drizzle-orm on npm](https://www.npmjs.com/package/@nestjs-cls/transactional-adapter-drizzle-orm)

## Architecture Decisions

- **Repository pattern:** one `interface XRepository` (contract) + one `class DrizzleXRepository implements XRepository` (impl) per aggregate, bound via a `Symbol` DI token (e.g. `RECRUITERS_REPOSITORY`). Services depend on the interface/token, never on `DrizzleXRepository` or the raw Drizzle client directly.
- **Transactional infra:** `nestjs-cls` + `@nestjs-cls/transactional` + `@nestjs-cls/transactional-adapter-drizzle-orm`, wired once, globally, in `AppModule`. `@Transactional()` is applied at the service layer only.
- **DB driver:** `pg` (node-postgres) — confirmed supported by the transactional adapter's async mode.
- **DB image:** plain `postgres:17` in `docker-compose.yml` for Stage 1 (per the Stage 1 plan's "no pgvector yet" decision). Stage 2 swaps the image to `pgvector/pgvector` and adds the extension via its own migration.
- **Tests are integration tests, not e2e.** Phase 0 has no HTTP endpoints to exercise, so tests build a Nest `TestingModule` (compiling `DbModule` + `RepositoriesModule` + the CLS/transactional wiring) and call providers/repositories directly — no Supertest, no HTTP layer. This pattern carries forward: later steps' repository/service tests stay integration-style; only steps with actual controllers add e2e/Supertest on top.
- **Test DB via Testcontainers**, not the Docker Compose `db` service. Each integration test file starts its own ephemeral `PostgreSqlContainer` (via `@testcontainers/postgresql`) in `beforeAll`, runs Drizzle migrations against it programmatically, builds the `TestingModule` against that container's connection string, and stops the container in `afterAll`. No shared test database, no manual cleanup/truncation between runs, no dependency on `docker compose up` being run first — Testcontainers manages the whole container lifecycle, so no `DATABASE_URL_TEST` env var is needed. Docker Compose's `db` service remains for local dev (`npm run start:dev`) only.
- **Proof of the transactional wiring is a real repository, not throwaway code:** `RecruitersRepository` (the `recruiters` table already needs to exist in schema regardless, and Step 1/auth will consume it) is built in Phase 0 specifically to prove `@Transactional()` commit + rollback works, via a Testcontainers-backed integration test. Every later step's repository (vacancies, candidates, applications) follows the exact same shape.
- **Nest version:** `@nestjs/cli@10` (pins Jest as the default test runner, matching SPEC.md; the current CLI major scaffolds Vitest by default, established in an earlier session). `@nestjs-cls`'s peer range (`@nestjs/core`/`common` `>=10 <13`) is compatible.
- **CI: GitHub Actions on `ubuntu-latest`.** Docker Engine is pre-installed on GitHub-hosted Ubuntu runners, so Testcontainers-based integration tests run there with zero extra setup (no DinD, no service-container workaround needed) — confirmed via Docker's own GitHub Actions + Testcontainers guidance. This retires the "Testcontainers needs a reachable Docker daemon in CI" risk from the original Phase 0 pass.

## Task List

### Task 0.1: Monorepo bootstrap

**Description:** npm workspaces root (`apps/api`, `packages/shared`), NestJS app skeleton in `apps/api` via `@nestjs/cli@10` (Jest default), `packages/shared` with the existing domain types (Recruiter, Vacancy, Candidate, Application, ScoreResult — same shapes as before).
**Acceptance criteria:**

- [x] `npm install` succeeds at the root; `npm run build --workspaces` succeeds
- [x] `apps/api` boots (`npm run start:dev -w apps/api`) and serves the default route
- [x] Default Jest unit test (`app.controller.spec.ts`) passes
      **Verification:** `npm run build --workspaces`, `npm run test -w apps/api`
      **Dependencies:** None
      **Files:** `package.json` (root), `apps/api/**` (Nest scaffold), `packages/shared/**`
      **Size:** S

### Task 0.2: Docker Compose + config

**Description:** `docker-compose.yml` with a single `db` service (`postgres:17`, plain — no pgvector), `.env.example` (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`), `@nestjs/config` wired globally in `AppModule` with fail-fast schema validation.
**Acceptance criteria:**

- [x] `docker compose up -d db` starts a reachable Postgres
- [x] App fails fast with a clear error if a required env var is missing (Joi validation in `ConfigModule.forRoot`)
      **Verification:** `docker compose up -d db && psql $DATABASE_URL -c 'select 1'`; boot the app with a missing env var and confirm it errors instead of silently continuing
      **Dependencies:** 0.1
      **Files:** `docker-compose.yml`, `apps/api/.env.example`, `apps/api/src/app.module.ts`
      **Size:** S

### Task 0.3: Drizzle schema + migration tooling (RC)

**Description:** Install `drizzle-orm@rc` and `drizzle-kit@rc` (pin the resolved `1.0.0-rc.4` in `package.json`, not a floating `rc` tag). Full schema for all Stage 1 entities in `src/db/schema.ts`: `recruiters`, `vacancies` (+ `vacancy_status` enum), `candidates`, `applications` (+ `application_stage` enum) — tables/columns/relations only, matching `packages/shared`'s types, no `vector` column yet. `drizzle.config.ts` targeting `DATABASE_URL`. Root/workspace scripts: `db:generate`, `db:migrate`.
**Acceptance criteria:**

- [x] `npm run db:generate -w apps/api` produces a migration matching the schema
- [x] `npm run db:migrate -w apps/api` applies cleanly to an empty `docker compose` Postgres
- [x] Re-running migrate on an already-migrated DB is a no-op (idempotent)
      **Verification:** fresh `docker compose down -v && docker compose up -d db`, then generate+migrate, inspect tables via `psql \dt`
      **Dependencies:** 0.2
      **Files:** `apps/api/src/db/schema.ts`, `apps/api/drizzle.config.ts`, `apps/api/src/db/migrations/**`
      **Size:** M

### Task 0.4: Drizzle client provider

**Description:** `DbModule` (`@Global()`), provides the `DRIZZLE` token (a `NodePgDatabase<typeof schema>` built from a `pg.Pool` using `DATABASE_URL`), closes the pool on `onModuleDestroy`. Exported type aliases (`AppDatabase`, and the transactional adapter type from 0.5) live alongside it for reuse by every repository.
**Acceptance criteria:**

- [x] Any provider can `@Inject(DRIZZLE)` and run a query against the real DB
- [x] Pool closes cleanly on app shutdown (no dangling handles in tests)
      **Verification:** covered by 0.7's Testcontainers integration test; `jest --detectOpenHandles` clean after that suite runs
      **Dependencies:** 0.3
      **Files:** `apps/api/src/db/db.module.ts`, `apps/api/src/db/db.tokens.ts`
      **Size:** S

### Task 0.5: Transactional infra (nestjs-cls + Drizzle adapter)

**Description:** Install `nestjs-cls`, `@nestjs-cls/transactional`, `@nestjs-cls/transactional-adapter-drizzle-orm`. Wire `ClsModule.forRoot({ global: true, middleware: { mount: true }, plugins: [new ClsPluginTransactional({ imports: [DbModule], adapter: new TransactionalAdapterDrizzleOrm({ drizzleInstanceToken: DRIZZLE }) })] })` in `AppModule`. Export a typed `AppTransactionAdapter = TransactionalAdapterDrizzleOrm<AppDatabase>` alias from `src/db/db.tokens.ts` so every repository imports one consistent type for `TransactionHost<AppTransactionAdapter>`.
**Acceptance criteria:**

- [x] `middleware.mount: true` is set (the documented "No CLS context available" failure mode is explicitly avoided)
- [x] A minimal provider can inject `TransactionHost<AppTransactionAdapter>` and read `.tx` without error, both inside and outside a request context
      **Verification:** covered by 0.7's integration test (this task alone has no independent user-facing behavior to verify beyond "it doesn't throw on boot")
      **Dependencies:** 0.4
      **Files:** `apps/api/src/app.module.ts`, `apps/api/src/db/db.tokens.ts`
      **Size:** M

### Task 0.6: First repository — `RecruitersRepository` (interface + Drizzle impl)

**Description:** `interface RecruitersRepository { create(data): Promise<Recruiter>; findByEmail(email): Promise<Recruiter | null>; findById(id): Promise<Recruiter | null>; }` in `src/db/repositories/recruiters.repository.ts`, plus `DrizzleRecruitersRepository implements RecruitersRepository` using `TransactionHost<AppTransactionAdapter>` — **`this.txHost.tx` read fresh inside every method, never stored on `this`**. Bound in a `RepositoriesModule` (`@Global()`, imported once in `AppModule`) via `{ provide: RECRUITERS_REPOSITORY, useClass: DrizzleRecruitersRepository }`. This module is where every later step (vacancies, candidates, applications repositories) adds its own interface/impl/binding — no new wiring pattern needed after this.
**Acceptance criteria:**

- [x] `RecruitersRepository` methods work correctly called directly (no transaction)
- [x] Repository never imports/caches the raw `DRIZZLE` client — only `TransactionHost`
      **Verification:** covered by 0.7
      **Dependencies:** 0.5
      **Files:** `apps/api/src/db/repositories/recruiters.repository.ts`, `apps/api/src/db/repositories/drizzle-recruiters.repository.ts`, `apps/api/src/db/repositories.module.ts`
      **Size:** M

### Task 0.7: Testcontainers integration harness + transactional proof test

**Description:** Install `testcontainers` + `@testcontainers/postgresql` as dev dependencies. A shared helper `test/testcontainers-db.util.ts` exposes `createTestDatabase()`: starts a `PostgreSqlContainer`, runs Drizzle migrations against it programmatically (drizzle-orm's `migrate()` against the generated migrations folder — not the `drizzle-kit` CLI, to avoid shelling out mid-test), and returns `{ container, pool, db }`. Integration test file `apps/api/test/repositories/recruiters.repository.integration-spec.ts`: `beforeAll` calls `createTestDatabase()` and builds a Nest `TestingModule` (importing `DbModule`/`RepositoriesModule`/CLS wiring, overriding the `DRIZZLE` provider with the container's `db`), `afterAll` closes the pool and stops the container. The proof test: a throwaway `@Injectable()` test-only service with two `@Transactional()`-wrapped methods that both call `RecruitersRepository` — one commits two inserts, one throws partway through and must roll back both.
**Acceptance criteria:**

- [x] Integration test runs against a real, ephemeral Postgres (Testcontainers) — not mocked, not the dev `docker compose` DB
- [x] Happy path: two repository calls inside one `@Transactional()` method both persist
- [x] Rollback: an error thrown inside a `@Transactional()` method after one repository write leaves **zero** rows — proves the transaction actually rolled back, not just that the error propagated
- [x] A repository call made _outside_ any `@Transactional()` context still works (uses the base `db`, not a stray `tx`)
- [x] Container is torn down after the suite even on test failure (`afterAll`, not relying on process exit)
      **Verification:** `npm run test:integration -w apps/api` (new script), confirm no leftover container via `docker ps` after the run
      **Dependencies:** 0.6
      **Files:** `apps/api/test/testcontainers-db.util.ts`, `apps/api/test/repositories/recruiters.repository.integration-spec.ts`, `apps/api/jest.integration.config.ts` (or a `testPathIgnorePatterns`/project split so `*.integration-spec.ts` doesn't run under the default `npm test`)
      **Size:** M

### Task 0.8: GitHub Actions CI — lint, format, build, test

**Description:** `.github/workflows/ci.yml` on `ubuntu-latest`, triggered on push/PR to `main`. Steps: checkout → setup Node (with npm cache) → `npm ci` (root, installs `apps/api` + `packages/shared`) → lint (`npm run lint -w apps/api`) → format check (`npx prettier --check .` against a root `.prettierrc`/`.prettierignore`) → build (`npm run build --workspaces`) → unit test (`npm run test -w apps/api`) → integration test (`npm run test:integration -w apps/api`, Testcontainers — works unmodified on `ubuntu-latest` since Docker is pre-installed there). Single job, steps run in sequence so a failure at any gate stops the pipeline and is easy to attribute.
**Acceptance criteria:**

- [ ] Workflow triggers on push and PR to `main` (not yet verified — branch not pushed)
- [x] Each of lint / format / build / unit test / integration test is its own visible step (not one opaque `npm run ci` blob) — a failure clearly names which gate broke
- [ ] A deliberately broken/unformatted file fails the format step; a deliberately failing test fails the test step (equivalent local commands verified; not yet run on an actual GitHub Actions PR)
- [ ] Pipeline is green on a real PR opened against `main` (not yet — branch not pushed)
      **Verification:** open a PR from a branch with Phase 0's changes, confirm all steps run and pass; temporarily introduce a lint error / formatting issue / failing test on a scratch branch to confirm each gate actually fails (not silently skipped)
      **Dependencies:** 0.7
      **Files:** `.github/workflows/ci.yml`
      **Size:** S

---

### Checkpoint: Phase 0 complete

- [x] `npm run build --workspaces` clean
- [x] `docker compose up -d db`, migrations apply cleanly to an empty DB
- [x] `npm run test -w apps/api` and `npm run test:integration -w apps/api` both pass
- [x] The rollback proof test in 0.7 is genuinely red/green-tested (temporarily break the transaction wiring — e.g. cache `tx` in the repository's constructor — and confirm the rollback test fails, then revert)
- [x] Ready for Step 1 (auth) to consume `RECRUITERS_REPOSITORY` with zero additional wiring
- [ ] GitHub Actions CI is green on `main` (lint, format, build, unit test, integration test all passing as separate steps) — not yet, branch not pushed

## Commit Plan

One commit per task, in dependency order — each leaves `main` buildable and green (`npm run build --workspaces` + whatever test scripts exist at that point). No squashing across tasks; short, conventional-commit messages (per `CLAUDE.md`, no attribution lines).

| #   | Task                                    | Commit message                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | 0.1 Monorepo bootstrap                  | `chore: bootstrap npm workspaces and nest api skeleton`                         |
| 2   | 0.2 Docker Compose + config             | `chore: add docker compose postgres and env config`                             |
| 3   | 0.3 Drizzle schema + migrations         | `feat(db): add drizzle schema and migrations`                                   |
| 4   | 0.4 Drizzle client provider             | `feat(db): add drizzle client provider`                                         |
| 5   | 0.5 Transactional infra                 | `feat(db): wire nestjs-cls transactional adapter`                               |
| 6   | 0.6 RecruitersRepository                | `feat(db): add recruiters repository`                                           |
| 7   | 0.7 Testcontainers harness + proof test | `test(db): add testcontainers integration harness and transactional proof test` |
| 8   | 0.8 GitHub Actions CI                   | `ci: add lint, format, build, and test pipeline`                                |

Note: commits 4–6 (`db` client, transactional wiring, first repository) have no independent test coverage of their own — each is verified retroactively by 0.7's integration test (per their tasks' "Verification" lines). They still land as separate commits for reviewability (small, single-concern diffs), just not independently green on their own test suite between commits 4 and 7.

## Risks and Mitigations

| Risk                                                                                                                      | Impact                           | Mitigation                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle 1.0 RC ships a breaking change before Stage 1 finishes (still an RC, not stable)                                  | Medium                           | Pin the exact resolved version (`1.0.0-rc.4`), not a floating `rc`/`*` range; bump deliberately                                                                                                            |
| A future repository caches `this.txHost.tx` in its constructor instead of reading it per-call, silently breaking rollback | High (silent data-integrity bug) | 0.7's rollback test is the regression guard; note the rule directly in `repositories.module.ts` as the one non-obvious comment                                                                             |
| `ClsModule` middleware not mounted on some request path (e.g. a future non-HTTP entrypoint like a CLI script)             | Medium                           | `middleware.mount: true` covers all HTTP routes; flag explicitly if Stage 2's `scripts/seed.ts`/`eval.ts` need transactional repositories outside an HTTP request (they'd need `ClsService#run` manually)  |
| ~~Testcontainers needs a reachable Docker daemon wherever tests run~~                                                     | ~~Medium~~                       | Resolved by Task 0.8: `ubuntu-latest` GitHub Actions runners ship Docker Engine pre-installed, confirmed via Docker's own Testcontainers+GH Actions guidance — no DinD/service-container workaround needed |
| CI pipeline itself becomes a maintenance burden if lint/format/build/test steps drift out of sync with local scripts      | Low                              | Task 0.8's steps call the exact same npm scripts a developer runs locally (`npm run lint`, `test`, `test:integration`, `build`) — CI is not a separate config to keep in sync                              |

## Open Questions

- None blocking. Low-stakes implementation defaults chosen without a separate ask (documented above under Architecture Decisions): plain `postgres:17` image for the Docker Compose dev service; one ephemeral Testcontainers Postgres per integration test file rather than a shared/reused container. Flag if either should change.
