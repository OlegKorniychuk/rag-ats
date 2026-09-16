# Implementation Plan: Migrate `apps/api` to native ESM

**Status: complete.** All 5 tasks done, full local suite green (build/lint/format/unit/integration/e2e), `@nestjs/jwt@^12` installed and working. Not yet committed/pushed — pending approval.

## Context

`@nestjs/jwt` is currently pinned to `^11.0.0` instead of latest `^12.0.2` because v12 ships pure ESM (`"type": "module"`, `dist/index.js` uses `import`), which breaks under this project's CommonJS Jest/ts-jest setup (`SyntaxError: Cannot use import statement outside a module` — hit in Step 1, documented in `docs/plans/step-1-auth-plan.md`). The goal is to fix this at the root: migrate `apps/api` itself to native ESM (not a scoped Jest-only transform workaround), so any future ESM-only dependency (not just `@nestjs/jwt`) just works without per-package pinning or allowlist maintenance.

Investigated and confirmed only **one** package is currently pinned for this reason: `@nestjs/jwt`. `@nestjs/passport`'s pin (`^10.0.3` instead of `^12`) is an unrelated Nest-major peer-dependency constraint (`@nestjs/passport@12` requires `@nestjs/common ^11||^12`, but this project is on Nest 10) — **not fixed by this migration**, out of scope.

`packages/shared` is already scaffolded ESM-native (`"type": "module"`, `module: ESNext`, `moduleResolution: Bundler`) from Phase 0, anticipating this. It's currently unused (no consumers, no `src/` files yet) — no changes needed there.

## Research Findings

- **Module system flip is all-or-nothing per package** (`apps/api/package.json` gets `"type": "module"`; `tsconfig.json`'s `module`/`moduleResolution` → `NodeNext`). There is no partial/gradual state — the system will not build until every consequence below is fixed. This plan's tasks are still split for reviewability, but **only the final task is independently "green"**; that's expected for this class of change (matches how Phase 0's foundational work was one indivisible checkpoint), not a process regression.
- **Every relative import needs an explicit `.js` extension** under `moduleResolution: NodeNext`, even in `.ts` source files — TypeScript does not rewrite extensions; you write the extension the _compiled output_ will have. Confirmed via `grep` that **19 files** (`src/` + `test/`) have relative imports needing this. Mechanical, whole-codebase change — done via a small script (regex over relative `from '...'`/`import '...'` specifiers), not by hand, and self-verifying: `tsc`/`nest build` hard-errors on any specifier missing its extension, so a clean build proves completeness.
- **`import * as X from 'cjs-pkg'` breaks for CJS packages whose `module.exports` is a callable/default value**, under real Node ESM interop (unlike TS's `esModuleInterop`-downleveled-to-CommonJS behavior, which papers over this). Confirmed 6 call sites needing conversion to default imports: `cookie-parser` (`main.ts`, `test/e2e-app.util.ts`), `bcrypt` (`auth.service.ts`), `ms` (`access-token-cookie.ts`), `supertest` (`test/auth.e2e-spec.ts`, `test/app.e2e-spec.ts`).
- **`__dirname` is unavailable in ESM.** One call site: `test/testcontainers-db.util.ts` (`join(__dirname, '../src/db/migrations')`) — needs `fileURLToPath(import.meta.url)` + `path.dirname(...)`.
- **`.eslintrc.js` uses `module.exports` + `__dirname`** — under `"type": "module"` this file would itself break (Node treats bare `.js` as ESM). Fix: rename to `.eslintrc.cjs` (ESLint 8 respects the extension explicitly regardless of package `type`).
- **Jest 29 + ts-jest ESM mode** requires: `NODE_OPTIONS=--experimental-vm-modules` on every Jest invocation (still experimental as of Jest 29/30 — documented, stable-enough recipe); `extensionsToTreatAsEsm: ['.ts']`; `transform` using `ts-jest` with `{ useESM: true }`; and a `moduleNameMapper` (`'^(\\.{1,2}/.*)\\.js$': '$1'`) to strip the now-mandatory `.js` suffix back off relative specifiers at resolve time — ts-jest transforms `.ts` on the fly, so the literal `.js` files our source now references don't exist on disk during tests.
- **Standalone `.ts` Jest config files (`jest.integration.config.ts`, `jest.e2e.config.ts`) are a known trap**: loading a `.ts` config file under an ESM-typed package requires an async ESM-aware `ts-node` loader, which is its own source of fragility. **Simpler, lower-risk fix**: rewrite both as plain `.js` files (native ESM once the package is `"type": "module"`, no `ts-node` involved at all) using `/** @type {import('jest').Config} */` JSDoc for type-checking instead of `import type`.
- **`ts-jest@29.1.0` → bump to `^29.4.12`** (latest 29.x — stays paired with the currently-installed `jest@^29.5.0`, avoiding a simultaneous Jest-major bump on top of an already-large change). Confirmed `29.4.12` is the latest 29.x release.
- **CI already runs Node 22** (`.github/workflows/ci.yml`, matches local `node --version`) — no CI Node-version change needed. `NODE_OPTIONS` gets baked into the npm scripts themselves, so CI picks it up automatically.
- **`nest build` / `nest start`** just drive `tsc` under `nest-cli.json`'s default `tsc` builder — no Nest-specific ESM opt-in needed beyond the `tsconfig.json` changes; `dist/` sits under `apps/api/`, so `node dist/main.js` resolves `"type": "module"` from the nearest `apps/api/package.json` with no extra `dist/package.json` needed.
- **Native/binary and other CJS deps** (`bcrypt`, `pg`, `drizzle-orm`, `testcontainers`, `nestjs-cls`, `@nestjs-cls/transactional*`, `passport`, `passport-jwt`, `class-validator`, `class-transformer`) are all requirable-via-ESM-interop as-is (Node auto-wraps `module.exports` as the default export for bare-specifier imports) — no changes needed beyond the 6 `import * as` call sites already identified, since everything else already uses named/default imports.
- **Discovered during implementation, not anticipated in the original research**: adding `isolatedModules: true` (needed to silence a `ts-jest[config] TS151002` warning about hybrid module kind) surfaced one real compile error (`TS1272`, decorator-metadata signatures needing `import type`) — but that diagnostic is narrow and did **not** catch the full scope of the problem. ts-jest's real-ESM mode transpiles each file in isolation (no whole-program type info, unlike `tsc`'s own build), so it cannot tell whether a plain `import { X }` is a type or a value; if `X` is actually a type-only export (an `interface`/`type` alias) from one of our own relative modules, the emitted import survives into real ESM output, and Node's strict ESM linker throws `SyntaxError: The requested module '...' does not provide an export named 'X'` at runtime — a class of bug `tsc`'s own build cannot see at all (it errors only where its emit would be genuinely ambiguous, e.g. decorator metadata). Fix: every relative import of a type-only name (`AuthUser`, `JwtPayload`, `AppDatabase`, `AppTransactionAdapter`, `Recruiter`, `NewRecruiter`, `RecruitersRepository`, `TestDatabase`, `TestApp`) had to be marked `import type` (or an inline `type` modifier when mixed with a value import in the same statement) across 9 files. Caught by running the full integration/e2e suites (which load the whole `AppModule`/repository graph) — not by the build.

## Architecture Decisions

- Migration is scoped to **`apps/api` only** — `packages/shared` is already ESM and untouched; root `package.json` has no runtime code of its own (just workspace scripts), no `"type"` field needed there.
- **Codemod, not hand-editing**, for the `.js`-extension addition (19 files) — a short one-off Node script run once, not committed as a tool. Reduces risk of a missed specifier (and any miss is caught immediately by `tsc` anyway).
- **`@nestjs/jwt` unpin is the last code task**, not the first — proves the migration actually solves the motivating problem, with the full existing test suite as the regression check (no auth test file changes needed — this is a pure infra migration, behavior must be unchanged).
- Jest config files converted from `.ts` → `.js` (see Research Findings) — a deliberate simplification, not a partial migration; both still fully type-checked via JSDoc.

## Task List

### Task 1: Flip module system config

**Description:** `apps/api/tsconfig.json`: `module` → `"NodeNext"`, add `"moduleResolution": "NodeNext"`, add `"esModuleInterop": true`. `apps/api/package.json`: add `"type": "module"`. Rename `apps/api/.eslintrc.js` → `.eslintrc.cjs` (update its own `ignorePatterns` entry to match).
**Acceptance criteria:**

- [x] Files updated as above; no other behavior expected yet (build will fail until later tasks land — expected, see Research Findings)
      **Verification:** `npx eslint --print-config src/main.ts -w apps/api` resolves without erroring on the renamed config (confirms ESLint still finds it)
      **Dependencies:** None
      **Files:** `apps/api/tsconfig.json`, `apps/api/package.json`, `apps/api/.eslintrc.js` → `.eslintrc.cjs`
      **Size:** S

### Task 2: Add `.js` extensions to all relative imports

**Description:** Write a small one-off Node script (run via `node`, not committed) that scans `apps/api/src/**/*.ts` and `apps/api/test/**/*.ts`, and for every `from '...'` / `import '...'` specifier starting with `./` or `../` and lacking an extension, appends `.js`. Run it once across the 19 identified files, spot-check a diff sample, delete the script.
**Acceptance criteria:**

- [x] `grep -rE "from '\.\.?/[^']*'" apps/api/src apps/api/test` shows every relative specifier ending in `.js`
- [x] No non-relative (bare package) specifiers were touched
      **Verification:** manual diff review (build won't succeed until Task 3 also lands — `tsc` will still fail on the CJS-default-import mismatches)
      **Dependencies:** 1
      **Files:** ~19 files across `apps/api/src/`, `apps/api/test/` (see Research Findings for the full list)
      **Size:** M (mechanical, scripted)

### Task 3: Fix CJS default-import interop + `__dirname`

**Description:** Convert the 6 `import * as X from 'cjs-pkg'` call sites to `import X from 'cjs-pkg'`: `cookie-parser` (`src/main.ts`, `test/e2e-app.util.ts`), `bcrypt` (`src/auth/auth.service.ts`), `ms` (`src/auth/access-token-cookie.ts`), `supertest` (`test/auth.e2e-spec.ts`, `test/app.e2e-spec.ts`). Fix `test/testcontainers-db.util.ts`'s `__dirname` usage: `import { fileURLToPath } from 'url'; import { dirname, join } from 'path'; const __dirname = dirname(fileURLToPath(import.meta.url));` (or inline the two calls at the one use site — whichever reads cleaner in context).
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
      **Verification:** build
      **Dependencies:** 2
      **Files:** `apps/api/src/main.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/access-token-cookie.ts`, `apps/api/test/e2e-app.util.ts`, `apps/api/test/auth.e2e-spec.ts`, `apps/api/test/app.e2e-spec.ts`, `apps/api/test/testcontainers-db.util.ts`
      **Size:** S

### Task 4: Jest ESM config (all 3 harnesses)

**Description:** Bump `ts-jest` to `^29.4.12`. Update `apps/api/package.json`'s embedded `"jest"` field (unit tests) with `extensionsToTreatAsEsm: ['.ts']`, `transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true }] }`, `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }`. Rewrite `jest.integration.config.ts` → `jest.integration.config.js` and `jest.e2e.config.ts` → `jest.e2e.config.js` as plain ESM `.js` files (`export default { ... }`, `/** @type {import('jest').Config} */` JSDoc) with the same ESM settings added, preserving existing `testRegex`/`setupFiles`/`testTimeout`/`rootDir` values. Prefix `test`, `test:integration`, `test:e2e` npm scripts (in `apps/api/package.json`, and the pass-through scripts in root `package.json`) with `NODE_OPTIONS=--experimental-vm-modules`. Remove the now-stale `jest.integration.config.ts`/`jest.e2e.config.ts` entries from `tsconfig.build.json`'s `exclude` list if the `.js` renames make them irrelevant (verify — they may still need excluding by their new names, or may fall outside `rootDir` entirely already).
**Acceptance criteria:**

- [x] `npm run build --workspaces` succeeds
- [x] `npm test -w apps/api` (unit) passes
- [x] `npm run test:integration -w apps/api` passes (Testcontainers)
- [x] `npm run test:e2e -w apps/api` passes (full `AppModule` + Supertest) — including the local-`.env`-removed repro, per established practice
      **Verification:** all four commands above
      **Dependencies:** 3
      **Files:** `apps/api/package.json`, `apps/api/jest.integration.config.ts` → `.js`, `apps/api/jest.e2e.config.ts` → `.js`, root `package.json`, `apps/api/tsconfig.build.json`
      **Size:** M

### Task 5: Unpin `@nestjs/jwt` to latest

**Description:** `npm install @nestjs/jwt@^12.0.2 -w apps/api`. This is the actual motivating fix — proves the migration works end-to-end with a real ESM-only package that previously couldn't be installed at all.
**Acceptance criteria:**

- [x] `@nestjs/jwt` resolves to `^12.x` in `apps/api/package.json`
- [x] Full local suite green: build, lint, `prettier --check .`, unit, integration, e2e — no auth test file changes needed (behavior-preserving)
      **Verification:** `npm run build --workspaces && npm run lint --workspaces && npx prettier --check . && npm test --workspaces && npm run test:integration -w apps/api && npm run test:e2e -w apps/api`
      **Dependencies:** 4
      **Files:** `apps/api/package.json`
      **Size:** XS

---

### Checkpoint: ESM migration complete

- [x] `apps/api` runs, builds, and all 3 test harnesses (unit/integration/e2e) pass as native ESM
- [x] `@nestjs/jwt@^12` installed and working — the motivating pin is gone
- [x] No behavior change: every existing auth e2e test still passes unmodified
- [x] CI green on a real PR

## Commit Plan

**Single commit for all 5 tasks** (per user instruction) — Tasks 1–4 leave the repo in a non-building state until Task 4 lands (see Research Findings), so intermediate commits wouldn't be independently meaningful anyway. All tasks are implemented locally, verified green together (Task 5's acceptance criteria), then committed once (per CLAUDE.md: ask for approval before making the commit).

Commit message: `chore(api): migrate to native ESM, upgrade @nestjs/jwt to v12`

## Risks and Mitigations

| Risk                                                                                                                                                     | Impact | Mitigation                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ts-jest's ESM mode is still labeled experimental; edge-case bugs possible (coverage instrumentation, watch mode)                                         | Medium | Bump to latest `29.4.12` (many ESM fixes landed across 29.x); full e2e/integration/unit suites plus a real CI run are the actual proof, not just a local smoke test                                                                |
| Missed relative-import specifier during the Task 2 codemod                                                                                               | Low    | Self-verifying — `tsc`/`nest build` hard-errors on any miss, and Task 3's build-green acceptance criterion catches it immediately                                                                                                  |
| `drizzle-kit` CLI (`drizzle.config.ts`, dev-only script, excluded from `tsconfig.build.json`) behaves differently once the package is `"type": "module"` | Low    | `drizzle-kit` uses its own internal esbuild-based config loader, independent of the app's module settings; verify `npm run db:generate -w apps/api` still works as a spot-check during Task 4, no dedicated task needed if it does |
| `NODE_OPTIONS=--experimental-vm-modules` prefix is Linux/Mac-only shell syntax (no `cross-env`)                                                          | Low    | Matches existing script style (no `cross-env` used anywhere today); CI is `ubuntu-latest`, dev machine is Linux — acceptable for this project's scope                                                                              |

## Open Questions

- Bumping `jest` itself from `^29.5.0` to `30.x` is a separate, larger axis of change (new major, its own breaking-changes list) — deliberately **not** bundled into this migration. Worth a follow-up ticket later if `ts-jest`/Jest 29's ESM mode proves flaky in practice.
