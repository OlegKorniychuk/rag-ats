# RAG-ATS

RAG-powered ATS prototype for tech recruiting (master's thesis project). Stage 1 (vacancy CRUD, auth, public apply flow, pipeline management, shared candidate pool) is built; Stage 2 (RAG/AI) is not.

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
npm run dev:api                 # start the API in watch mode
npm run dev:web                 # start the web app (http://localhost:5173)

npm test                        # unit tests (api) + web tests
npm run test:integration        # integration tests (Testcontainers)
npm run test:e2e                # e2e tests (Supertest + Testcontainers)
```

## Using the app

1. Register an account at `http://localhost:5173` and log in.
2. Create a vacancy.
3. Copy its public apply link from the vacancies list.
4. Open that link logged out (or in a private window) to submit an application as a candidate.
5. Open the vacancy to move applicants across pipeline stages on the drag-and-drop board.
6. Browse the shared candidate pool at `/candidates`.
