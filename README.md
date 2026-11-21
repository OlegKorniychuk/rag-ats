# RAG-ATS

RAG-powered ATS prototype for tech recruiting (master's thesis project). Stage 1 (vacancy CRUD, auth, public apply flow, pipeline management, shared candidate pool) is built. Stage 2 is in progress: PDF CV upload, LLM parsing of the CV into a structured profile, GitHub enrichment of that profile (public repos, READMEs and languages), grounded fit scoring of every application (per-criterion scores that cite numbered evidence units from the CV or GitHub, resolved to the exact source text by the server), adding pool candidates to vacancies, re-scoring on vacancy edits, semantic candidate search, "Find matches" for a vacancy and a RAG scoring mode are built, plus a synthetic data set of 100 candidates and 10 vacancies with ground truth, a seed script and an eval harness that measures retrieval and score agreement against that ground truth.

## Docs

- [`SPEC.md`](./SPEC.md) — requirements and full product intent (Stage 1 + Stage 2)
- [`docs/sdd.md`](./docs/sdd.md) — as-built design + API + frontend reference for what's actually implemented
- [`docs/plans/stage-2.md`](./docs/plans/stage-2.md) — Stage 2 roadmap (CV parsing, rating, RAG, eval)
- [`docs/eval/checkpoint-a.md`](./docs/eval/checkpoint-a.md) — live CV parse quality and cost report (Checkpoint A)
- [`docs/eval/checkpoint-b.md`](./docs/eval/checkpoint-b.md) — live scoring eval and citation review (Checkpoint B)
- [`docs/eval/rag-scoring.md`](./docs/eval/rag-scoring.md) — RAG vs full-text scoring comparison (step 9)
- [`docs/eval/checkpoint-c.md`](./docs/eval/checkpoint-c.md) — full-flow UI walkthrough (Checkpoint C)
- [`docs/eval/synthetic-data.md`](./docs/eval/synthetic-data.md) — synthetic data generation, spot-check and seed report (step 10)
- [`docs/eval/eval-baseline.md`](./docs/eval/eval-baseline.md) — retrieval and score-agreement baseline, evidence-ID citations before/after (steps 11–12)
- [`data/synthetic/README.md`](./data/synthetic/README.md) — what the synthetic set contains and how to regenerate it
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
npm run score-eval -w apps/api -- --label my-run --runs 2 --write-review   # live scoring eval (paid OpenAI calls)
npm run score-eval -w apps/api -- --summarise-review docs/eval/checkpoint-b/my-run.review.md   # count review labels
```

The API will not boot without `OPENAI_API_KEY` (used to parse CVs in a background job). `apps/api/.env.example` lists every variable: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `NODE_ENV`, `WEB_ORIGIN`, `OPENAI_API_KEY` (required: set your own key, never commit it), `OPENAI_MODEL` (default `gpt-5.4-mini`), `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`, used for candidate search), `SCORING_MODE` (`full_text` by default, or `rag` to score each requirement from the CV passages retrieved for it), `GITHUB_TOKEN` (optional), `GITHUB_FIXTURES_DIR` (optional, dev only: serve GitHub data from fixture files instead of the API) and `JOBS_POLL_INTERVAL_SECONDS` (default `2`). `GITHUB_TOKEN` is used to read candidates' public GitHub data when parsing a CV; without it the GitHub API allows 60 requests per hour, with it 5000 (a fine-grained token with no scopes is enough). Tests do not need a real key or token.

`parse-eval` parses the fictional CVs in `data/checkpoint-a/` with the real model and writes profiles, checks, tokens and cost to `docs/eval/checkpoint-a/<label>.{json,md}` (about $0.05 for 8 CVs × 2 runs on `gpt-5.4-mini`). It is never part of the test suites. Set `GITHUB_TOKEN` when running it repeatedly, since the unauthenticated GitHub limit runs out after a few runs.

`score-eval` scores the 4 fictional vacancies in `data/checkpoint-b/` against the same CVs (criteria extraction plus 32 scores per run, about $0.33 for 2 runs), checks grounding and expected bands, and writes a citation table to label by hand; see `docs/eval/checkpoint-b.md`.

## Seed the synthetic data

`npm run db:seed` loads `data/synthetic/` (100 candidates, 10 vacancies) through the real apply pipeline: each candidate applies to 2–3 vacancies with their PDF CV, and the background jobs parse, embed and score them with real OpenAI calls. GitHub data comes from the fixture files, so no GitHub call is made. Use a separate database so your dev data stays apart; process env overrides `apps/api/.env`:

```
docker compose exec db psql -U <user> -d postgres -c "CREATE DATABASE rag_ats_seed"
DATABASE_URL=postgres://<user>:<password>@localhost:5432/rag_ats_seed npm run db:migrate -w apps/api

npm run db:seed -- --dry-run                         # plan and cost estimate (~$2.00 with margin), no DB, no LLM
DATABASE_URL=… npm run db:seed -- --label smoke --only p001,p071,p062   # 3 personas first
DATABASE_URL=… npm run db:seed -- --label full --max-usd 3              # everything (resumes)
DATABASE_URL=… npm run db:seed -- --label retry --retry-failed          # rescore failed scores
```

Each run writes a report to `docs/eval/seed/<label>.{json,md}` (parse success, scores, failures, tokens and cost) and stops submitting when spend plus queued work would pass `--max-usd` (default $3). Re-running skips applications that already exist. The first full seed cost $1.74; 11 of 232 scores failed quote verification and two `--retry-failed` runs recovered 9 of them (`docs/eval/synthetic-data.md`).

Then start the API against the same database (`DATABASE_URL=… npm run dev:api`) and log in as `seed@example.com`. The password is `SEED_RECRUITER_PASSWORD` if you set it for the seed, otherwise the dev default `DEFAULT_SEED_PASSWORD` in `apps/api/src/scripts/seed/run.ts`.

## Run the eval

`npm run eval` measures retrieval (search and Find matches) and scoring (both modes) against the synthetic ground truth, on the database the seed filled. It only reads from it. Retrieval costs under a cent; scoring is a stratified sample of 381 pairs per mode plus 50 noise re-runs, about $4.

```
DATABASE_URL=…/rag_ats_seed npm run eval -- --dry-run --label my-run            # plan and cost estimate, no LLM calls
DATABASE_URL=…/rag_ats_seed npm run eval -- --part scoring --label my-run --limit 10 --max-usd 1   # smoke
DATABASE_URL=…/rag_ats_seed npm run eval -- --label my-run                      # everything (resumes, cap $6)
npm run eval -- --label my-run --report-only                                    # rebuild the report, no DB
npm run eval -- --label my-run --write-review --sample 40                       # citations to label by hand
npm run eval -- --summarise-review docs/eval/baseline/my-run/review-rag.md      # count the labels
```

Each run writes `docs/eval/baseline/<label>.{json,md}` and caches every score in `docs/eval/baseline/<label>/scores.jsonl`, so a re-run with the same label only scores what is missing (`--retry-failed` also re-scores failures). `npm run eval -- --help` lists every flag. The baseline run and its write-up: `docs/eval/eval-baseline.md`.

## Using the app

1. Register an account at `http://localhost:5173` and log in.
2. Create a vacancy.
3. Copy its public apply link from the vacancies list.
4. Open that link logged out (or in a private window) to submit an application with a PDF CV. The candidate's profile is filled in from the CV (and their public GitHub repos, if a GitHub URL was given) in the background; a Pending/Parsing chip shows progress, and a failed parse can be retried from the candidate page.
5. Open the vacancy to move applicants across pipeline stages on the drag-and-drop board. Each card shows the applicant's fit score once their CV is parsed, and columns are ranked by it; click the score to see the per-criterion breakdown with the cited CV or GitHub text, or to rescore. Editing an open vacancy's title or requirements re-scores all of its applicants (a closed vacancy's scores are marked outdated until you reopen it). On an open vacancy, "Find matches" lists pool candidates who fit it, with the criteria they match and the passages that matched; "Add" puts one on the board and scores them.
6. Browse the shared candidate pool at `/candidates`, or type what you need ("backend engineer with Kafka and Kubernetes") and press Enter for a semantic search that ranks candidates and shows the CV or GitHub passages that matched. A candidate's page lists their applications on your vacancies; use "Add to vacancy" to put them on another open vacancy, where they are scored like an applicant.
