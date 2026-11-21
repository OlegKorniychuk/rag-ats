# Spec: RAG-Powered ATS for Tech Recruiting (Thesis Project)

## Objective

Working prototype ATS scoped to tech/developer recruiting: vacancy CRUD with auto-generated public apply links, applicant self-service CV submission (no account) via those links, RAG-powered candidate parsing (CV + GitHub/portfolio → standardized profile), semantic search, and grounded/explainable AI fit scoring (score + cited source snippet). Talent-pool resurfacing is a stretch goal.

Success = defensible master's thesis prototype, backed by a quantitative eval (retrieval precision/recall + score agreement vs a self-labeled ground-truth set) plus qualitative feedback from a few informal reviewers.

Two personas: **recruiter** (registers/logs in via simple JWT auth; sees only the vacancies and applications _they_ created, but can search/view _any_ applicant's profile in the shared candidate pool) and **applicant** (no account at all — reaches a vacancy only via its public link and submits a CV there, fully unauthenticated). Multiple recruiters can register; no RBAC/admin tiers — a single flat "recruiter" role.

## User Stories (MVP)

**Recruiter — auth**

1. As a recruiter, I want to register an account (email + password) and log in, so I can access my dashboard.
2. As a recruiter, I want my session to use a JWT stored in an httpOnly cookie, so protected endpoints know who I am without me re-authenticating every request, and the token stays inaccessible to client-side JS.

**Recruiter — hiring workflow**

1. As a recruiter, I want to create a vacancy (title + requirements) so I can start tracking candidates for a role.
2. As a recruiter, I want vacancy creation to auto-generate a shareable public apply link, so I can send it to candidates without any manual setup.
3. As a recruiter, I want to update or close a vacancy so it reflects current hiring status.
4. As a recruiter, I want to see only the vacancies and applications _I_ created, so my dashboard isn't cluttered with other recruiters' hiring activity.
5. As a recruiter, I want to search or view _any_ candidate's standardized profile (skills, experience, projects) — not just ones who applied to my vacancies — so I can find good fits across the whole shared talent pool.
6. As a recruiter, I want to search candidates with a natural-language query (e.g. "senior backend dev, startup experience") so I find fits without manual filtering.
7. As a recruiter, I want each candidate's fit score for a vacancy to cite the CV/profile snippet that justifies it, so I can trust and verify the rating instead of taking a black-box number.
8. As a recruiter, I want to see all candidates applied to one of my vacancies, ranked by fit score, so I can prioritize review.
9. As a recruiter, I want to move a candidate through pipeline stages (applied → screened → interview → rejected/hired) so I can track where each application stands.

**Applicant**

1. As an applicant, I want to open a vacancy's public link and see the role details, so I know what I'm applying to before submitting anything.
2. As an applicant, I want to submit my CV (PDF) plus an optional GitHub/portfolio link, without creating an account, so applying is low-friction.
3. As an applicant, I want confirmation once my application is received, so I know the submission succeeded.

**Thesis author**

1. As the thesis author, I want to run an eval script against the self-labeled ground-truth set so I get precision/recall + score-agreement metrics for the defense.

Explicitly not in MVP stories: talent-pool resurfacing, skill-gap analysis, auto-generated interview questions, applicant accounts/login, multi-format CV upload (PDF only), anti-bot/CAPTCHA on the apply page, RBAC/admin roles, email verification/password reset/SSO — deferred per Not Doing / stretch scope.

## Tech Stack

- TypeScript everywhere (Node backend, React frontend) — single language across stack
- Backend: Node.js + **NestJS** — modules/controllers/services, DI, DTOs with `class-validator`
- Frontend: React + Vite; **MUI** (`@mui/material`) for components; **TanStack Query** for server data (fetching/caching/invalidation); **Zustand** for client-only state (auth session, UI-local state); **React Router** for routing; **React Hook Form + Zod** for forms; **dnd-kit** for the pipeline board
- DB: PostgreSQL + pgvector extension — single datastore, via Docker Compose locally
- Data access: **Drizzle ORM** — native `vector` column type support, handles relational + vector queries in one layer (no raw-SQL workaround needed)
- LLM: OpenAI `gpt-5.4-mini` with structured outputs (JSON schema) — CV/GitHub parsing into structured profile, grounded fit scoring; all calls isolated in `llm/` so the provider is swappable
- Embeddings: OpenAI `text-embedding-3-small` (1536-dim, stored in a pgvector `vector(1536)` column) (no local embedding model); cost is negligible against the budget
- Async processing: **pg-boss** job queue on the existing Postgres (no Redis), workers in-process in the API (CV parsing, scoring, embedding jobs)
- CV intake: PDF upload only (MVP), multipart `POST /apply/:token`, magic-byte PDF check and 5 MB cap; text extracted via `pdf-parse` v2 before being handed to the LLM parser. PDF bytes plus extracted text are stored in Postgres (`bytea`, `cv_documents` table; every CV upload is kept, the latest is current). The apply form is reduced to name, email, PDF CV and optional GitHub/portfolio URLs — applicants no longer type skills/experience/projects
- Public apply link: each vacancy gets a random unguessable token (e.g. `nanoid`) forming `/apply/:token` — no auth, but not enumerable
- Auth: `@nestjs/jwt` + `@nestjs/passport` + a cookie-reading `passport-jwt` strategy (`cookie-parser` middleware, JWT read from an httpOnly cookie — no Bearer header), `bcrypt` for password hashing. Single JWT, fixed ~7-day expiry, no refresh-token flow. Cookie set `httpOnly`, `sameSite: 'lax'`, `secure` in prod, matching the JWT's expiry; login sets it, logout clears it. `JwtAuthGuard` on all recruiter routes; `apply/` routes stay unguarded. `sameSite: 'lax'` is the CSRF mitigation (no separate CSRF token) — acceptable given no state-changing GETs and local-only deploy.
- Package manager: **npm** (workspaces: `apps/api`, `apps/web`, `packages/shared`)
- Testing: **Jest** (Nest default, unit + e2e via `@nestjs/testing` + Supertest) for backend; Vitest + React Testing Library for frontend
- Budget: **$20 OpenAI API ceiling**. Volume sanity check: parsing 100 CVs ≈ 150k in / 50k out tokens; scoring 100×10=1,000 candidate–vacancy pairs ≈ 1M in / 300k out tokens (a small `-mini` model keeps a full pass well under the ceiling; re-check against current `gpt-5.4-mini` and `text-embedding-3-small` rates before large runs, and log token usage in the first live parse runs).
- Synthetic data: **fully LLM-generated** — `gpt-5.4-mini` prompted to produce the 100 synthetic CVs/GitHub-style profiles and 10 vacancy postings, plus the self-labeled ground-truth fit judgments. No external dataset, no licensing concerns.
- Timeline: **~2 months remaining** — Phase 3 tasks must stay ruthlessly scoped to MVP success criteria; resurfacing and skill-gap analysis stay explicitly out of scope, not "if time allows."

## Commands

```
Install:        npm install
Dev (api):       npm run start:dev -w apps/api      # Nest CLI watch mode
Dev (web):       npm run dev -w apps/web             # Vite dev server
Build:           npm run build --workspaces
Test (api unit): npm run test -w apps/api            # Jest
Test (api e2e):  npm run test:e2e -w apps/api        # Jest + Supertest
Test (web):      npm run test -w apps/web            # Vitest
Lint:            npm run lint --workspaces --if-present
DB up:           docker compose up -d db              # postgres+pgvector container
DB schema gen:   npm run db:generate -w apps/api       # drizzle-kit generate
DB migrate:      npm run db:migrate -w apps/api        # drizzle-kit migrate
DB seed:         npm run db:seed -w apps/api            # loads 100 synthetic candidates x 10 vacancies
Eval:            npm run eval -w apps/api                # standalone script, produces thesis metrics report
```

## Project Structure

```
/
├── apps/
│   ├── api/                          → NestJS backend
│   │   ├── src/
│   │   │   ├── auth/                 → register/login controller, JwtStrategy, JwtAuthGuard
│   │   │   ├── candidates/           → controller, service, module, dto/, search/ (semantic search) (guarded, NOT owner-scoped — shared pool)
│   │   │   ├── vacancies/            → controller, service, module, dto/, matches/ (find matches) (guarded + owner-scoped to req.user.id)
│   │   │   ├── applications/         → pipeline stage tracking (guarded, scoped via parent vacancy's owner)
│   │   │   ├── apply/                → PUBLIC unauthenticated module: GET vacancy by token, POST CV submission
│   │   │   ├── cv/                   → PDF check + text extraction (pdf-parse)
│   │   │   ├── jobs/                 → pg-boss queue + workers
│   │   │   ├── llm/                  → OpenAI client wrapper (parse, criteria, score prompts; embeddings via text-embedding-3-small)
│   │   │   ├── github/               → GitHub REST client + profile fetcher (fixture client for the seed)
│   │   │   ├── rag/                  → chunking, per-criterion retrieval and ranking
│   │   │   ├── scoring/              → evidence units, citation resolving, overall score, criteria hash
│   │   │   ├── db/                   → drizzle schema, migrations, client
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/                     → e2e and integration tests (unit specs sit next to the code)
│   │   └── src/scripts/              → seed.ts, eval.ts, synth.ts, parse-eval.ts, score-eval.ts
│   └── web/                          → React + Vite frontend
│       ├── src/
│       │   ├── pages/                → one component per route (vacancies, pipeline, candidates + search, candidate, PUBLIC apply page, login/register)
│       │   ├── api/, auth/, candidates/, vacancies/, pipeline/, apply/, layout/ → feature folders
│       │   └── components/           → shared UI
│       └── (tests sit next to the code as *.test.ts(x); harness in src/test/)
├── packages/
│   └── shared/                        → shared API contract types (`api.ts`: *Request/*Response types, ScoreResult, etc.)
├── data/
│   ├── checkpoint-a/, checkpoint-b/    → small hand-made CV and vacancy sets for the parse and score evals
│   └── synthetic/                      → 100 synthetic candidates x 10 vacancies (no real PII)
├── docs/
│   ├── ideas/rag-tech-ats.md           → originating idea doc
│   ├── plans/                           → Stage 2 roadmap and per-step plans
│   ├── sdd.md                           → as-built software design document
│   └── eval/                            → eval reports (precision/recall, score-agreement results)
├── docker-compose.yml                    → postgres+pgvector service
└── SPEC.md                               → this file
```

## Code Style

Nest controller/service pattern — thin controller, thick service, DTO validation via `class-validator`:

```typescript
// apps/api/src/candidates/dto/search-candidates-request.dto.ts
export class SearchCandidatesRequestDto {
  @IsString()
  @MinLength(1)
  query: string;
}

// apps/api/src/candidates/candidates.controller.ts
// guarded by the global JwtAuthGuard (APP_GUARD); public routes opt out with @Public()
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly searchService: CandidateSearchService) {}

  @Post('search') // guarded, but NOT owner-scoped — shared candidate pool
  async search(@Body() dto: SearchCandidatesRequestDto) {
    return this.searchService.search(dto.query);
  }
}

// apps/api/src/vacancies/vacancies.controller.ts
@Controller('vacancies')
export class VacanciesController {
  constructor(private readonly vacanciesService: VacanciesService) {}

  @Get()
  async listMine(@CurrentUser() user: AuthUser) {
    return this.vacanciesService.findAllForRecruiter(user.id); // owner-scoped
  }
}
```

Conventions:

- Strict TypeScript (`strict: true`); no `any` without a comment justifying it
- DTOs + `class-validator`/`class-transformer` for request validation (Nest-idiomatic)
- Services hold business logic; controllers stay thin (validate → call service → respond)
- Async/await only, no raw `.then()` chains
- kebab-case filenames in `apps/api` and `packages/shared`; `apps/web` follows the React convention (PascalCase component files, camelCase modules); PascalCase types/classes; camelCase functions/vars
- One Nest module per domain concept (candidates, vacancies, applications, apply, auth, …); semantic search lives inside the candidates module

## Testing Strategy

- **Unit (Jest):** parsing/scoring/search service logic with mocked LLM + embedding calls — no live API calls in unit tests
- **E2E (Jest + Supertest, `@nestjs/testing`):** API endpoints against a test Postgres+pgvector instance (Docker), including: protected routes reject requests with no/invalid JWT cookie; a recruiter cannot see or modify another recruiter's vacancies/applications; any authenticated recruiter can see the full shared candidate pool; `apply/` routes work with no token at all
- **Frontend (Vitest + React Testing Library)**
- **Eval harness** (standalone script `apps/api/src/scripts/eval.ts` with its modules in `apps/api/src/scripts/eval/`, not part of the Jest suite — produces the thesis's quantitative results): runs retrieval over the whole synthetic set and scoring over a stratified sample of its 100×10 pairs, reports retrieval precision/recall and score agreement (correlation, MAE, κ) against the rule-based ground truth and the human spot-check labels
- No fixed coverage %, but every parsing/scoring/search service needs ≥1 test
- Mock LLM/embedding calls in automated tests to keep them free, fast, and CI-safe; live-API runs (seed, eval) are manual/separate to control the $20 budget

## Boundaries

- **Always do:** run `npm test` (api unit + web; `packages/shared` has no tests) before committing; validate all API input via DTOs; keep LLM calls isolated in `llm/` (swappable); never call live OpenAI API inside automated Jest/Vitest runs; cap submissions accepted per vacancy on the public `apply/` endpoint (basic abuse/cost guard, not production anti-bot) and reject files above a small size limit before they reach the LLM; hash passwords with `bcrypt`, never store or log plaintext passwords; enforce owner-scoping in the service layer (not just the controller) for vacancies/applications so a missed guard can't leak another recruiter's data
- **Ask first:** adding paid dependencies/services beyond OpenAI API; schema changes requiring data migration; using any real (non-synthetic) candidate data; any single script run likely to burn a large fraction of the $20 budget; exposing the app beyond localhost (the public apply link is only "public" within the local demo — don't deploy it to the open internet without revisiting the abuse-guard boundary above); adding RBAC/roles beyond the single flat recruiter role
- **Never do:** commit `.env`/API keys or the JWT signing secret; commit real PII; remove failing tests without discussion; call OpenAI API in an unbounded loop

## Success Criteria

- A recruiter can register, log in, and receive a JWT set as an httpOnly cookie; all recruiter-facing routes reject requests without a valid cookie
- Two recruiter accounts each see only their own vacancies/applications, but both can search and view the same shared candidate pool
- Vacancy CRUD + single pipeline (applied → screened → interview → rejected/hired) works end-to-end via UI
- Creating a vacancy auto-generates a working public apply link; an applicant can open it, view the role, and submit a CV without any account or login
- CV + GitHub/portfolio ingestion produces a standardized structured profile for ≥90% of the 100 synthetic candidates without manual fixup
- Semantic search returns relevant candidates for natural-language queries, measured via precision/recall against the self-labeled ground-truth set (100 candidates × 10 vacancies)
- Every criterion scored above 0 cites a snippet traceable to source CV/profile text — no un-grounded scores. A criterion scored 0 cites a unit only for a concrete contrary fact, so a score whose criteria are all 0 can carry no citation (19 of 862 in the eval)
- Quantitative eval report produced (retrieval precision/recall + score-agreement metric)
- Qualitative feedback collected from ≥2-3 informal reviewers on usefulness/trust
- Runs fully locally via Docker Compose — no cloud deploy required for defense
- Total OpenAI spend stays under $20

## As-built deviations

Where the built system differs from this spec (details in `docs/sdd.md`):

- **Synthetic data**: personas are built by code and the LLM writes only the CV and GitHub prose; ground-truth fit labels come from the persona specs by a fixed rule, checked by a blind human spot-check of 30 pairs (κ 0.65), not LLM-generated judgments.
- **Eval**: scoring runs on a stratified 381-pair sample (all strong and partial pairs, 150 random weak pairs, the spot-check pairs) with band weights, not all 1000 pairs.
- **Auth guard**: one global `JwtAuthGuard` with a `@Public()` opt-out instead of `@UseGuards` on each controller.
- **Modules**: no separate `search/` or `embeddings/` module; search is in `candidates/search/`, embeddings in `llm/`.
- **Grounding**: the scorer cites numbered evidence units by ID and the server resolves them to source text; a criterion scored 0 may cite nothing (see Success Criteria).
- **Conventions**: lint does not enforce the `any` rule (`no-explicit-any` is off); `any` appears only in test files. `ExtractVacancyCriteriaWorker` is tested only through the scoring integration tests.
- **Portfolio URLs** are stored and shown, never fetched.
- **Not done yet**: qualitative reviewer feedback (Success Criteria).

## Open Questions

None outstanding — ready for Phase 2 (Plan).
