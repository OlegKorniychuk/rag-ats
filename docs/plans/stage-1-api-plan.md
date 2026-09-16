# Implementation Plan: Stage 1 API (Main Functionality, No AI/RAG)

## Context

`SPEC.md` describes the full thesis MVP, which mixes plain CRUD/auth functionality with AI-dependent functionality (CV parsing, semantic search, fit scoring, eval). The build is split into two stages — Stage 1: main functionality (no AI), Stage 2: RAG/AI functionality — and this is the general, story-by-story plan for the **Stage 1 API only** (no frontend). Each step below implements exactly one SPEC.md user story (or, in one case, a tight pair of stories that share one endpoint/response), is covered by e2e tests (happy path + main exceptions per Jest+Supertest against a real Postgres instance, per SPEC.md's Testing Strategy), and leaves the system in a working, demoable state. Deep design for each step (DTOs, exact validation rules, file layout) is intentionally deferred to a per-story subplan — this document only sequences the work and pins the scope decisions made during planning.

## Stage-Split Decisions

These reinterpret/narrow the relevant SPEC.md stories for Stage 1; Stage 2 replaces or extends them later:

- **No CV parsing in Stage 1.** The applicant apply form collects a candidate's profile as structured fields directly (name, email, skills, experience, projects, summary, optional GitHub/portfolio links) instead of uploading a PDF. **No PDF upload at all in Stage 1** — that arrives in Stage 2 alongside parsing.
- **Candidates are a deduped shared pool.** A second application from the same email reuses the existing `Candidate` row (matched by email) and **appends** the new submission's data (e.g. union skills, append experience/project entries) rather than overwriting it. A new `Application` row links that candidate to the new vacancy.
- **"Ranked by fit score" → unranked list in Stage 1.** Stage 1 implements the full per-vacancy applicant listing (needed for pipeline management regardless); Stage 2 adds fit-score-based sorting on top.
- **"Search or view any candidate's profile" → list + view only, no filtering.** No keyword/semantic search in Stage 1 — natural-language semantic search is entirely Stage 2.
- **Closed vacancies:** the public apply page still resolves (`GET` works, so a candidate can see the role is closed), but submitting (`POST`) is rejected.
- **DB stays plain Postgres in Stage 1** — no pgvector extension, no embedding column. Stage 2 adds both via its own migration.
- **Submission abuse-cap deferred to Stage 2.** SPEC.md's "cap submissions per vacancy" guard exists to protect the paid LLM parsing step; since Stage 1 calls no paid API, this is out of scope until Stage 2 reintroduces the cost risk.
- Pipeline stage transitions are not restricted to a fixed order in Stage 1 (any valid enum value is accepted); this can be tightened later if needed.

## User Stories: In vs Out of Stage 1

**In Stage 1** (each maps to one step below):

- Recruiter — auth: register, log in, JWT httpOnly-cookie session
- Recruiter — create a vacancy + auto-generated public apply link
- Recruiter — update or close a vacancy
- Recruiter — see only vacancies/applications they created (vacancy half tested here; application half tested in the per-vacancy applicant listing step)
- Recruiter — search or view any candidate's standardized profile _(narrowed: list + view, no search)_
- Recruiter — see candidates applied to one of their vacancies _(narrowed: unranked)_
- Recruiter — move a candidate through pipeline stages
- Applicant — view a vacancy via its public link
- Applicant — submit application _(narrowed: structured form, no PDF)_ + get confirmation (same step — confirmation is just that endpoint's success response)

**Left out of Stage 1** (deferred to Stage 2 — RAG/AI):

- Recruiter — natural-language semantic candidate search
- Recruiter — fit score with cited source snippet
- Recruiter — candidates ranked by fit score (Stage 1 has the list; Stage 2 adds the ranking)
- Thesis author — eval script (precision/recall + score-agreement)
- CV PDF upload and parsing into a structured profile (Stage 1 gets the profile via form instead)

## Task List

### Phase 0: Foundation (not a user story) — Done

Detailed breakdown: `docs/plans/phase-0-plan.md`.

Minimal monorepo bootstrap: npm workspaces (`apps/api`, `packages/shared`), NestJS app skeleton, Postgres via Docker Compose (plain, no pgvector), **full Drizzle schema for all Stage 1 entities** (recruiters, vacancies, candidates, applications — tables/enums/relations only, no modules built on top yet) + migration tooling wired (`drizzle-kit generate`/`migrate`), a correctly-wired repository pattern (interfaces + Drizzle impls, `@nestjs-cls/transactional`) proven via a Testcontainers-backed integration test (not e2e/Supertest — no HTTP endpoints exist yet), and GitHub Actions CI (lint/format/build/test). No feature modules, no business logic — later steps add folders/dependencies as needed.

**Checkpoint:** app boots, empty DB migrates cleanly, the Testcontainers integration suite (including a rollback proof test) passes against a real ephemeral Postgres. Verified locally; CI-on-a-real-PR still pending (branch not pushed yet).

---

### Step 1 — Recruiter registration & login (JWT httpOnly cookie)

**Story:** Recruiter — auth (register + login; session uses a JWT in an httpOnly cookie)
**Delivers:** `POST /auth/register`, `POST /auth/login` (sets the cookie), `POST /auth/logout` (clears it), `GET /auth/me` (session check — necessary plumbing for a working cookie session, not a separate story), `JwtStrategy` (cookie extractor) + `JwtAuthGuard` + `@CurrentUser()`, password hashing via bcrypt.

Detailed breakdown: `docs/plans/step-1-auth-plan.md`.
**E2E:** register success; duplicate-email register rejected; login success + cookie set; wrong-password login rejected; a guarded route rejects requests with no cookie and with a tampered/invalid cookie.
**Depends on:** Phase 0.

### Step 2 — Create vacancy + auto-generated apply link

**Story:** Recruiter — create a vacancy / auto-generate a shareable public apply link (one endpoint, both stories)
**Delivers:** `POST /vacancies` (owner = current recruiter, generates a `nanoid` apply token).
**E2E:** happy path (response includes working apply link/token); unauthenticated rejected; validation errors (missing title/requirements).
**Depends on:** Step 1.

### Step 3 — Update / close a vacancy

**Story:** Recruiter — update or close a vacancy
**Delivers:** `PATCH /vacancies/:id` (field edits + status transition to `closed`), owner-scoped in the service layer.
**E2E:** happy path update; happy path close; non-owner gets 403/404; validation errors.
**Depends on:** Step 2.

### Step 4 — List/view my own vacancies

**Story:** Recruiter — see only the vacancies (and, by extension, applications) I created
**Delivers:** `GET /vacancies` (mine only), `GET /vacancies/:id` (mine, 404 otherwise).
**E2E:** listing returns only this recruiter's vacancies (seed two recruiters); get-by-id 404s for another recruiter's vacancy.
**Depends on:** Step 2.

### Step 5 — Public: view a vacancy by apply token

**Story:** Applicant — open a vacancy's public link and see role details
**Delivers:** `GET /apply/:token` (public, unguarded).
**E2E:** valid token → role details; unknown token → 404; closed vacancy still resolves (per closed-vacancy decision above).
**Depends on:** Step 2.

### Step 6 — Public: submit an application

**Stories:** Applicant — submit application (structured form) + get confirmation
**Delivers:** `POST /apply/:token` — validates the profile form, upserts the `Candidate` by email (append-merge on repeat), creates an `Application` (stage=`applied`), returns confirmation.
**E2E:** happy path (new candidate) → confirmation; happy path (existing email) → profile data appended, single candidate row, new application row; invalid/unknown token → 404; closed vacancy → rejected; validation errors on the form.
**Depends on:** Steps 1 (candidate/application reference recruiters transitively via vacancy), 5.

### Step 7 — List applicants for one of my vacancies

**Story:** Recruiter — see all candidates applied to one of my vacancies (unranked in Stage 1)
**Delivers:** `GET /vacancies/:id/applications` — owner-scoped, includes each application's pipeline stage.
**E2E:** happy path list; empty list; non-owner gets 403/404 (covers the "applications" half of Step 4's story).
**Depends on:** Steps 4, 6.

### Step 8 — Move an application through pipeline stages

**Story:** Recruiter — move a candidate through pipeline stages (applied → screened → interview → rejected/hired)
**Delivers:** `PATCH /applications/:id` (stage update), scoped via the parent vacancy's owner.
**E2E:** happy path transition; invalid stage value rejected; non-owner (application under another recruiter's vacancy) gets 403/404.
**Depends on:** Step 7.

### Step 9 — Shared candidate pool: list + view

**Story:** Recruiter — search or view any candidate's standardized profile (narrowed: list + view, no search)
**Delivers:** `GET /candidates` (all candidates, any recruiter), `GET /candidates/:id`.
**E2E:** happy path list includes candidates from other recruiters' vacancies too; view single profile; unauthenticated rejected; unknown id → 404.
**Depends on:** Step 6.

---

### Checkpoint: Auth + vacancy CRUD (after Steps 1–4)

- [ ] All e2e tests pass against the real test Postgres instance
- [ ] A recruiter can register, log in, create/update/close/list their own vacancies end-to-end
- [ ] Cross-recruiter isolation verified (recruiter B cannot see/edit recruiter A's vacancy)

### Checkpoint: Public apply flow (after Steps 5–6)

- [ ] An applicant can view a vacancy and submit without any account, end-to-end
- [ ] Dedup-by-email + append-merge behavior verified
- [ ] Closed-vacancy view-ok/submit-rejected behavior verified

### Checkpoint: Pipeline management (after Steps 7–8)

- [ ] Recruiter can list applicants for their vacancy and move them through stages end-to-end
- [ ] Owner-scoping enforced in the service layer (not just the controller), per SPEC.md's boundary

### Checkpoint: Stage 1 complete (after Step 9)

- [ ] Every in-scope user story above has passing e2e coverage (happy path + main exceptions)
- [ ] Full Stage 1 API is demoable end-to-end via HTTP calls alone (register → create vacancy → apply → list → move stage → browse candidate pool)
- [ ] Ready to start Stage 2 (pgvector migration, CV upload+parsing, semantic search, fit scoring, eval script)

## Open Notes for Subplans

- Exact DTO/validation shape for the applicant profile form (which fields required vs optional) — decide in Step 6's subplan.
- Exact append-merge semantics for repeat candidate submissions (e.g. skills union, how experience/summary text is combined) — decide in Step 6's subplan.
- Whether pipeline stage transitions should later be restricted to a valid sequence — left open, not enforced in Stage 1.
