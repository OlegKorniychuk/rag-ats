# RAG-ATS

RAG-powered ATS prototype for tech recruiting (master's thesis project). Stage 1 (vacancy CRUD, auth, public apply flow, pipeline management, shared candidate pool) is built. Stage 2 is in progress: PDF CV upload and LLM parsing of the CV into a structured profile are built; GitHub enrichment, semantic search and fit scoring are not.

## Docs

- [`SPEC.md`](./SPEC.md) — requirements and full product intent (Stage 1 + Stage 2)
- [`docs/sdd.md`](./docs/sdd.md) — as-built design + API + frontend reference for what's actually implemented
- [`docs/plans/stage-2.md`](./docs/plans/stage-2.md) — Stage 2 roadmap (CV parsing, rating, RAG, eval)
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
```

The API will not boot without `OPENAI_API_KEY` (used to parse CVs in a background job). `apps/api/.env.example` lists every variable: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`, `WEB_ORIGIN`, `OPENAI_API_KEY` (required: set your own key, never commit it), `OPENAI_MODEL` (default `gpt-5.4-mini`) and `JOBS_POLL_INTERVAL_SECONDS` (default `2`). Tests do not need a real key.

## Using the app

1. Register an account at `http://localhost:5173` and log in.
2. Create a vacancy.
3. Copy its public apply link from the vacancies list.
4. Open that link logged out (or in a private window) to submit an application with a PDF CV. The candidate's profile is filled in from the CV in the background; a Pending/Parsing chip shows progress, and a failed parse can be retried from the candidate page.
5. Open the vacancy to move applicants across pipeline stages on the drag-and-drop board.
6. Browse the shared candidate pool at `/candidates`.
