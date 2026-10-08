# Stage 2 · Step 1 — PDF CV upload, storage, recruiter download

Parent roadmap: [`stage-2.md`](./stage-2.md), Part A, Step 1.

## Overview

Today, applicants type skills, experience, projects and summary by hand. After this step, the apply form takes **name, email, a PDF CV, and optional GitHub/portfolio URLs**. The API checks that the file really is a PDF, extracts its text, and stores both the PDF bytes and the text in a new `cv_documents` table. A recruiter can then open the candidate's latest CV from the candidate page.

There is no LLM in this step. New candidates have empty profile fields until step 2 adds parsing. Repeat candidates keep their existing profile fields.

**Invariant: every candidate always has at least one CV.** Stage 1 applicant data (candidates without a CV, and their applications) has to go. As built, it was wiped manually on the dev DB, and the migration doesn't delete anything (see `docs/sdd.md` §13). Recruiters and vacancies are kept.

## Architecture decisions

- **Contract first.** `packages/shared/src/api.ts` changes:
  - `SubmitApplicationRequest` becomes the _text fields_ of a multipart body: `{ name, email, githubUrl?, portfolioUrl? }`, with a doc comment saying the PDF goes in the `cv` file part.
  - New type `CvDocumentSummary { id, filename, sizeBytes, uploadedAt }`.
  - `CandidateResponse` gains `cv: CvDocumentSummary`, which is **non-null** because every candidate has a CV. `ApplicationWithCandidateResponse` picks this up automatically.
- **Schema.** New `cv_documents` table:
  - `id` (uuid pk), `candidate_id` (fk → candidates, not null), `filename`, `size_bytes`, `content` (Drizzle `bytea`), `text`, `created_at`.
  - It has a `cvDocuments` relation from `candidates`.
  - The "current CV" is the row with the newest `created_at`, so there's no pointer column.
  - **Data cleanup:** the plan was to hand-edit the migration to `DELETE FROM applications; DELETE FROM candidates;` before creating `cv_documents`. As built, the migration only creates the table, and the dev DB was cleared manually instead. Recruiters and vacancies stay.
- **How the invariant is enforced.**
  - Write side: `ApplyService.submit` is the only code path that creates candidates. It inserts the candidate and its `cv_documents` row in the same transaction, so a candidate without a CV can never be committed.
  - Read side: the repository maps `cvDocuments[0]` to `cv`. If no CV row exists it throws an invariant error, so the type stays non-null and the API fails loudly instead of returning `null`.
  - The database does not enforce it: a mutual NOT NULL foreign key would need a deferrable constraint, which isn't worth it here.
- **The `content` column is never loaded in list or profile queries.** Repository reads use explicit `columns` and fetch the latest CV _summary_ (`limit: 1`, ordered by `createdAt desc`). The bytes are only loaded by the download query.
- **Upload handling.**
  - Nest `FileInterceptor('cv')` with multer memory storage and `limits.fileSize = 5 MB`. Multer's limit error maps to **413**.
  - Validation in the controller or service:
    - missing file → 400
    - first bytes are not `%PDF-` → 400 (check the magic bytes, not the client-supplied mimetype)
  - Text fields are still validated through the `SubmitApplicationDto` class (multipart text fields arrive as strings, so the existing `@Transform`/`@IsEmail`/`@IsUrl` work unchanged).
  - Swagger gets `@ApiConsumes('multipart/form-data')` and an `@ApiBody` schema with `cv: binary`.
- **Text extraction.**
  - `pdf-parse` v2 (SPEC choice, ESM, current `latest`) wrapped in a `CvTextExtractor` service in a new `apps/api/src/cv/` module, so it can be swapped later.
  - Extraction runs **before** the transaction, because it is CPU work.
  - If the PDF is corrupt or has no extractable text (scanned or image-only) → **400** `"Could not read text from the CV PDF"`. A CV with no text cannot be parsed in step 2, so it is better to reject it at submit time while the applicant is still on the page.
  - Text is stored as extracted, apart from trimming. Step 2 decides on any normalisation.
- **Submit flow** (`ApplyService.submit`, still a single `@Transactional()`):
  1. Resolve the vacancy and check whether it is closed.
  2. Run the duplicate-application check.
  3. Create the candidate or update an existing one:
     - new candidate → empty `skills`/`projects`, `''` `experience`/`summary`;
     - existing candidate → only `name` is updated, plus `githubUrl`/`portfolioUrl` when provided. Profile fields are left as they are.
  4. Insert the `cv_documents` row and the application.

  `merge-candidate-profile.ts` and its spec are deleted. Under Stage 2 rules, the latest CV replaces the profile in step 2.

- **Download.** `GET /candidates/:id/cv` (cookie-auth, shared pool, so not owner-scoped):
  - streams the latest CV with `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<sanitised>"`, and `X-Content-Type-Options: nosniff`;
  - 404 when the candidate doesn't exist. "Has no CV" can't happen because of the invariant.

  The web opens it with a plain `<a href target="_blank">` to the API origin. The cookie is sent because `localhost:5173` → `localhost:3000` counts as same-site under `sameSite: 'lax'`.

- **Web.**
  - The apply form drops the chip and textarea fields and adds a file picker (MUI `Button component="label"` + hidden `<input type="file" accept="application/pdf">`, showing the chosen filename).
  - The Zod schema validates `File`, type `application/pdf` and size ≤ 5 MB on the client.
  - `submitApplication` builds `FormData`. `apiFetch` already passes non-JSON bodies through, and the browser sets the boundary.
  - API 400 and 413 messages show inline.
- **Size limit constant.** 5 MB is defined once in the API (`cv/cv.constants.ts`) and once in the web (`apply/schema.ts`). `@rag-ats/shared` stays types-only.

## Task list

Each task is executed by a Sonnet subagent. The main session reviews, re-runs tests and asks before committing. Branch: `feat/cv-upload`.

### Task 1: Contract, schema, migration, repository

**Description:**

- Update `api.ts` (as above).
- Add `cv_documents` and its relation in `schema.ts` and generate the migration.
- Add a `CvDocumentsRepository` (interface, Drizzle implementation, `Symbol` token, registered in `RepositoriesModule`) with `create`, plus `findLatestContentByCandidate` (returns filename and content).
- Candidate reads (`findAll`, `findById`, `findByEmail`) and the applications-with-candidate query return `cv` as the latest summary, without `content`. A missing CV throws an invariant error.
- Migration: generated by `drizzle-kit`, not edited (the data cleanup was done manually, see above).
- Existing repository integration specs and seeding helpers that create candidates must also insert a CV row.
- `contract.check.ts` passes.

**Acceptance criteria:**

- [ ] `npm run build` passes with the new contract types and the contract check.
- [ ] Candidate list and profile queries never select `content`. This is asserted in the repository integration test by checking the returned keys.
- [ ] Latest-CV selection returns the newest row when a candidate has several.
- [ ] `npm run db:migrate` applies cleanly on the (manually cleared) dev DB.

**Verification:**

- `npm run test:integration` (new `cv-documents.repository.integration-spec.ts`, updated candidates and applications specs)
- `npm run build`

**Dependencies:** none
**Files:** `packages/shared/src/api.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/*`, `apps/api/src/db/repositories/{cv-documents,drizzle-cv-documents,candidates,drizzle-candidates,drizzle-applications}.repository.ts`, `repositories.module.ts`, `contract.check.ts`, `candidates/dto/candidate-response.dto.ts` (+ new `cv-document-summary-response.dto.ts`)
**Scope:** M–L (mostly mechanical)

### Task 2: CV text extraction service

**Description:**

- New `apps/api/src/cv/` module with `CvTextExtractor.extract(buffer): Promise<string>`, using `pdf-parse` v2.
- `isPdf(buffer)` checks the magic bytes.
- A typed `UnreadableCvError` is thrown when the PDF is corrupt or has empty text.
- Small committed fixtures in `apps/api/test/fixtures/`: a text PDF, an image-only or empty-text PDF, and a non-PDF file.

**Acceptance criteria:**

- [ ] The text PDF returns its known text.
- [ ] Empty-text and corrupt PDFs throw `UnreadableCvError`.
- [ ] `isPdf` rejects a non-PDF file even when its extension or mimetype says PDF.

**Verification:** `npm run test -w apps/api` (`cv-text-extractor.spec.ts`)
**Dependencies:** none (can run in parallel with Task 1)
**Files:** `apps/api/src/cv/{cv.module,cv-text-extractor,cv.constants}.ts`, spec, fixtures, `apps/api/package.json`
**Scope:** S

### Task 3: Multipart apply submit

**Description:**

- `POST /apply/:token` switches to multipart: `FileInterceptor('cv')` with the 5 MB limit, a missing or non-PDF file → 400, and an unreadable PDF → 400.
- `SubmitApplicationDto` is reduced to name, email and links.
- `ApplyService.submit` implements the flow above.
- `merge-candidate-profile.*` is deleted.
- The Swagger multipart schema is added.
- `apply.e2e-spec.ts` is rewritten with supertest `.field()`/`.attach()`.

**Acceptance criteria:**

- [ ] A valid submit returns 201 and creates a candidate, a `cv_documents` row (with bytes and text) and an application. A repeat candidate on another vacancy adds a second CV, updates the name and keeps the profile.
- [ ] No file, non-PDF, unreadable PDF → 400. More than 5 MB → 413. Closed vacancy and duplicate → 409, with no CV row written (transaction and order preserved). Unknown token → 404.
- [ ] The Swagger e2e still passes, and `/docs` shows a file input for the apply route.

**Verification:** `npm run test:e2e` (apply + swagger specs), `npm test`
**Dependencies:** Tasks 1 and 2
**Files:** `apply/{apply.controller,apply.service,apply.module}.ts`, `apply/dto/submit-application.dto.ts`, `apps/api/test/apply.e2e-spec.ts`, deleted merge files
**Scope:** M

### Task 4: CV download endpoint

**Description:**

- `GET /candidates/:id/cv` in the candidates module returns the latest CV as an inline PDF, with a sanitised filename and the `nosniff` header.
- Swagger docs are added.
- The e2e tests are extended.

**Acceptance criteria:**

- [ ] 200 with `application/pdf` and the exact uploaded bytes. After a second upload it returns the newer CV.
- [ ] 401 without a cookie. 404 for an unknown candidate. 400 for a malformed uuid.
- [ ] Any authenticated recruiter can download any candidate's CV (shared pool).

**Verification:** `npm run test:e2e` (`candidates.e2e-spec.ts`)
**Dependencies:** Tasks 1 and 3 (Task 3 is needed to seed CVs through the real apply route)
**Files:** `candidates/{candidates.controller,candidates.service}.ts`, `apps/api/test/candidates.e2e-spec.ts`
**Scope:** S

### Checkpoint: API

- [ ] `npm run build`, `npm test`, `npm run test:integration` and `npm run test:e2e` are all green.
- [ ] Manual: upload a real CV through Swagger `/docs`, then open `/candidates/:id/cv` in the browser.

### Task 5: Web apply form with CV upload

**Description:**

- Rework `apply/schema.ts`: drop skills/experience/projects/summary, and add `cv: File` with type and ≤ 5 MB checks. The schema is typed against the new `SubmitApplicationRequest` plus `cv`.
- `ApplicationForm` gets the file picker and no longer uses `ChipInput`. `ChipInput` stays only if something else still uses it; otherwise it is deleted.
- `api/apply.ts` sends `FormData`.
- Error mapping: 413 → "CV must be 5 MB or smaller", and 400 → the server's message.
- Tests use RTL `user.upload` plus an MSW handler that asserts the `FormData` fields and file.

**Acceptance criteria:**

- [ ] Submitting with a PDF sends multipart with `name`, `email`, optional links and `cv`. The success screen is unchanged.
- [ ] Client-side errors for a missing file, a non-PDF and a file over 5 MB, without hitting the network.
- [ ] Server 400, 413 and 409 errors render inline. The closed-vacancy flow is unchanged.

**Verification:** `npm run test -w apps/web`, `npm run build -w apps/web`, `npm run lint -w apps/web`
**Dependencies:** Task 1 (contract)
**Files:** `apps/web/src/apply/{schema,ApplicationForm,ApplicationForm.test}.tsx?`, `apps/web/src/api/{apply,apply.test}.ts`, possibly `components/ChipInput*`
**Scope:** M

### Task 6: Web candidate page — View CV and empty profile states

**Description:**

- The candidate page gets a "View CV" button (`href={apiUrl('/candidates/:id/cv')}`, opens in a new tab). It is always shown, along with the filename and the upload date.
- Empty summary or experience show "Not available yet — profile will be filled from the CV". Skills and projects already have empty states.
- The pool table and pipeline cards tolerate empty `skills`.
- MSW fixtures and handlers are updated to include `cv`.

**Acceptance criteria:**

- [ ] "View CV" points at the API download URL with `target="_blank"` and `rel="noopener noreferrer"`. It shows the filename and the upload date.
- [ ] A candidate with empty profile fields renders the placeholders without crashing. Existing page tests still pass.

**Verification:** `npm run test -w apps/web`, `npm run build -w apps/web`
**Dependencies:** Task 1
**Files:** `apps/web/src/pages/CandidatePage{,.test}.tsx`, `apps/web/src/api/client.ts` (export a small `apiUrl()` helper), test fixtures
**Scope:** S–M

### Checkpoint: Browser

- [ ] Real browser: register → create vacancy → open the apply link → upload a PDF → check the recruiter pipeline card and candidate page → "View CV" opens the PDF.
- [ ] Re-apply with the same email to another vacancy with a different PDF → "View CV" shows the newer one.
- [ ] Bad file → inline error.
- [ ] After the migration, the pool and pipeline boards start empty and the vacancies are still there.

### Task 7: Docs

**Description:**

- `docs/sdd.md`: status line, data model (`cv_documents`), endpoints (multipart `POST /apply/:token` with 413, `GET /candidates/:id/cv`), design decisions (magic-byte check, never loading bytes in lists, retired merge rules, unreadable PDF → 400), the frontend section, and an updated §11 (no profile parsing yet).
- `SPEC.md` gets the Stage 2 stack changes: `gpt-5.4-mini`, OpenAI `text-embedding-3-small` instead of Xenova, pg-boss, PDF bytes in Postgres, and the reduced apply form.

**Acceptance criteria:**

- [ ] The SDD matches the code, including endpoint count, tables and error codes.
- [ ] SPEC contains no remaining `gpt-4o-mini` or Xenova references.

**Verification:** `npx prettier --check .`; read-through
**Dependencies:** Tasks 1–6
**Files:** `docs/sdd.md`, `SPEC.md`
**Scope:** S

### Checkpoint: Complete

- [ ] CI-equivalent run locally: lint, format check, build, unit, integration, e2e, web tests.
- [ ] Ask for commit approval → push → PR "Stage 2 step 1: PDF CV upload, storage and download" (no test plan, no attribution).

## Risks and mitigations

| Risk                                                                       | Impact | Mitigation                                                                                                                   |
| -------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `pdf-parse` v2 ESM/worker setup misbehaves under ts-jest ESM or Nest build | Med    | Task 2 proves it in isolation first; fallback is `unpdf` (also pdfjs-based, ESM) behind the same `CvTextExtractor` interface |
| Drizzle RC `bytea` maps to an unexpected JS type                           | Low    | Integration test round-trips bytes exactly; fallback is a `customType` over `Buffer`                                         |
| Loading CV bytes in list queries, which bloats responses and memory        | Med    | Explicit `columns` in reads, plus an integration test that asserts no `content` key                                          |
| Multer 413 vs 400 differences in Nest 10                                   | Low    | e2e tests pin the status codes; map explicitly in an exception filter if needed                                              |
| Cookie not sent on a new-tab PDF open                                      | Low    | Same-site under lax with top-level navigation; verified at the browser checkpoint                                            |
| Stage 1 dev data without CVs breaks candidate reads                        | Low    | Dev DB cleared manually before migrating; reseed by applying through the UI (synthetic seed comes in step 10)                |
| Breaking the Stage 1 apply tests and fixtures in many places               | Med    | Tasks 3 and 5 own the rewrites; the contract change lands first, so the compiler lists every call site                       |

## Out of scope (later steps)

- LLM parsing, `parse_status`, jobs (step 2)
- GitHub fetch (step 3)
- Linking an application to the specific CV it was submitted with (decided in step 4, with scoring)
- Submission caps
