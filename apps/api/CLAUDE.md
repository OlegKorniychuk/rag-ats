# apps/api

NestJS 10 API (native ESM), Drizzle ORM on Postgres 17 + pgvector, pg-boss jobs running in-process, OpenAI (`gpt-5.4-mini`, `text-embedding-3-small`). Design details: `docs/sdd.md` §2–§9, §11.

## Commands (from this folder, or `-w apps/api` from the root)

```
npm run start:dev              # watch mode
npm test                       # unit (src/**/*.spec.ts)
npx jest src/scoring           # one folder (prefix NODE_OPTIONS=--experimental-vm-modules if run directly)
npm run test:integration       # test/**/*.integration-spec.ts, Testcontainers, runInBand
npm run test:e2e               # test/**/*.e2e-spec.ts, Supertest + Testcontainers
npm run lint
npm run db:generate            # drizzle-kit: new migration from src/db/schema.ts
npm run db:migrate

# dev CLIs (paid OpenAI calls; dry-run first)
npm run db:seed -- --dry-run   # load data/synthetic/ through the apply pipeline
npm run eval -- --help         # retrieval + score-agreement eval on the seeded DB
npm run synth -- --help        # synthetic data stages
npm run parse-eval / score-eval
```

Use a separate DB by prefixing `DATABASE_URL=…`; process env overrides `.env` (sdd §13).

## Structure (`src/`)

```
auth/          register/login/logout, JWT in an httpOnly cookie, global JwtAuthGuard + @Public()
vacancies/     owner-scoped CRUD, add candidate, auto-rescore on edit; matches/ = Find matches
applications/  pipeline stage changes, rescore
apply/         PUBLIC: GET/POST /apply/:token, CV upload (multer, 5 MB, PDF magic bytes)
candidates/    shared pool, CV download, reparse; search/ = semantic search
cv/            PDF check + text extraction (pdf-parse v2)
llm/           LlmClient (only code that talks to OpenAI), CV parser, criteria extractor, ApplicationScorer, prompts/, Zod schemas
scoring/       pure helpers: evidence units, resolveCitations, computeOverall, criteria hash
rag/           chunking, per-criterion retrieval, ranking
github/        GitHub REST client, profile fetcher, FixtureGithubClient (seed)
jobs/          pg-boss setup, workers (parse, extract criteria, score, embed), startup sweep
db/            schema.ts, migrations/, repositories (interface + Drizzle impl per table)
config/        EnvConfig (validated env, sdd §9)
common/        shared DTOs, Postgres error helpers
scripts/       dev CLIs (seed, eval, synth, parse-eval, score-eval); compiled with the app, never imported by it
contract.check.ts  type-only check that DTOs/rows match @rag-ats/shared
```

`test/`: e2e and integration specs, `msw/` handlers (OpenAI, GitHub), Testcontainers and polling helpers, PDF fixtures.

## Conventions

- **ESM**: relative imports end in `.js`; import types with `import type` (ts-jest isolatedModules breaks otherwise; only integration/e2e catch it).
- Routes are guarded by default; mark public ones `@Public()`. Owner-scoping lives in the service layer.
- Request bodies and queries go through `class-validator` DTOs; contract changes start in `packages/shared/src/api.ts`.
- Repositories read `this.txHost.tx` fresh per call; multi-write service methods use `@Transactional()`.
- LLM output is grounded: the scorer cites evidence-unit IDs and `resolveCitations` turns them into stored quotes. CV/GitHub text is untrusted prompt input.
- Paid work runs outside transactions; enqueue jobs after commit.
- Tests: OpenAI and GitHub are mocked with MSW everywhere; an unmocked external request fails the test. Schema changes need a migration (`db:generate`) and a note in sdd §13 if it touches data.
