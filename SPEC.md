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
- Frontend: React + Vite; **MUI** (`@mui/material`) for components, **Zustand** for client state (auth/session state, UI-local state — server data fetched directly per-page, no separate cache layer in MVP scope)
- DB: PostgreSQL + pgvector extension — single datastore, via Docker Compose locally
- Data access: **Drizzle ORM** — native `vector` column type support, handles relational + vector queries in one layer (no raw-SQL workaround needed)
- LLM: OpenAI `gpt-4o-mini` — CV/GitHub parsing into structured profile, grounded fit scoring
- Embeddings: local, in-process via `@xenova/transformers` (e.g. `Xenova/all-MiniLM-L6-v2`) — no external API cost
- CV intake: PDF upload only (MVP), text extracted via `pdf-parse` before being handed to the LLM parser
- Public apply link: each vacancy gets a random unguessable token (e.g. `nanoid`) forming `/apply/:token` — no auth, but not enumerable
- Auth: `@nestjs/jwt` + `@nestjs/passport` + a cookie-reading `passport-jwt` strategy (`cookie-parser` middleware, JWT read from an httpOnly cookie — no Bearer header), `bcrypt` for password hashing. Single JWT, fixed ~7-day expiry, no refresh-token flow. Cookie set `httpOnly`, `sameSite: 'lax'`, `secure` in prod, matching the JWT's expiry; login sets it, logout clears it. `JwtAuthGuard` on all recruiter routes; `apply/` routes stay unguarded. `sameSite: 'lax'` is the CSRF mitigation (no separate CSRF token) — acceptable given no state-changing GETs and local-only deploy.
- Package manager: **npm** (workspaces: `apps/api`, `apps/web`, `packages/shared`)
- Testing: **Jest** (Nest default, unit + e2e via `@nestjs/testing` + Supertest) for backend; Vitest + React Testing Library for frontend
- Budget: **$20 OpenAI API ceiling**. Sanity check with `gpt-4o-mini` pricing: parsing 100 CVs (~150k in / 50k out tokens) ≈ $0.05; scoring 100×10=1,000 candidate–vacancy pairs (~1M in / 300k out tokens) ≈ $0.33. Full pass ≈ well under $1 — $20 comfortably covers many dev iterations + eval reruns.
- Synthetic data: **fully LLM-generated** — `gpt-4o-mini` prompted to produce the 100 synthetic CVs/GitHub-style profiles and 10 vacancy postings, plus the self-labeled ground-truth fit judgments. No external dataset, no licensing concerns.
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
Lint:            npm run lint --workspaces
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
│   │   │   ├── candidates/           → controller, service, module, dto/ (guarded, NOT owner-scoped — shared pool)
│   │   │   ├── vacancies/            → controller, service, module, dto/ (guarded + owner-scoped to req.user.id)
│   │   │   ├── applications/         → pipeline stage tracking (guarded, scoped via parent vacancy's owner)
│   │   │   ├── apply/                → PUBLIC unauthenticated module: GET vacancy by token, POST CV submission
│   │   │   ├── search/               → semantic search controller/service (guarded, NOT owner-scoped)
│   │   │   ├── llm/                  → OpenAI client wrapper (parse, score prompts)
│   │   │   ├── embeddings/           → local embedding service (@xenova/transformers)
│   │   │   ├── db/                   → drizzle schema, migrations, client
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/                     → e2e tests
│   │   └── scripts/                  → seed.ts, eval.ts
│   └── web/                          → React + Vite frontend
│       ├── src/
│       │   ├── pages/
│       │   │   ├── recruiter/        → vacancies, candidates, search, pipeline board
│       │   │   └── apply/[token]/    → PUBLIC applicant-facing page (vacancy details + CV upload form)
│       │   └── components/
│       └── tests/
├── packages/
│   └── shared/                        → shared TS types (Recruiter, Candidate, Vacancy, Application, ScoreResult, etc.)
├── data/
│   └── synthetic/                      → 100 synthetic candidates x 10 vacancies (no real PII)
├── docs/
│   ├── ideas/rag-tech-ats.md           → originating idea doc
│   └── eval/                            → eval reports (precision/recall, score-agreement results)
├── docker-compose.yml                    → postgres+pgvector service
└── SPEC.md                               → this file
```

## Code Style

Nest controller/service pattern — thin controller, thick service, DTO validation via `class-validator`:

```typescript
// apps/api/src/candidates/dto/search-candidates.dto.ts
export class SearchCandidatesDto {
  @IsString()
  @MinLength(1)
  query: string;
}

// apps/api/src/candidates/candidates.controller.ts
@Controller('candidates')
@UseGuards(JwtAuthGuard) // guarded, but NOT owner-scoped — shared candidate pool
export class CandidatesController {
  constructor(private readonly searchService: CandidateSearchService) {}

  @Post('search')
  async search(@Body() dto: SearchCandidatesDto) {
    return this.searchService.semanticSearch(dto.query);
  }
}

// apps/api/src/vacancies/vacancies.controller.ts
@Controller('vacancies')
@UseGuards(JwtAuthGuard)
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
- kebab-case filenames; PascalCase types/classes; camelCase functions/vars
- One Nest module per domain concept (candidates, vacancies, applications, search)

## Testing Strategy

- **Unit (Jest):** parsing/scoring/search service logic with mocked LLM + embedding calls — no live API calls in unit tests
- **E2E (Jest + Supertest, `@nestjs/testing`):** API endpoints against a test Postgres+pgvector instance (Docker), including: protected routes reject requests with no/invalid JWT cookie; a recruiter cannot see or modify another recruiter's vacancies/applications; any authenticated recruiter can see the full shared candidate pool; `apply/` routes work with no token at all
- **Frontend (Vitest + React Testing Library)**
- **Eval harness** (standalone script `apps/api/scripts/eval.ts`, not part of the Jest suite — produces the thesis's quantitative results): runs retrieval + scoring over the 100×10 synthetic ground-truth set, reports retrieval precision/recall and score-agreement (e.g. correlation/MAE) vs self-labeled human judgments
- No fixed coverage %, but every parsing/scoring/search service needs ≥1 test
- Mock LLM/embedding calls in automated tests to keep them free, fast, and CI-safe; live-API runs (seed, eval) are manual/separate to control the $20 budget

## Boundaries

- **Always do:** run `npm test --workspaces` before committing; validate all API input via DTOs; keep LLM calls isolated in `llm/` (swappable); never call live OpenAI API inside automated Jest/Vitest runs; cap submissions accepted per vacancy on the public `apply/` endpoint (basic abuse/cost guard, not production anti-bot) and reject files above a small size limit before they reach the LLM; hash passwords with `bcrypt`, never store or log plaintext passwords; enforce owner-scoping in the service layer (not just the controller) for vacancies/applications so a missed guard can't leak another recruiter's data
- **Ask first:** adding paid dependencies/services beyond OpenAI API; schema changes requiring data migration; using any real (non-synthetic) candidate data; any single script run likely to burn a large fraction of the $20 budget; exposing the app beyond localhost (the public apply link is only "public" within the local demo — don't deploy it to the open internet without revisiting the abuse-guard boundary above); adding RBAC/roles beyond the single flat recruiter role
- **Never do:** commit `.env`/API keys or the JWT signing secret; commit real PII; remove failing tests without discussion; call OpenAI API in an unbounded loop

## Success Criteria

- A recruiter can register, log in, and receive a JWT set as an httpOnly cookie; all recruiter-facing routes reject requests without a valid cookie
- Two recruiter accounts each see only their own vacancies/applications, but both can search and view the same shared candidate pool
- Vacancy CRUD + single pipeline (applied → screened → interview → rejected/hired) works end-to-end via UI
- Creating a vacancy auto-generates a working public apply link; an applicant can open it, view the role, and submit a CV without any account or login
- CV + GitHub/portfolio ingestion produces a standardized structured profile for ≥90% of the 100 synthetic candidates without manual fixup
- Semantic search returns relevant candidates for natural-language queries, measured via precision/recall against the self-labeled ground-truth set (100 candidates × 10 vacancies)
- 100% of fit scores include a cited snippet traceable to source CV/profile text — no un-grounded scores
- Quantitative eval report produced (retrieval precision/recall + score-agreement metric)
- Qualitative feedback collected from ≥2-3 informal reviewers on usefulness/trust
- Runs fully locally via Docker Compose — no cloud deploy required for defense
- Total OpenAI spend stays under $20

## Open Questions

None outstanding — ready for Phase 2 (Plan).
