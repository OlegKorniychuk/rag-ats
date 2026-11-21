# RAG-ATS

- Call me dude.
- Do not mention claude in commit messages.
- Do not create test plans in PRs.
- Keep commit messages short. Use conventional commits.
- Always ask for approval before making a commit.
- Use testcontainers and MSW for integration tests where necessary
- When an API request/response contract changes, start by updating `packages/shared/src/api.ts`, then make the DTOs/code match it.

## Project

RAG-powered ATS prototype for tech recruiting (master's thesis). Recruiters manage vacancies and a pipeline board; applicants apply through a public link with a PDF CV. The CV is parsed by an LLM (plus public GitHub data), every application gets a grounded fit score that cites evidence units, and the shared pool supports semantic search and "Find matches". A synthetic data set, a seed script and an eval harness produce the thesis metrics.

- `SPEC.md`: requirements and intent (see its "As-built deviations").
- `docs/sdd.md`: the system as built; the source of truth for design decisions (§8), config (§9), tests (§11) and known limits (§12).
- `docs/plans/`: the Stage 2 roadmap (`stage-2.md`) and per-step plans.
- `docs/eval/`: eval reports; `eval-baseline.md` has the main results.

## Structure

```
apps/api/            NestJS API, Drizzle + Postgres/pgvector, pg-boss jobs, OpenAI   → apps/api/CLAUDE.md
apps/web/            React + Vite SPA (recruiter UI + public apply page)             → apps/web/CLAUDE.md
packages/shared/     API contract types (src/api.ts), imported by both apps as @rag-ats/shared
data/checkpoint-a/   8 hand-made CVs (parse eval)
data/checkpoint-b/   4 vacancies (score eval)
data/synthetic/      100 synthetic personas, 10 vacancies, ground truth (see its README)
docs/                sdd.md, plans/, eval/ (reports; generated ones are not hand-edited)
docker-compose.yml   Postgres 17 + pgvector (db service)
```

## Commands (from the repo root)

```
npm install
npm run db:up                  # Postgres + pgvector in Docker
npm run db:migrate             # apply Drizzle migrations
npm run dev:api                # API in watch mode (http://localhost:3000, Swagger at /docs)
npm run dev:web                # web (http://localhost:5173)

npm test                       # API unit + web tests
npm run test:integration       # API integration (Testcontainers; needs Docker)
npm run test:e2e               # API e2e (Supertest + Testcontainers)
npm run lint                   # eslint, all workspaces
npm run build                  # all workspaces
npm run format:check           # prettier; run it last before a commit
```

CI (`.github/workflows/ci.yml`) runs lint → `prettier --check .` → build → unit → web → integration → e2e.

## Working rules

- **Never print secrets.** Don't `cat`/`grep` `apps/api/.env` or echo keys; check key names or "is set" only.
- **Live OpenAI runs cost money** (`$20` budget). Seed, eval, parse-eval and score-eval are manual: dry-run first, keep `--max-usd`, ask Dude before a paid run. Automated tests never call OpenAI or GitHub (MSW).
- Scripts that write reports (`db:seed`, `eval`, …) produce unformatted Markdown; run `npx prettier --write` on them.
- Keep `docs/sdd.md` in sync when behaviour changes; don't copy its numbers into other files.
