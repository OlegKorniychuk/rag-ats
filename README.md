# RAG-ATS

RAG-powered ATS prototype for tech recruiting (master's thesis project). Stage 1 (vacancy CRUD, auth, public apply flow, pipeline management, shared candidate pool) is built. Stage 2 is in progress: PDF CV upload, LLM parsing of the CV into a structured profile, GitHub enrichment of that profile (public repos, READMEs and languages) and grounded fit scoring of every application (per-criterion scores backed by verified quotes from the CV or GitHub) are built, and recruiters can add any pool candidate to their own vacancies, where they are scored the same way, and editing a vacancy's requirements re-scores its applicants; semantic search is not.

## Docs

- [`SPEC.md`](./SPEC.md) — requirements and full product intent (Stage 1 + Stage 2)
- [`docs/sdd.md`](./docs/sdd.md) — as-built design + API + frontend reference for what's actually implemented
- [`docs/plans/stage-2.md`](./docs/plans/stage-2.md) — Stage 2 roadmap (CV parsing, rating, RAG, eval)
- [`docs/eval/checkpoint-a.md`](./docs/eval/checkpoint-a.md) — live CV parse quality and cost report (Checkpoint A)
- Swagger UI at `http://localhost:3000/docs` when running locally (raw OpenAPI at `/docs-json`)

## Run locally

```
npm install                     # install workspace dependencies
npm run db:up                   # start Postgres via Docker Compose
npm run db:migrate              # apply migrations
cp apps/api/.env.example apps/api/.env   # then set OPENAI_API_KEY in apps/api/.env
npm run dev:api                 # start the API in watch mode
npm run dev:web                 # start the web app (http://localhost:5173)

npm test                        # unit tests (api) + web tests
npm run test:integration        # integration tests (Testcontainers)
npm run test:e2e                # e2e tests (Supertest + Testcontainers)

npm run parse-eval -w apps/api -- --label my-run --runs 2   # live CV parse eval (paid OpenAI calls)
npm run parse-eval -w apps/api -- --dry-run                 # same, without LLM calls
```

The API will not boot without `OPENAI_API_KEY` (used to parse CVs in a background job). `apps/api/.env.example` lists every variable: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`, `WEB_ORIGIN`, `OPENAI_API_KEY` (required: set your own key, never commit it), `OPENAI_MODEL` (default `gpt-5.4-mini`), `GITHUB_TOKEN` (optional) and `JOBS_POLL_INTERVAL_SECONDS` (default `2`). `GITHUB_TOKEN` is used to read candidates' public GitHub data when parsing a CV; without it the GitHub API allows 60 requests per hour, with it 5000 (a fine-grained token with no scopes is enough). Tests do not need a real key or token.

`parse-eval` parses the fictional CVs in `data/checkpoint-a/` with the real model and writes profiles, checks, tokens and cost to `docs/eval/checkpoint-a/<label>.{json,md}` (about $0.05 for 8 CVs × 2 runs on `gpt-5.4-mini`). It is never part of the test suites. Set `GITHUB_TOKEN` when running it repeatedly, since the unauthenticated GitHub limit runs out after a few runs.

## Using the app

1. Register an account at `http://localhost:5173` and log in.
2. Create a vacancy.
3. Copy its public apply link from the vacancies list.
4. Open that link logged out (or in a private window) to submit an application with a PDF CV. The candidate's profile is filled in from the CV (and their public GitHub repos, if a GitHub URL was given) in the background; a Pending/Parsing chip shows progress, and a failed parse can be retried from the candidate page.
5. Open the vacancy to move applicants across pipeline stages on the drag-and-drop board. Each card shows the applicant's fit score once their CV is parsed, and columns are ranked by it; click the score to see the per-criterion breakdown with quotes from the CV or GitHub, or to rescore. Editing an open vacancy's title or requirements re-scores all of its applicants (a closed vacancy's scores are marked outdated until you reopen it).
6. Browse the shared candidate pool at `/candidates`. A candidate's page lists their applications on your vacancies; use "Add to vacancy" to put them on another open vacancy, where they are scored like an applicant.
