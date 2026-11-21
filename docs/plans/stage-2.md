# General Plan: Stage 2 — CV parsing, grounded rating, RAG

## Context

**Status (2026-11-21): all steps and checkpoints are done**; each step below ends with its outcome, and `docs/sdd.md` describes the system as built. Sections written before a step was built (Context, Decisions, the data model sketch) are kept as planned; where the build differed, the step's Done line or `docs/sdd.md` says so.

Stage 1 (auth, vacancy CRUD, public apply, pipeline board, shared pool — API + web) was done (`docs/sdd.md`). Before Stage 2 the apply form made applicants type skills, experience, projects and summary by hand, with no LLM, embeddings, scoring or eval. Stage 2 delivers the thesis part of `SPEC.md`:

- applicants upload a PDF CV, which is parsed into a structured profile;
- every application gets a grounded fit score per requirement, with verified citations;
- semantic search over the candidate pool and pool→vacancy matching;
- synthetic seed data plus an eval harness for the defense.

This is a **high-level roadmap**. Each step gets its own subplan (`/agent-skills:planning-and-task-breakdown`) before execution. Every step is one PR covering API and UI end to end. The exceptions are steps 10–11, which are mostly scripts (with small API hooks: the fixture GitHub client, `searchWithHits`, `retrieveCriterionEvidence`); step 12 changes the scorer, so it is API only.

## Decisions (from interview)

- **LLM:** OpenAI `gpt-5.4-mini`, using structured outputs (JSON schema). All calls go through `apps/api/src/llm/`, so the provider can be swapped. Embeddings use OpenAI `text-embedding-3-small` (1536-dim). SPEC.md gets updated in step 1, because it still says `gpt-4o-mini` and Xenova.
- **Async processing:** a **pg-boss** job queue on the existing Postgres (no Redis), with workers running in-process in the API. Planned queues are `parse-candidate` and `score-application`, plus `embed-candidate` in the RAG step.
- **Apply form:** collects name, email (the dedupe key), a PDF CV, optional GitHub URL and optional portfolio URL. The manual skills/experience/projects/summary fields are removed. The request becomes `multipart/form-data`. Contract changes start in `packages/shared/src/api.ts`.
- **PDF storage:** stored as Postgres `bytea` in a `cv_documents` table, along with the extracted text (`pdf-parse`) and metadata. There is a size cap of about 5MB and the type must be PDF.
- **Every candidate always has a CV.** Stage 1 applicant data (candidates and applications) was wiped manually on the dev DB before step 1; recruiters and vacancies are kept. The step 1 migration itself doesn't delete data.
- **Repeat candidate:** every CV is kept (versioned). The profile is always the parse of the **latest** CV. Stage 1 merge rules (`apply/merge-candidate-profile.ts`) are retired for profile fields. Name: the latest submission wins. Links: kept unless a new value is provided.
- **GitHub enrichment:** uses the GitHub REST API for public repos (name, description, languages, stars, top READMEs, trimmed), which are fed to the parser. An optional `GITHUB_TOKEN` env var raises the rate limit. Portfolio URLs are stored only, never fetched.
- **Scoring is triggered by creating an application, not by parsing.** Applications come from two paths: public apply, and the recruiter adding a pool candidate to their vacancy. Both share one scoring flow. If the candidate is not parsed yet, the score waits: when the parse completes, it enqueues the pending scores.
- **Score shape:**
  - the vacancy requirements are split into criteria, each with a score and one or more verbatim quotes from CV or GitHub text;
  - the overall score is 0–100, with a short rationale;
  - the **server verifies that every quote is a substring of the source text** (after whitespace normalization) and retries or marks the score failed otherwise, so no ungrounded scores are stored (superseded by step 12: the model cites evidence-unit IDs and the server resolves them to the source text);
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

**Done**: plan `stage-2-step-1.md`.

**Step 2 — Async LLM parsing into profile.**

- `llm/` module: OpenAI client, structured-output parse prompt, `EnvConfig` additions (`OPENAI_API_KEY`, `OPENAI_MODEL`).
- `jobs/` module (pg-boss).
- The `parse-candidate` job runs on apply and fills the profile plus `parse_status`.
- `POST /candidates/:id/reparse` for retries.
- Web: parse-status chip on the pool, pipeline cards and candidate page; polling; retry button on failure.

**Done when:** a submitted CV becomes a parsed profile without manual steps. A failure is visible and retryable. MSW-mocked e2e covers the full flow.

**Done**: plan `stage-2-step-2.md`.

**Step 3 — GitHub enrichment.**

- `github/` client (REST, MSW-mocked in tests). Repo data is fetched before parsing and fed to the prompt. The snapshot is stored.
- Web: the candidate page shows a GitHub section (top repos, languages).
- A fetch failure degrades to a CV-only parse, not a failed parse.

**Done when:** a candidate with a GitHub URL has repo-derived skills and projects, and GitHub data is visible in the UI.

**Done**: plan `stage-2-step-3.md`.

### Checkpoint A

Parse 5–10 hand-made PDFs live (budget check: log tokens and cost). Profile quality is acceptable, and the review happens before scoring starts.

**Done**: 8 CVs × 2 runs, 222/222 checks after tuning (`docs/eval/checkpoint-a.md`).

### Part B — Applicant rating

**Step 4 — Grounded scoring on application.**

- The `score-application` job is enqueued on apply. It waits for the parse, uses the full-text prompt, and produces the per-criterion breakdown. Quotes are verified against the source text.
- Scores are included in `GET /vacancies/:id/applications`.
- `POST /applications/:id/rescore` for retries.
- Web: score badge on pipeline cards; columns and the list are sorted by score; the score detail drawer shows criteria, scores, cited quotes (marked CV or GitHub) and the rationale; pending, failed and retry states are shown.

**Done when:** every new application ends up with a score whose quotes all exist verbatim in the source. Applicants are ranked by score in the UI.

**Done**: plan `stage-2-step-4.md`. A newer CV resets the candidate's other scores to `pending` and rescores them against the latest CV.

**Step 5 — Recruiter adds pool candidate to vacancy.**

- API: `POST /vacancies/:id/applications { candidateId }`, owner-scoped, 409 on a duplicate. It reuses the step 4 scoring flow.
- Web: an "Add to vacancy" action on the candidate page (picker of my open vacancies).

**Done when:** an added candidate appears on that vacancy's board and gets scored.

**Done**: plan `stage-2-step-5.md`.

**Step 6 — Auto-rescore on vacancy change.**

- API: when a `PATCH /vacancies/:id` changes the title or requirements, all of its scores are marked stale and rescore jobs are enqueued.
- Web: a stale indicator is shown while rescoring, and the edit dialog notes that applicants will be re-rated.

**Done when:** editing requirements updates every applicant's score, and the UI reflects the transition.

**Done**: plan `stage-2-step-6.md`. A closed vacancy's scores are only marked outdated, and are rescored when it is reopened.

### Checkpoint B

Live scoring on a small set. Manually inspect the citations. This covers SPEC's "100% of scores cite a snippet" criterion.

**Done**: 64/64 scored pairs grounded, citation relevance 97.2% after tuning (`docs/eval/checkpoint-b.md`).

### Part C — RAG

**Step 7 — Embeddings plus semantic pool search.**

- pgvector image and migration; `candidate_chunks`.
- Chunking of CV and GitHub text; `embed-candidate` job after parse; existing candidates are backfilled by the startup sweep (no separate command).
- `POST /candidates/search { query }`: embeds the query, runs cosine top-k over chunks, aggregates per candidate, and returns matched snippets.
- Web: a search box on `/candidates` replaces the client-side filter and shows ranked results with snippets.

**Done when:** an NL query returns relevant candidates with the snippets that matched.

**Done**: plan `stage-2-step-7.md`.

**Step 8 — Find matches for a vacancy.**

- API: `GET /vacancies/:id/matches`, which retrieves using the vacancy requirements, excludes existing applicants and returns candidates plus snippets.
- Web: a "Find matches" panel on the vacancy page, with one-click add (reuses step 5, which then triggers scoring).

**Done when:** a recruiter surfaces pool candidates for a vacancy and adds them to the pipeline.

**Done**: plan `stage-2-step-8.md`. Two ranking modes (`criteria`, the default, and `whole_text`).

**Step 9 — RAG scoring mode.**

- Per criterion, retrieve the top-k chunks of the candidate and score from those only. Quote verification works against the retrieved chunks.
- `SCORING_MODE` env switch; the mode is stored on the score.
- Web: the score drawer shows the mode and the retrieved chunks.

**Done when:** both modes produce verified scores, and switching the env changes new scores.

**Done**: plan `stage-2-step-9.md`. Grounding is lenient: a criterion may cite any chunk retrieved for the application, since strict per-criterion grounding failed 19% of pairs (`docs/eval/rag-scoring.md`).

### Checkpoint C

Full flow works: apply → parse → embed → score, plus search and matches, all through the UI.

**Done**: 12/12 scenarios passed, 8 gaps logged and the code gaps fixed (`docs/eval/checkpoint-c.md`, `stage-2-checkpoint-c-fixes.md`).

### Part D — Data & eval

**Step 10 — Synthetic data plus seed.**

- A generator script produces about 100 dev CVs, rendered to PDF, plus GitHub-style profiles, 10 vacancies and ground-truth fit labels and relevance sets (built: personas are code-built specs, the LLM writes only the prose, and labels come from the specs by a fixed rule). They are written to `data/synthetic/` and committed.
- `npm run db:seed` loads them through the real apply pipeline, with a budget guard (dry-run cost estimate and a cap).

**Done when:** a seeded DB shows 100 parsed and scored candidates in the UI, with ≥90% parse success (SPEC criterion).

**Done**: plan `stage-2-step-10.md`. 100/100 CVs parsed, 230/232 applications scored after two `--retry-failed` runs (`docs/eval/synthetic-data.md`).

**Step 11 — Eval harness plus docs.**

- `npm run eval`: retrieval precision/recall@k for search and matches; score agreement (Spearman, MAE) against ground truth, for full_text vs rag; the grounding failure rate (first pass and after one retry) and cost per score. These are the baseline for step 12.
- The report goes to `docs/eval/`.
- `docs/sdd.md` gets the Stage 2 as-built section, and README is updated.

**Done when:** the report has been produced and the docs reflect Stage 2.

**Done (2026-11-21)**: plan `stage-2-step-11.md`; report `docs/eval/eval-baseline.md` (label `baseline-units`, 862 scores, 0 failed, $3.95). The full scoring run was made after step 12, on evidence-ID citations, so it is both this step's baseline and step 12's "after".

### Part E — Grounding by construction

**Step 12 — Cite evidence by ID instead of quoting.**

Today the scorer copies quotes and the server checks they are verbatim (generate, then verify). On the step 10 seed about 21% of first answers failed that check, 11 of 232 scores (4.7%) still failed after the in-job retry, and 2 after two `--retry-failed` runs. The causes were an added full stop on a GitHub README bullet, near-paraphrases ("Validated…" for "validating…"), words glued onto a real fragment, and a scored criterion with no quote (`docs/eval/synthetic-data.md`).

- The server splits the CV text and the GitHub snapshot into numbered evidence units (`S1…` for CV sentences or bullets, `G1…` for the sentences of GitHub bio, repo and README lines). These go into the prompt in place of the raw text, for both `full_text` and `rag` (for `rag`, inside the retrieved chunks).
- The scorer returns unit IDs per criterion, not quote text. The server resolves the IDs to the exact source text, so a citation is verbatim by construction. The only grounding failure left is an unknown ID, or a scored criterion with no ID.
- The stored citations keep their shape (quote text plus source), so the UI and the API contract are unchanged unless the subplan finds a reason to expose the unit IDs.
- Snap-to-source (on a failed quote, take the closest source span if it is nearly identical) is the fallback considered if ID citing proves unreliable. The subplan decides whether to build it as a comparison arm.
- Re-run the step 11 eval on the same seed set: grounding failure rate, score agreement (Spearman, MAE, band κ), citation relevance on a reviewed sample, and output tokens and cost per score, all compared against the step 11 baseline.

**Done when:** the grounding failure rate is 0% on the first pass (excluding API errors), score agreement does not drop below the baseline beyond run-to-run noise, and the comparison is written up in `docs/eval/`.

**Done (2026-11-21)**: plan `stage-2-step-12.md`. Step 12 landed before step 11's full run, so the "before" figures are the step 10 seed (about 21% of first answers failed, 4.7% after the retry) and the pre-fix smoke `smoke-quotes` (first pass 18% full_text, 64% rag), not a pre-fix full eval. After: 0.5% (full_text) and 1.9% (rag) of first answers needed the retry, 0% failed after it, no unknown ID in 862 scores; output tokens fell by 40–60% and cost per score from $0.0061 / $0.0105 to $0.0043 / $0.0048. The first-pass target was not quite met, and agreement has no pre-fix baseline to compare with; both are stated in `docs/eval/eval-baseline.md`. Snap-to-source was not built.

## Risks

| Risk                                                     | Impact | Mitigation                                                                                                                                                   |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM quotes not verbatim → ungrounded scores              | High   | Server-side substring check after whitespace normalization; one retry with feedback; else `failed` + retry button. Step 12 removed it by citing evidence IDs |
| `gpt-5.4-mini` pricing unknown vs the $20 cap            | Med    | Log token usage per call from step 2; cost estimate before seed and eval; cap on job concurrency                                                             |
| pg-boss jobs in e2e make tests flaky or slow             | Med    | Await job completion via a polling helper; small poll interval in the test config                                                                            |
| Multipart upload breaks existing apply e2e and web tests | Med    | Step 1 rewrites the apply tests deliberately; contract change goes first                                                                                     |
| PDF text extraction is poor on templated or 2-column CVs | Med    | Checkpoint A uses varied templates; the synthetic generator uses a few layouts                                                                               |
| GitHub rate limit (60/h unauthenticated)                 | Low    | Optional `GITHUB_TOKEN`; degrade to CV-only                                                                                                                  |
| Score/CV drift when a candidate uploads a newer CV       | Low    | The score stores `cv_document_id`; a newer CV rescores the candidate's other applications (step 4)                                                           |

## Open questions (resolve in subplans)

- ~~Step 4: when a candidate submits a newer CV, should their _other_ applications' scores be marked stale and rescored? The proposed default is yes, rescoring against the latest CV.~~ Resolved in `stage-2-step-4.md`: yes. A successful parse resets all of the candidate's scores to `pending` (keeping the old result, shown stale) and rescores them against the latest CV.
- ~~Step 7: chunking strategy (per CV section vs. fixed-size token windows) and k values.~~ Resolved in `stage-2-step-7.md`: CV text packed on line boundaries into ~1000-char windows with one-line overlap, one chunk per GitHub repo plus a profile chunk; search takes the 50 nearest chunks, returns up to 20 candidates × 3 snippets above a 0.3 similarity floor.
- ~~Step 10: how ground-truth labels are produced (LLM-generated with manual spot-check vs. fully self-labeled).~~ Resolved in `stage-2-step-10.md`: labels come from the persona specs by a fixed rule, with no LLM. Dude's blind spot-check of 30 pairs agreed with the rule at κ = 0.65 (quadratic κ 0.83).
- ~~Step 12: the unit size for evidence IDs (sentence vs. bullet vs. line) on PDF-extracted text, where line breaks fall inside sentences and 2-column layouts interleave; and whether the model may cite a sub-span of a unit.~~ Resolved in `stage-2-step-12.md`: bullet or sentence units, with PDF line wraps merged and short lines kept as their own units, and GitHub block lines never merged (each split into sentences); the model cites whole units, never sub-spans. Two-column interleave is a known limit (`docs/sdd.md` §12).

## Execution

For each step: subplan → approval → Sonnet subagents execute → I review, re-run tests, verify in the browser → ask for commit approval → push → PR (no test plan, no attribution) → CI.
