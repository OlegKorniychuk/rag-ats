# General Plan: Stage 2 — CV parsing, grounded rating, RAG

## Context

Stage 1 (auth, vacancy CRUD, public apply, pipeline board, shared pool — API + web) is done (`docs/sdd.md`). Currently, the apply form makes applicants type skills, experience, projects and summary by hand. No LLM, no embeddings, no scoring, no eval. Stage 2 delivers the thesis part of `SPEC.md`:

- applicants upload a PDF CV, which is parsed into a structured profile;
- every application gets a grounded fit score per requirement, with verified citations;
- semantic search over the candidate pool and pool→vacancy matching;
- synthetic seed data plus an eval harness for the defense.

This is a **high-level roadmap**. Each step gets its own subplan (`/agent-skills:planning-and-task-breakdown`) before execution. Every step is one PR covering API and UI end to end. The exceptions are steps 10–11, which are scripts only.

## Decisions (from interview)

- **LLM:** OpenAI `gpt-5.4-mini`, using structured outputs (JSON schema). All calls go through `apps/api/src/llm/`, so the provider can be swapped. Embeddings use OpenAI `text-embedding-3-small` (1536-dim). SPEC.md gets updated in step 1, because it still says `gpt-4o-mini` and Xenova.
- **Async processing:** a **pg-boss** job queue on the existing Postgres (no Redis), with workers running in-process in the API. Planned queues are `parse-candidate` and `score-application`, plus `embed-candidate` in the RAG step.
- **Apply form:** collects name, email (the dedupe key), a PDF CV, optional GitHub URL and optional portfolio URL. The manual skills/experience/projects/summary fields are removed. The request becomes `multipart/form-data`. Contract changes start in `packages/shared/src/api.ts`.
- **PDF storage:** stored as Postgres `bytea` in a `cv_documents` table, along with the extracted text (`pdf-parse`) and metadata. There is a size cap of about 5MB and the type must be PDF.
- **Every candidate always has a CV.** Step 1's migration wipes the Stage 1 applicant data (candidates and applications); recruiters and vacancies are kept.
- **Repeat candidate:** every CV is kept (versioned). The profile is always the parse of the **latest** CV. Stage 1 merge rules (`apply/merge-candidate-profile.ts`) are retired for profile fields. Name: the latest submission wins. Links: kept unless a new value is provided.
- **GitHub enrichment:** uses the GitHub REST API for public repos (name, description, languages, stars, top READMEs, trimmed), which are fed to the parser. An optional `GITHUB_TOKEN` env var raises the rate limit. Portfolio URLs are stored only, never fetched.
- **Scoring is triggered by creating an application, not by parsing.** Applications come from two paths: public apply, and the recruiter adding a pool candidate to their vacancy. Both share one scoring flow. If the candidate is not parsed yet, the score waits: when the parse completes, it enqueues the pending scores.
- **Score shape:**
  - the vacancy requirements are split into criteria, each with a score and one or more verbatim quotes from CV or GitHub text;
  - the overall score is 0–100, with a short rationale;
  - the **server verifies that every quote is a substring of the source text** (after whitespace normalization) and retries or marks the score failed otherwise, so no ungrounded scores are stored;
  - each score records which CV document, mode and model it used.
- **Rescore:** editing a vacancy's title or requirements automatically rescores all of its applicants. Old scores are shown as stale until the new ones finish.
- **Rating before RAG:** rating first puts the full CV and GitHub text in the prompt. The RAG step adds chunking and embeddings, then a RAG scoring mode that retrieves the top-k chunks per criterion. `SCORING_MODE=full_text|rag` keeps both modes for the eval ablation.
- **RAG scope:** natural-language semantic search over the pool, which replaces the client-side filter on `/candidates` and shows matched snippets. Also "Find matches" for a vacancy: suggested pool candidates, each with one-click add to the vacancy.
- **UI status:** TanStack Query `refetchInterval` while any parse or score is pending, stopping once everything has settled.
- **Recruiter UX:** view or download the original PDF, and a retry button on failed parses or scores. Quote highlighting inside the CV text is not in scope; quotes are shown in the score breakdown only.
- **Apply abuse cap:** skipped for now (it stays in sdd §11 as a known limitation).
- **Tests:** OpenAI and GitHub HTTP are mocked with **MSW** in unit, integration and e2e tests. Postgres plus pg-boss run on testcontainers. No live API calls run in Jest or Vitest. The web keeps Vitest + RTL + MSW.

## Data model sketch (refined per subplan)

- `cv_documents`: id, candidate_id, filename, size, bytes (bytea), text, created_at
- `candidates` (new columns): `parse_status` (pending|parsing|parsed|failed), `parse_error`, `current_cv_document_id`, GitHub snapshot (jsonb). The profile fields now come from the LLM.
- `application_scores` (or columns on `applications`): status (pending|scoring|scored|failed|stale), overall, rationale, criteria jsonb `[{criterion, score, quotes:[{text, source}]}]`, cv_document_id, mode, model, scored_at
- `candidate_chunks` (RAG): id, candidate_id, cv_document_id, source (cv|github), text, `embedding vector(1536)`. The Docker and testcontainers images switch to `pgvector/pgvector:pg17`.

## Steps (each = one PR, own subplan)

### Part A — CV parsing

**Step 1 — PDF CV upload, storage, recruiter download.**

- Contract: `SubmitApplicationRequest` becomes multipart (name, email, cv, githubUrl?, portfolioUrl?).
- API: multer upload with type and size validation; `cv_documents` table; text extraction; `GET /candidates/:id/cv`, which streams the latest PDF.
- Web: the apply form gets a file input and drops the manual fields; the candidate page gets a "View CV" link.
- SPEC.md: model and embedding decisions.

Profile fields temporarily stay empty or come from the previous profile.
**Done when:** an applicant uploads a PDF, and a recruiter can open that PDF from the candidate page. Bad type or size → 400 is shown inline.

**Step 2 — Async LLM parsing into profile.**

- `llm/` module: OpenAI client, structured-output parse prompt, `EnvConfig` additions (`OPENAI_API_KEY`, `OPENAI_MODEL`).
- `jobs/` module (pg-boss).
- The `parse-candidate` job runs on apply and fills the profile plus `parse_status`.
- `POST /candidates/:id/reparse` for retries.
- Web: parse-status chip on the pool, pipeline cards and candidate page; polling; retry button on failure.

**Done when:** a submitted CV becomes a parsed profile without manual steps. A failure is visible and retryable. MSW-mocked e2e covers the full flow.

**Step 3 — GitHub enrichment.**

- `github/` client (REST, MSW-mocked in tests). Repo data is fetched before parsing and fed to the prompt. The snapshot is stored.
- Web: the candidate page shows a GitHub section (top repos, languages).
- A fetch failure degrades to a CV-only parse, not a failed parse.

**Done when:** a candidate with a GitHub URL has repo-derived skills and projects, and GitHub data is visible in the UI.

### Checkpoint A

Parse 5–10 hand-made PDFs live (budget check: log tokens and cost). Profile quality is acceptable, and the review happens before scoring starts.

### Part B — Applicant rating

**Step 4 — Grounded scoring on application.**

- The `score-application` job is enqueued on apply. It waits for the parse, uses the full-text prompt, and produces the per-criterion breakdown. Quotes are verified against the source text.
- Scores are included in `GET /vacancies/:id/applications`.
- `POST /applications/:id/rescore` for retries.
- Web: score badge on pipeline cards; columns and the list are sorted by score; the score detail drawer shows criteria, scores, cited quotes (marked CV or GitHub) and the rationale; pending, failed and retry states are shown.

**Done when:** every new application ends up with a score whose quotes all exist verbatim in the source. Applicants are ranked by score in the UI.

**Step 5 — Recruiter adds pool candidate to vacancy.**

- API: `POST /vacancies/:id/applications { candidateId }`, owner-scoped, 409 on a duplicate. It reuses the step 4 scoring flow.
- Web: an "Add to vacancy" action on the candidate page (picker of my open vacancies).

**Done when:** an added candidate appears on that vacancy's board and gets scored.

**Step 6 — Auto-rescore on vacancy change.**

- API: when a `PATCH /vacancies/:id` changes the title or requirements, all of its scores are marked stale and rescore jobs are enqueued.
- Web: a stale indicator is shown while rescoring, and the edit dialog notes that applicants will be re-rated.

**Done when:** editing requirements updates every applicant's score, and the UI reflects the transition.

### Checkpoint B

Live scoring on a small set. Manually inspect the citations. This covers SPEC's "100% of scores cite a snippet" criterion.

### Part C — RAG

**Step 7 — Embeddings plus semantic pool search.**

- pgvector image and migration; `candidate_chunks`.
- Chunking of CV and GitHub text; `embed-candidate` job after parse; backfill command for existing candidates.
- `POST /candidates/search { query }`: embeds the query, runs cosine top-k over chunks, aggregates per candidate, and returns matched snippets.
- Web: a search box on `/candidates` replaces the client-side filter and shows ranked results with snippets.

**Done when:** an NL query returns relevant candidates with the snippets that matched.

**Step 8 — Find matches for a vacancy.**

- API: `GET /vacancies/:id/matches`, which retrieves using the vacancy requirements, excludes existing applicants and returns candidates plus snippets.
- Web: a "Find matches" panel on the vacancy page, with one-click add (reuses step 5, which then triggers scoring).

**Done when:** a recruiter surfaces pool candidates for a vacancy and adds them to the pipeline.

**Step 9 — RAG scoring mode.**

- Per criterion, retrieve the top-k chunks of the candidate and score from those only. Quote verification works against the retrieved chunks.
- `SCORING_MODE` env switch; the mode is stored on the score.
- Web: the score drawer shows the mode and the retrieved chunks.

**Done when:** both modes produce verified scores, and switching the env changes new scores.

### Checkpoint C

Full flow works: apply → parse → embed → score, plus search and matches, all through the UI.

### Part D — Data & eval

**Step 10 — Synthetic data plus seed.**

- A generator script (LLM) produces about 100 dev CVs, rendered to PDF, plus GitHub-style profiles, 10 vacancies and ground-truth fit labels and relevance sets. They are written to `data/synthetic/` and committed.
- `npm run db:seed` loads them through the real apply pipeline, with a budget guard (dry-run cost estimate and a cap).

**Done when:** a seeded DB shows 100 parsed and scored candidates in the UI, with ≥90% parse success (SPEC criterion).

**Step 11 — Eval harness plus docs.**

- `npm run eval`: retrieval precision/recall@k for search and matches; score agreement (Spearman, MAE) against ground truth, for full_text vs rag.
- The report goes to `docs/eval/`.
- `docs/sdd.md` gets the Stage 2 as-built section, and README is updated.

**Done when:** the report has been produced and the docs reflect Stage 2.

## Risks

| Risk                                                     | Impact | Mitigation                                                                                                        |
| -------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| LLM quotes not verbatim → ungrounded scores              | High   | Server-side substring check after whitespace normalization; one retry with feedback; else `failed` + retry button |
| `gpt-5.4-mini` pricing unknown vs the $20 cap            | Med    | Log token usage per call from step 2; cost estimate before seed and eval; cap on job concurrency                  |
| pg-boss jobs in e2e make tests flaky or slow             | Med    | Await job completion via a polling helper; small poll interval in the test config                                 |
| Multipart upload breaks existing apply e2e and web tests | Med    | Step 1 rewrites the apply tests deliberately; contract change goes first                                          |
| PDF text extraction is poor on templated or 2-column CVs | Med    | Checkpoint A uses varied templates; the synthetic generator uses a few layouts                                    |
| GitHub rate limit (60/h unauthenticated)                 | Low    | Optional `GITHUB_TOKEN`; degrade to CV-only                                                                       |
| Score/CV drift when a candidate uploads a newer CV       | Low    | The score stores `cv_document_id`; see open question                                                              |

## Open questions (resolve in subplans)

- Step 4: when a candidate submits a newer CV, should their _other_ applications' scores be marked stale and rescored? The proposed default is yes, rescoring against the latest CV.
- Step 7: chunking strategy (per CV section vs. fixed-size token windows) and k values.
- Step 10: how ground-truth labels are produced (LLM-generated with manual spot-check vs. fully self-labeled).

## Execution

For each step: subplan → approval → Sonnet subagents execute → I review, re-run tests, verify in the browser → ask for commit approval → push → PR (no test plan, no attribution) → CI.
