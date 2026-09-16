# Implementation Plan: Swap `@nestjs/config` for `nest-typed-config`

**Status: in progress.** Started on `feat/typed-config` after PR #2 (Step 1 auth) merged.

## Context

`apps/api` currently reads its 5 env vars (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`) via `@nestjs/config`'s `ConfigService.get<string>('KEY')` / `.getOrThrow<string>('KEY')`, validated by a hand-written Joi schema (`apps/api/src/config/env.validation.ts`). This is stringly-typed: every call site repeats the key as a string literal and a manual generic type argument, with no compile-time link between the two, and typos in the key string only surface at runtime.

`nest-typed-config` replaces this with a plain class (`EnvConfig`) decorated with `class-validator` — the same validation library already used for request DTOs — injected directly by type. Once validated at boot, every property is a real, always-defined field (no `OrThrow` ceremony for required keys), and a typo in a property name is a TypeScript compile error instead of a runtime `Config validation error`.

## Research Findings

- **`nest-typed-config@2.10.1`** is CJS (verified via tarball inspection — `"use strict"` output, no `"type": "module"`), avoiding the exact ESM-only trap that broke `@nestjs/jwt@12` in Step 1. Peers `@nestjs/common >= 6.10.0 < 12` — compatible with this project's Nest 10.
- **`TypedConfigModule.forRoot({ schema, load })` validates synchronously**, right inside `forRoot()` (confirmed by reading `dist/typed-config.module.js`) — the exact same "runs at module-import time, not lazily at DI-resolution time" behavior `@nestjs/config`'s `ConfigModule.forRoot({ validationSchema })` had. This is precisely the class of bug Step 1 hit in CI (`docs/plans/step-1-auth-plan.md`'s "fix(api): seed required env vars before e2e AppModule import" commit) — the existing fix (`apps/api/test/jest-e2e-setup.ts`, a Jest `setupFiles` script that seeds `process.env` before any test file's `import { AppModule }` chain runs) **still applies unchanged**; only its explanatory comments need updating to name the new library.
- **`isGlobal: true` is `nest-typed-config`'s default** (confirmed in source) — matching the current `ConfigModule.forRoot({ isGlobal: true })` setup. Once registered once in `AppModule`, `EnvConfig` is injectable anywhere without re-importing a module, same as today.
- **`dotenvLoader()` replicates `@nestjs/config`'s exact `.env`-loading precedence** (its own source comment: "Parts of this file come from the official config module for Nest.js") — loads `.env` from `process.cwd()` only for keys not already in `process.env`, then merges with `process.env` (which always wins). No behavior change for local dev, Docker, or CI.
- **`dotenvLoader` needs the `dotenv` package resolvable at runtime** (`loadPackage('dotenv', ...)` → `require('dotenv')`). It's currently only an `apps/api` **devDependency** (used by `drizzle.config.ts`, a dev-time CLI script) — needs to move to `dependencies` since `TypedConfigModule.forRoot` now runs as part of the actual app boot.
- **Class-validator/class-transformer duplicate-instance risk — confirmed a non-issue.** `nest-typed-config` ships its own nested `class-validator@^0.14.0`/`class-transformer@^0.5.1`, which don't satisfy this project's already-installed `^0.15.1`/`^0.5.1` (hoisted at the workspace root since Step 1's DTOs). This could cause decorator-metadata mismatches if two different library instances were in play — but `nest-typed-config`'s own `utils/imports.util.js` explicitly resolves `class-validator`/`class-transformer` via `require.resolve(name, { paths: ['../..', '.'] })`, i.e. it walks up to the hoisted root copy first (the exact comment in its source: "Resolve class-validator, class-transformer from root node_modules to avoid decorator metadata conflicts"). Since our root copy is already hoisted, `nest-typed-config` will use the same instance our `EnvConfig` decorators come from — no special import workaround needed.
- **`@IsUrl`'s default `require_tld: true` would reject `localhost`** in `DATABASE_URL` (e.g. `postgres://rag_ats:rag_ats@localhost:5432/rag_ats`, and the Testcontainers e2e placeholder). Joi's `.uri()` had no such restriction. Needs `@IsUrl({ protocols: ['postgres', 'postgresql'], require_tld: false })`.

## Architecture Decisions

- **New file `apps/api/src/config/env.config.ts`** replaces `env.validation.ts`, exporting one flat `EnvConfig` class (no nesting needed for 5 vars). Property names match the env var names **exactly** (`DATABASE_URL`, `JWT_SECRET`, ...) — `dotenvLoader`'s default (no `keyTransformer`) requires an exact key match, and this keeps `.env`/`.env.example` completely unchanged.
- **Decorators mirror the current Joi schema 1:1**:
  ```ts
  export class EnvConfig {
    @IsUrl({ protocols: ['postgres', 'postgresql'], require_tld: false })
    public readonly DATABASE_URL!: string;

    @IsString()
    @MinLength(1)
    public readonly JWT_SECRET!: string;

    @IsOptional()
    @IsString()
    public readonly JWT_EXPIRES_IN: string = '7d';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(65535)
    public readonly PORT: number = 3000;

    @IsOptional()
    @IsIn(['development', 'production', 'test'])
    public readonly NODE_ENV: string = 'development';
  }
  ```
  Class field defaults (`= '7d'`, etc.) are honored by `nest-typed-config`'s validator (`plainToClass(Config, rawConfig, { exposeDefaultValues: true })`, confirmed in source) — same effect as Joi's `.default()`.
- **Migrate consumers in two waves, keeping both config libraries installed until every consumer is migrated** (root/db in one task, auth in the next) — each task still leaves a fully green build/test state, just transiently sourced from two config providers. Only the final task removes `@nestjs/config` + `joi` once nothing references them.
- **Every `ConfigService` constructor param becomes an `EnvConfig` constructor param; every `.get<string>('KEY')`/`.getOrThrow<string>('KEY')` becomes `config.KEY`** (direct, always-typed property access — required fields need no more `OrThrow`, since validation already guarantees they're defined by the time DI resolves anything).
- **`dotenv` moves from `devDependencies` to `dependencies`** in `apps/api/package.json` (see Research Findings).

## Task List

### Task 1: Add `nest-typed-config` + define `EnvConfig`

**Description:** Install `nest-typed-config` (dependency); move `dotenv` from `devDependencies` to `dependencies`. Create `apps/api/src/config/env.config.ts` with the `EnvConfig` class above. Leave `env.validation.ts` and all current `ConfigService` usage untouched — `EnvConfig` isn't wired into `AppModule` yet, so this step has no runtime effect.
**Acceptance criteria:**

- [ ] `npm run build --workspaces` succeeds (new file compiles; nothing imports it yet)
- [ ] `nest-typed-config` resolves `class-validator`/`class-transformer` from the hoisted root copy (spot-check: only one copy of each under `node_modules/.package-lock.json` at a version satisfying both `^0.15.1` and `nest-typed-config`'s own range, or a nested copy exists only if genuinely required — not expected, but worth a quick look)
      **Verification:** build
      **Dependencies:** None
      **Files:** `apps/api/package.json`, `apps/api/src/config/env.config.ts`
      **Size:** S

### Task 2: Wire `TypedConfigModule` + migrate `db.module.ts`

**Description:** Add `TypedConfigModule.forRoot({ schema: EnvConfig, load: dotenvLoader() })` to `AppModule`'s imports, alongside the still-present `ConfigModule.forRoot(...)`. Migrate `db.module.ts`'s `Pool` factory to `inject: [EnvConfig]` / `config.DATABASE_URL`; drop its now-redundant `imports: [ConfigModule]` (global by default).
**Acceptance criteria:**

- [ ] App boots; DB connects via `EnvConfig`-sourced `DATABASE_URL`
- [ ] `npm run test:integration -w apps/api` passes unchanged (exercises `DbModule`/`RepositoriesModule`)
      **Verification:** build + `npm run test:integration -w apps/api`
      **Dependencies:** 1
      **Files:** `apps/api/src/app.module.ts`, `apps/api/src/db/db.module.ts`
      **Size:** M

### Task 3: Migrate auth module to `EnvConfig`

**Description:** `auth.module.ts`'s `JwtModule.registerAsync`: `inject: [EnvConfig]`, `config.JWT_SECRET` / `config.JWT_EXPIRES_IN`; drop `imports: [ConfigModule]`. `jwt.strategy.ts`: constructor takes `EnvConfig`, `secretOrKey: config.JWT_SECRET`. `auth.controller.ts`: constructor's `ConfigService` → `EnvConfig`. `access-token-cookie.ts`: both functions take `EnvConfig`, use `config.JWT_EXPIRES_IN` / `config.NODE_ENV` directly.
**Acceptance criteria:**

- [ ] Full e2e auth suite passes unchanged (register, login + cookie flags/expiry, `/me`, logout) — no test file changes needed, only the app code underneath
      **Verification:** `npm run test:e2e -w apps/api`
      **Dependencies:** 2
      **Files:** `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/jwt.strategy.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/access-token-cookie.ts`
      **Size:** M

### Task 4: Remove `@nestjs/config` + `joi`, final verification

**Description:** Remove `ConfigModule.forRoot(...)` from `app.module.ts` (TypedConfigModule is now the sole config source). Delete `apps/api/src/config/env.validation.ts`. `npm uninstall @nestjs/config joi -w apps/api`. Update the comments in `apps/api/test/jest-e2e-setup.ts` and `apps/api/test/e2e-app.util.ts` that name `ConfigModule.forRoot` to instead name `TypedConfigModule.forRoot` (same underlying gotcha, just the new library). Confirm `apps/api/.env.example` needs no edits (same 5 keys, unchanged names).
**Acceptance criteria:**

- [ ] `@nestjs/config` and `joi` no longer appear in `apps/api/package.json`
- [ ] `grep -r "ConfigService\|@nestjs/config" apps/api/src` returns nothing
- [ ] Full local suite green: build, lint, `prettier --check .`, unit, integration, e2e
- [ ] e2e suite re-verified with the local `apps/api/.env` file temporarily removed/renamed (reproducing CI's no-`.env` condition, per the lesson from Step 1's real CI failure) — then `.env` restored
      **Verification:** all commands above, run in sequence
      **Dependencies:** 3
      **Files:** `apps/api/src/app.module.ts`, `apps/api/src/config/env.validation.ts` (deleted), `apps/api/package.json`, `apps/api/test/jest-e2e-setup.ts`, `apps/api/test/e2e-app.util.ts`
      **Size:** S

---

### Checkpoint: Config swap complete

- [ ] `@nestjs/config` and `joi` fully removed; `nest-typed-config` is the sole config source
- [ ] Every consumer injects `EnvConfig` by type — no `.get`/`.getOrThrow` string-keyed access left anywhere in `apps/api/src`
- [ ] build/lint/format/unit/integration/e2e all green locally, including the no-local-`.env` repro
- [ ] CI green on a real PR

## Commit Plan

One commit per task, in dependency order (per CLAUDE.md: ask before each actual commit).

| #   | Task                        | Commit message                                             |
| --- | --------------------------- | ---------------------------------------------------------- |
| 1   | 1: Add dependency + schema  | `chore(api): add nest-typed-config and env schema class`   |
| 2   | 2: Wire module + migrate db | `refactor(db): migrate db module to nest-typed-config`     |
| 3   | 3: Migrate auth module      | `refactor(auth): migrate auth module to nest-typed-config` |
| 4   | 4: Remove old library       | `chore(api): remove nestjs/config and joi`                 |

## Risks and Mitigations

| Risk                                                                                                                                        | Impact                                                  | Mitigation                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `@IsUrl`'s default `require_tld: true` rejects `localhost` in `DATABASE_URL`                                                                | High (app fails to boot everywhere — dev, CI, tests)    | Explicit `{ protocols: ['postgres', 'postgresql'], require_tld: false }`                                                                   |
| `dotenvLoader` can't resolve `dotenv` at runtime if left as a devDependency                                                                 | Medium (boot failure in any install that skips devDeps) | Move `dotenv` to `dependencies` in Task 1                                                                                                  |
| ~~Duplicate `class-validator`/`class-transformer` instances causing decorator-metadata mismatches~~                                         | ~~Medium~~                                              | Resolved: `nest-typed-config` explicitly resolves both from the hoisted root copy (confirmed in its source)                                |
| `TypedConfigModule.forRoot`'s eager, import-time validation catches out a future test file the way `@nestjs/jwt`'s CI failure did in Step 1 | Medium                                                  | Same fix already in place (`jest-e2e-setup.ts`'s `setupFiles`); Task 4 explicitly re-verifies with `.env` removed before calling this done |

## Open Questions

None blocking — this is a self-contained, fully-researched library swap with no user-facing behavior change (same env vars, same validation rules, same `.env` precedence).
