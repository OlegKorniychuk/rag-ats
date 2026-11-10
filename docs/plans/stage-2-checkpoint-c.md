# Stage 2 · Checkpoint C — full flow through the UI

Parent roadmap: `docs/plans/stage-2.md`, Part C, Checkpoint C. Branch: `chore/checkpoint-c` off `main` (step 9 / PR #36 is merged; switch off the stale `feat/rag-scoring`).

## Context

Steps 7–9 added embeddings, semantic search, Find matches and RAG scoring. Each step was tested with MSW and smoke-checked in isolation. Nothing has yet run the **whole chain live through the UI**: apply → parse (+ GitHub) → embed → score, then search, matches → add → score, in both scoring modes. The roadmap marks Checkpoint C as done when that full flow works through the UI. Step 10 then seeds about 100 candidates through the same pipeline, so any bug in the chain should be found now, on 8 CVs, rather than then.

Dude's choices:

- **A separate fresh DB**, `rag_ats_checkpoint_c`. The dev DB is left untouched.
- **Claude drives the browser** through Claude in Chrome, records GIFs and checks the DB and API logs between scenarios. Dude reviews at the end.
- **Fix blockers, log the rest.** Anything that breaks the flow or shows wrong data is fixed in this PR. UX nits and design gaps go to sdd §12.

Outcome: `docs/plans/stage-2-checkpoint-c.md` (this plan), fixes for any blockers, `docs/eval/checkpoint-c.md` (scenario results, timings, cost, findings) and sdd updates.

## Setup (main session)

- **DB**: `docker compose exec db createdb -U rag_ats rag_ats_checkpoint_c`, then `DATABASE_URL=postgres://rag_ats:rag_ats@localhost:5432/rag_ats_checkpoint_c npm run db:migrate -w apps/api`.
  - Process env overrides `.env` for both drizzle (`dotenv/config` doesn't overwrite) and the app (`nest-typed-config` `dotenvLoader` merges `process.env` over the file), so `.env` is not edited.
  - The migration creates the `vector` extension itself, and `rag_ats` is the container superuser.
- **API**: the same `DATABASE_URL` override with `npm run dev:api`, run in the background. Its output is teed to `<scratchpad>/api.log`, which holds the token-usage lines and job errors. `SCORING_MODE` stays unset (`full_text`) until S8.
- **Web**: `npm run dev:web`, also in the background.
- **GitHub**: `GITHUB_TOKEN` is set (5000/h). Check the remaining limit before S2 without printing the token.
- **Fixtures**: 4 vacancies from `data/checkpoint-b/vacancies.json` (title + requirements pasted into the UI) and the 8 PDFs in `data/checkpoint-a/`. `05-mobile` and `08-injection` carry GitHub URLs from `manifest.json`.
- **Chrome**: load the core tools plus `file_upload`, `gif_creator`, `read_network_requests` and `read_console_messages` in one ToolSearch, then work in a new tab.

## Scenarios

Every scenario is checked in the UI (screenshot/read_page) and against the DB (read-only `psql` queries on statuses, chunks and score rows), plus `api.log` for job errors. A GIF is recorded for S2, S5, S6 and S8.

| #   | Scenario                      | Steps                                                                                                                                                                                                                         | Pass when                                                                                                                                                                                                     |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Recruiter + vacancies         | Register and log in; create the 4 vacancies; copy the apply links                                                                                                                                                             | 4 open vacancies, apply links work logged out                                                                                                                                                                 |
| S2  | Apply → parse → embed → score | Apply the 8 CVs through `/apply/:token`: each to its role-matched vacancy, 2 of them to a second vacancy, and 2 CVs left off `devops-platform`/`data-ml` so Find matches has pool candidates. Watch the pipeline and the pool | Chips go Pending → Parsing… → (hidden); badges go Waiting for CV → Scoring… → number; polling stops once settled (network tab); every candidate has chunks; GitHub section for 05/08; "View CV" opens the PDF |
| S3  | Apply validation              | Upload a non-PDF and a >5 MB file; reapply with the same email to the same vacancy                                                                                                                                            | Clear inline errors, no 500, no orphan rows                                                                                                                                                                   |
| S4  | Score drawer (full_text)      | Open the drawer on 4 applications                                                                                                                                                                                             | Criteria, quotes with CV/GitHub chips, "Full text" footer; 5 random quotes found in the CV text by hand                                                                                                       |
| S5  | Semantic search               | `/candidates`: "Kubernetes and Terraform", "React TypeScript frontend", "machine learning pipelines", "mobile apps", "Go backend"; then empty submit, Escape, and a query with no hits                                        | A plausible top result per query, snippets match the query, `?q=` behaves as documented; record the Go/Ukrainian known gap                                                                                    |
| S6  | Find matches → add            | On each vacancy open Find matches; add one suggested candidate                                                                                                                                                                | Existing applicants excluded; criteria chips plausible; card disappears, candidate appears on the board scoring → scored; the candidate page's Vacancies section lists it                                     |
| S7  | Vacancy edit → rescore        | Edit the requirements of an open vacancy; then close another, edit it, reopen it                                                                                                                                              | Info note in the dialog, banner and greyed scores while re-scoring, new numbers; closed: outdated warning, rescore on reopen                                                                                  |
| S8  | RAG mode                      | Restart the API with `SCORING_MODE=rag`; rescore 3 applications from the drawer; apply one new CV                                                                                                                             | Footer reads "RAG", "Evidence retrieved (N)" toggles show chunks with similarity; the new apply is scored in `rag`; overalls compared with full_text in the report                                            |
| S9  | Repeat applicant              | Reapply an existing candidate's email with a different CV to another vacancy                                                                                                                                                  | Profile replaced, chunks replaced (search reflects the new CV), the candidate's other scores re-pend and rescore against the new CV                                                                           |
| S10 | Failure + retry               | Restart the API with `OPENAI_API_KEY=invalid` (env override); apply one CV and rescore one application; restart normally; use **Retry parsing** and **Rescore**                                                               | "Failed" chip + alert with message; "Score failed" badge; both retries succeed; "Waiting for CV" resolves after the reparse                                                                                   |
| S11 | Restart recovery              | Kill the API while a parse or score is in flight; restart                                                                                                                                                                     | The startup sweep finishes the job; nothing stuck in `parsing`/`scoring`                                                                                                                                      |
| S12 | Pipeline drag                 | Drag a card between stages (mouse and keyboard)                                                                                                                                                                               | The stage persists after reload                                                                                                                                                                               |

**Measurements for the report**: the times apply → parsed → embedded → scored per candidate (DB timestamps plus `api.log`), the median and max; LLM calls, tokens and estimated cost from `api.log`; the count of retries and failures, by mode.

**Budget**: about 10 parses, about 30 scores (including rescores and RAG), 2–4 criteria extractions and cheap embeddings, roughly $0.30–0.60. Stop and ask if `api.log` shows a run-away job loop.

## Findings and fixes

- Each finding is logged as it happens: scenario, what was seen, expected, severity (**blocker** = flow breaks or shows wrong data; **gap** = UX/design issue) and evidence (a screenshot, log line or SQL).
- **Blockers**: reproduce, root-cause (debugging skill), and add a failing test first where the layer allows (unit, integration with testcontainers, or MSW). Then fix: a Sonnet subagent for non-trivial fixes, inline for one-liners. Re-run the affected scenario live.
- **Gaps**: one bullet each in sdd §12; no code.
- Contract changes, if any, start in `packages/shared/src/api.ts`.

## Docs (main session, inline)

- `docs/plans/stage-2-checkpoint-c.md`: this plan.
- `docs/eval/checkpoint-c.md`: setup, a scenario pass/fail table, timings, cost, full_text vs rag overalls on the rescored pairs, a findings table (fixed / logged), and the GIFs. GIFs go in `docs/eval/checkpoint-c/` only if each is ≤ 2 MB; otherwise they stay in the scratchpad and the report says so.
- `docs/sdd.md`: the §1 status line (Checkpoint C passed), a §11 Checkpoint C note, the §12 gaps, and the §13 dev note on running against a separate DB with an env override.

## Verification

- All 12 scenarios pass, or fail with a logged non-blocker finding.
- An end-state SQL check: no candidate in `pending`/`parsing`, no score in `pending`/`scoring`, `failed` only where S10 caused it and later fixed; every parsed candidate's `embedded_cv_document_id` equals its latest CV; every `scored` row has ≥ 1 quote.
- If code changed: `npm run test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`, `npm run lint`, then `npx prettier --check .` last.

## Finish

- Ask for commit approval. Proposed commits: plan doc / one per blocker fix / report and docs. Conventional, short, no attribution.
- Push, then open the PR "Stage 2 checkpoint C: full flow walkthrough" (no test plan), and watch CI.
- Leave `rag_ats_checkpoint_c` in place until the PR merges, then ask before dropping it.

## Risks

| Risk                                                           | Mitigation                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Chrome file upload or dnd automation is flaky                  | Fall back to `form_input`/keyboard drag; after 2–3 failed attempts, ask dude to do that step by hand                    |
| Env override doesn't reach the API (writes land in the dev DB) | Before S1, check that the new DB has the recruiter row and the dev DB counts are unchanged                              |
| The invalid key in S10 breaks boot                             | Boot only checks that the key is set; if it does fail, log S10 as skipped (the failure paths stay covered by MSW tests) |
| LLM nondeterminism makes the search/matches judgement fuzzy    | Judge plausibility only (the right role on top); precision/recall stays step 11                                         |
| Run-away cost through a requeue loop                           | Watch `api.log` call counts after every scenario; stop the API if they grow without UI actions                          |
