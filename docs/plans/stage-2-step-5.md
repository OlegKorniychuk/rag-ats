# Stage 2 · Step 5 — Recruiter adds pool candidate to vacancy

Parent roadmap: `docs/plans/stage-2.md`, Part B, Step 5. Branch: `feat/add-pool-candidate` off `main`.

## Context

Step 4 scores every application, but the only way to get an application is the public apply form. The candidate pool is global (`GET /candidates` lists everyone), so a recruiter who finds a good candidate on the candidates page has no way to put them on another vacancy. SPEC's "reuse the talent pool" story needs that, and so does step 8 ("find matches"), which will add candidates through the same endpoint.

Step 5 adds:

- an owner-scoped endpoint that creates an application for an existing candidate, reusing the step 4 scoring flow;
- a `source` on applications, so self-applied and recruiter-added applicants can be told apart;
- a read endpoint listing a candidate's applications on the recruiter's own vacancies;
- on the candidate page, a "Vacancies" section and an "Add to vacancy" picker.

Dude's decisions (interview):

- **The candidate page gets a "Vacancies" section** backed by a new `GET /candidates/:id/applications`. The picker disables vacancies the candidate is already on, instead of relying on the 409.
- **Applications get a `source` column** (`applied` | `added`), shown as an "Added" chip on pipeline cards.

## Architecture decisions

### Contract first (`packages/shared/src/api.ts`)

- `ApplicationSource = 'applied' | 'added'`.
- `ApplicationResponse.source: ApplicationSource`. It flows into `ApplicationWithCandidateResponse` as well.
- `AddApplicationRequest { candidateId: string }` is the body of `POST /vacancies/:id/applications`.
- `POST /vacancies/:id/applications` returns `201` with `ApplicationWithCandidateResponse`. Errors:
  - `404` "Vacancy not found" when the vacancy is missing or belongs to someone else (same message as the other vacancy routes);
  - `404` "Candidate not found" for an unknown `candidateId`;
  - `409` "Vacancy is closed" (same rule as apply);
  - `409` "Candidate is already on this vacancy".
- `CandidateApplicationResponse { id, vacancyId, vacancyTitle, vacancyStatus, stage, source, createdAt, score: ApplicationScore }`.
- `GET /candidates/:id/applications` returns `CandidateApplicationResponse[]`, **only for the current recruiter's vacancies**, newest first. It returns `404` for an unknown candidate. Other recruiters' applications are never visible: the pool is shared, the pipelines are not.

### Schema (one generated, non-destructive migration)

- New enum `application_source` (`applied`, `added`).
- `applications.source` is `not null default 'applied'`. The default backfills existing rows, so no hand-written SQL is needed.
- The apply path sets `applied` explicitly. The add path sets `added`.

### API

- **`VacanciesService.addCandidate(recruiterId, vacancyId, candidateId)`**:
  1. A `@Transactional()` private method does the following.
     - It checks that the vacancy belongs to the recruiter and that the candidate exists.
     - It returns 409 if the vacancy is closed.
     - It looks up an existing (vacancy, candidate) application and returns 409 if there is one.
     - It creates the application with `source: 'added'` and a `pending` score row (`scoresRepository.createPending`), like apply.
     - It does **not** touch the candidate's parse status or CV, since no new CV comes in.
  2. After commit it calls `jobs.enqueueScore(applicationId)`. The failure handling is the same as apply's: log, don't fail the request, and the startup sweep recovers a `pending` score.
  3. It returns the row through `findByIdWithCandidate`, a new repository method that maps the score the same way the vacancy list does (`toApplicationScore`).
- **Scoring needs no new logic.** The step 4 worker handles each candidate state:
  - parsed: it scores straight away, extracting criteria lazily if needed;
  - `pending`/`parsing`: the score waits (`waitingForParse`) and the parse completion resets and enqueues all of the candidate's scores, the new one included;
  - `failed`: the score stays `waitingForParse` until a reparse succeeds. This is noted as a limitation, and the UI already says "Waiting for CV".
- **Duplicate race.** The check-then-insert can race (two clicks, or an apply and an add at once). A small helper `isUniqueViolation(error, 'applications_vacancy_id_candidate_id_unique')` in `common/` maps Postgres `23505` on that constraint to the same 409. Apply gets the same mapping, which also closes the existing race there.
- **`CandidatesService.findApplications(recruiterId, candidateId)`** returns 404 for an unknown candidate and otherwise calls `applicationsRepository.findByCandidateForRecruiter(candidateId, recruiterId)`. That method joins vacancies (filtering on `recruiter_id`) and scores, and maps them to `CandidateApplication`.
- Controllers: `POST /vacancies/:id/applications` goes in `VacanciesController` next to the existing `GET`, and `GET /candidates/:id/applications` goes in `CandidatesController`. Both get Swagger docs, use `ParseUUIDPipe`, and add `AddApplicationDto` (`@IsUUID()` `candidateId`). Response DTOs go into `contract.check.ts`.
- Both routes are covered by the global auth guard. Neither is `@Public()`.

### Web (`apps/web`)

- **API and queries**:
  - `addCandidateToVacancy(vacancyId, candidateId)` in `api/vacancies.ts`;
  - `listCandidateApplications(id)` in `api/candidates.ts`;
  - `candidateKeys.applications(id)` and `useCandidateApplications(id)`, which polls while any score is in flight (`hasScoreInFlight` is already generic over `{ score }[]`) or while the candidate is parsing;
  - `useAddCandidateToVacancy(candidateId)`, whose success handler invalidates the candidate's applications and that vacancy's applications.
- **`CandidateVacancies`** (`candidates/CandidateVacancies.tsx`) is a section on the candidate page, placed after the CV row. Each row shows:
  - the vacancy title, linking to `/vacancies/:id`;
  - a "Closed" chip for closed vacancies;
  - a stage chip and an "Added" chip when `source === 'added'`;
  - a `ScoreBadge`. Its `onClick` becomes optional so the badge renders as a plain chip here; the drawer stays on the pipeline.

  An empty list shows "Not on any of your vacancies yet". Loading and error states follow the page's existing pattern.

- **`AddToVacancyDialog`** (`candidates/AddToVacancyDialog.tsx`) opens from an "Add to vacancy" button in the page header.
  - It shows a single select of the recruiter's **open** vacancies (`useVacancies`, filtered). Vacancies the candidate is already on are disabled and labelled "Already added".
  - Submitting shows a pending state, then closes and shows a success snackbar with a link to that pipeline.
  - A 409 or 404 is shown inline in the dialog (`errorMessage`).
  - With no open vacancies the button stays enabled, and the dialog explains there is nothing to add to and links to `/vacancies`.
- **Pipeline card**: a small outlined "Added" chip when `source === 'added'`.
- Test fixtures get a default `source: 'applied'`.

### Tests

- **Integration (repositories)**:
  - `create` stores `source`, and existing rows default to `applied`;
  - `findByIdWithCandidate` maps the score;
  - `findByCandidateForRecruiter` returns only the recruiter's vacancies, newest first, with the score and the vacancy title and status.
- **Unit**: `isUniqueViolation` (matching code and constraint, other code, other constraint, a non-pg error).
- **E2E (`vacancies.e2e-spec.ts` and `candidates.e2e-spec.ts`)**:
  - add a parsed candidate: 201, `source: 'added'`, then the score reaches `scored` (MSW criteria and score handlers from step 4) and the application shows on `GET /vacancies/:id/applications`;
  - add a candidate whose parse is pending: the score is `waitingForParse`, and after the parse it is scored;
  - errors: duplicate 409, closed vacancy 409, foreign vacancy 404, unknown candidate 404, malformed `candidateId` 400, unauthenticated 401;
  - the apply path still returns `source: 'applied'`;
  - `GET /candidates/:id/applications`: own vacancies only (a second recruiter's application is hidden), unknown candidate 404, 401.
  - These go into the per-endpoint suites. No new full-journey spec.
- **Web (RTL + MSW)**:
  - `CandidateVacancies`: rows, chips, badge states, empty and error states;
  - `AddToVacancyDialog`: only open vacancies are listed, already-on ones are disabled, submit invalidates the right queries and the list shows the new row, an inline 409, and the no-open-vacancies state;
  - pipeline card "Added" chip;
  - polling on the candidate applications query stops once settled.

## Task list

Execution follows the usual pattern. Sonnet subagents do Tasks 1–4; the main session reviews, re-runs tests, does the live smoke and browser check, and writes the **docs inline** (Task 5). Task 3 can start after Task 1, in parallel with Task 2.

### Task 1: Contract, schema, repository (M)

- `api.ts` types, the migration (`application_source` enum plus column), `schema.ts`.
- Apply sets `source: 'applied'`.
- Repository: `findByIdWithCandidate`, `findByCandidateForRecruiter`, and `source` in the existing mappers.
- DTOs (`ApplicationResponseDto.source`, `CandidateApplicationResponseDto`, `AddApplicationDto`) plus `contract.check.ts`. Web fixtures get `source`.

**Acceptance**:

- the build and contract check pass;
- the repository integration cases listed above pass;
- the existing suites are green.

**Verify**: `npm run build`, `npm run test:integration`, `npm run test -w apps/web`.

### Task 2: Endpoints, race mapping, e2e (M, deps 1)

- `VacanciesService.addCandidate` with the controller route and Swagger.
- `CandidatesService.findApplications` with its route.
- `isUniqueViolation` plus its unit spec, used in both add and apply.
- The e2e cases listed above.

**Acceptance**: the e2e cases pass; the Swagger e2e suites still pass.

**Verify**: `npm run test -w apps/api`, `npm run test:e2e` twice, `npm run build`, `npm run lint`.

### Checkpoint: API (main)

- Everything is green.
- **Live smoke**:
  - reuse two step 4 smoke vacancies;
  - add one Checkpoint A candidate who applied to vacancy A to vacancy B;
  - check that the score lands with verified quotes and that `GET /candidates/:id/applications` shows both;
  - from a second recruiter account, check that the same candidate shows no applications.

### Task 3: Web, candidate vacancies section and pipeline chip (S–M, deps 1)

- API functions, `useCandidateApplications`, `CandidateVacancies`, the optional `ScoreBadge` `onClick`, the pipeline "Added" chip, and tests.

**Verify**: web tests ×2, build, lint.

### Task 4: Web, add-to-vacancy dialog (S–M, deps 3)

- `useAddCandidateToVacancy`, `AddToVacancyDialog`, the header button, the success snackbar, and tests.

**Verify**: web tests ×2, build, lint.

### Checkpoint: Browser (main)

- On the candidate page, the "Vacancies" section lists the smoke applications.
- "Add to vacancy" disables vacancies the candidate is already on. Adding to a new one shows the snackbar, the row appears and its badge goes from "Scoring…" to a score.
- The pipeline of that vacancy shows the card with the "Added" chip, ranked by score.
- Kill the servers by PID afterwards.

### Task 5: Docs (main session, inline)

- `docs/sdd.md`:
  - status, data model (`applications.source`);
  - the two endpoints and their contracts;
  - design decisions (pool shared but pipelines owner-scoped, scoring reuse, the unique-violation 409);
  - frontend (candidate page section and dialog, card chip);
  - testing;
  - limitations (a failed parse leaves added scores waiting).
- README feature line.

### Checkpoint: Complete

- CI-equivalent run locally.
- Ask for commit approval (plan / api / web / docs).
- Push, open the PR "Stage 2 step 5: add pool candidate to vacancy", watch CI.

## Risks

| Risk                                                                         | Impact | Mitigation                                                                                               |
| ---------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| `GET /candidates/:id/applications` leaks other recruiters' pipelines         | High   | Filter on `vacancies.recruiter_id` in the query, not in the service; an e2e case with a second recruiter |
| Double-click or a concurrent apply surfaces a 500 from the unique constraint | Med    | `isUniqueViolation` maps it to the same 409; the dialog disables submit while pending                    |
| Adding a non-`applied` default breaks fixtures and contract checks           | Low    | Contract first; fixtures get a default `source`; Task 1 runs every suite                                 |
| An added candidate with a failed parse shows "Waiting for CV" forever        | Low    | The existing reparse action fixes it; noted in limitations                                               |
| Cost: recruiters adding many pool candidates                                 | Low    | Same ≈ $0.003–0.005 per score as step 4; criteria are cached per vacancy                                 |

## Out of scope

- Removing an application from a vacancy.
- Bulk add or multi-select in the picker.
- Adding from the pipeline page (that is the step 8 "find matches" flow).
- Auto-rescore on vacancy edit (step 6).
- Notifying the candidate that they were added.
