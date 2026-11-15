# Checkpoint C — full flow through the UI

Stage 2 roadmap checkpoint (`docs/plans/stage-2.md`, plan `docs/plans/stage-2-checkpoint-c.md`). Steps 7–9 were tested with MSW and smoke-checked one at a time. This checkpoint ran the whole chain live through the web UI, on a fresh database: apply → parse (+ GitHub) → embed → score; then search, Find matches → add → score, vacancy edits, both scoring modes, failures and recovery.

**Outcome:**

- **All 12 scenarios pass. No blockers were found**, so no code changed in this checkpoint.
- **8 gaps** were logged (UX, retrieval/calibration quality, diagnostics). They are listed below and in sdd §12.
- **End state**: 9 candidates, 14 applications, 13 CV versions, 37 chunks, 14 scores (8 `full_text`, 6 `rag`). Every candidate is parsed and embedded on their latest CV, every score is `scored`, and every criterion scored above 0 carries a quote. All 174 quotes stored after S2 were re-verified independently against the CV/GitHub text.
- **Latency** on a local dev stack:
  - upload → parsed: 4–6 s;
  - upload → embedded: 5–9 s;
  - apply → scored: 8.5–15 s, about 19 s for the first applicant of a vacancy (which includes criteria extraction).
- **Cost**: 50 chat calls (13 parses, 6 criteria extractions, 31 scorer calls incl. retries) plus 33 embedding calls: 92.8k input + 34.8k output chat tokens, about **$0.23** in all.
- **Bands**: every scored pair with a Checkpoint B expected band landed in it.

## Setup

- A separate database, `rag_ats_checkpoint_c`, in the dev Postgres container, migrated with `DATABASE_URL=… npm run db:migrate -w apps/api`. The API ran with the same `DATABASE_URL` override (process env wins over `apps/api/.env` for both drizzle and `nest-typed-config`), so the dev DB was untouched (checked before S1).
- `npm run dev:api` / `npm run dev:web`, API output captured to a log for token usage and job errors. `GITHUB_TOKEN` was set (5000/h).
- Fixtures:
  - the 4 vacancies of `data/checkpoint-b/vacancies.json`, typed into the UI;
  - the 8 Checkpoint A PDFs (`data/checkpoint-a/`), with the manifest's GitHub URLs for `05-mobile` (`@sindresorhus`) and `08-injection` (`@gaearon`).
- Claude drove Chrome (Claude in Chrome), checked each scenario in the UI and against the DB (read-only `psql`) and the API log. 4 applications went through the apply form, including both GitHub ones. The other 6 were posted with `curl` to the same `POST /apply/:token` endpoint, to save time once the form had been exercised.
- `gpt-5.4-mini-2026-03-17`, `text-embedding-3-small`. Prices are $0.75 / $4.50 per 1M input/output tokens, the same unverified third-party figures as Checkpoints A and B.

## Scenarios

| #   | Scenario                      | Result | Notes                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Recruiter + vacancies         | pass   | Register, 4 vacancies created with their requirements intact. A stale dev-DB session cookie was still accepted against the fresh DB (gap G1).                                                                                                                                                                                                                                                 |
| S2  | Apply → parse → embed → score | pass   | 10 applications: all parsed, embedded and scored within about 14 s of the last apply. GitHub snapshots `ok` for both GitHub candidates. View CV opens the PDF. Polling stops on a settled board (no requests in 10 s). The chain ran faster than the browser could screenshot, so the in-flight chips were seen in S6, S7, S8 and S10 instead. One quote-verification retry, which succeeded. |
| S3  | Apply validation              | pass   | `.txt` and >5 MB caught client-side ("CV must be a PDF", "CV must be 5 MB or smaller"). A text file named `.pdf` → 400 "CV must be a PDF file"; 6 MB via curl → 413. A duplicate apply → "You've already applied to this vacancy", with no CV or application stored.                                                                                                                          |
| S4  | Score drawer (full_text)      | pass   | Rationale, criteria with must chips, bars, reasoning, CV-tagged quotes (Ukrainian too), "· Full text" footer, no evidence toggles. 174/174 quotes re-verified independently. No full_text score cites GitHub (gap G4).                                                                                                                                                                        |
| S5  | Semantic search               | pass   | A plausible top hit per query (Terraform/Kubernetes → Tomasz 46%, ML pipelines → Priya, mobile → Elena, React/TS → Marcus/Elena/Maya). The known Go/Ukrainian gap held: Oleksii is 5th for "Go backend". A no-hit query shows the empty state; Escape and an empty submit drop `?q=`.                                                                                                         |
| S6  | Find matches → add            | pass   | Existing applicants excluded on all 4 vacancies. Adding Daniel to Platform showed "Scoring…" on the board, removed his card and scored him 60; the candidate page lists the application with the added icon. Several suggestions are false positives (gap G5).                                                                                                                                |
| S7  | Vacancy edit → rescore        | pass   | Open vacancy: the dialog note, then "Re-scoring 4 applicants…" with greyed scores and new numbers about 10 s later. Closed vacancy: the closed note, the "Scores are outdated…" warning, and a rescore on reopen.                                                                                                                                                                             |
| S8  | RAG mode                      | pass   | Restart with `SCORING_MODE=rag`, 3 rescores from the drawer, 1 new apply. "· RAG" footer; "Evidence retrieved (N)" expands to chunks with "N% similar". 1 of 6 rag scores failed grounding twice and was fixed by one Rescore (gap G6).                                                                                                                                                       |
| S9  | Repeat applicant (new CV)     | pass   | Elena re-applied with the junior-frontend CV: profile replaced, chunks rebuilt (CV + kept GitHub), her Frontend score rescored against the new CV (12 → 70), and "mobile apps" no longer finds her.                                                                                                                                                                                           |
| S10 | Failure + retry               | pass   | With `OPENAI_API_KEY` overridden to an invalid key: the parse fails (Failed chip, alert, "Not available" sections, the score shows "Waiting for CV"), and a rescore fails ("Score failed", "Could not score the application"). After a normal restart, Retry parsing → profile → Scoring… → 26; Rescore → 98. Gaps G7 and G8.                                                                 |
| S11 | Restart recovery              | pass   | Killed the API right after a rescore (score `pending`). On boot: "Startup sweep enqueued 1 score job(s)", then scored.                                                                                                                                                                                                                                                                        |
| S12 | Pipeline drag                 | pass   | Mouse drag Applied → Interview and keyboard drag (Space, arrows, Space) Applied → Screened both persisted after reload.                                                                                                                                                                                                                                                                       |

GIFs: `checkpoint-c/s2-apply-to-score.gif`, `s5-search.gif`, `s6-find-matches.gif` and `s7-rescore.gif`. The S8 recording (2.7 MB) was over the 2 MB limit and is not committed.

## Scores

Initial scores (full_text) vs the Checkpoint B expected bands (`strong` ≥ 75, `weak` < 40):

| Vacancy  | Candidate (CV)              | Overall | Expected band |
| -------- | --------------------------- | ------- | ------------- |
| Frontend | Maya (01-junior-frontend)   | 91      | strong ✓      |
| Frontend | Marcus (08-injection)       | 84      | strong ✓      |
| Frontend | Hannah (06-career-switcher) | 22      | —             |
| Frontend | Elena (05-mobile)           | 0       | weak ✓        |
| Backend  | Daniel (02-senior-backend)  | 96      | strong ✓      |
| Backend  | Oleksii (07-ukrainian)      | 93      | strong ✓      |
| Backend  | Marcus (08-injection)       | 33      | —             |
| Backend  | Tomasz (04-devops)          | 27      | —             |
| ML       | Priya (03-data-ml)          | 96      | strong ✓      |
| Platform | Tomasz (04-devops)          | 97      | strong ✓      |

The same applications in both modes (full_text after the S7 edit, then rag):

| Application       | full_text | rag |
| ----------------- | --------- | --- |
| Oleksii × Backend | 93        | 95  |
| Maya × Frontend   | 80        | 79  |
| Hannah × Frontend | 20        | 26  |
| Elena × Frontend  | 6         | 12  |

In this small sample the modes agree to within 6 points, in line with `docs/eval/rag-scoring.md`. The short CVs have 2–3 chunks each, so retrieval returned the whole CV for every criterion (e.g. "Evidence retrieved (2)" on all of Oleksii's criteria).

## Gaps (logged, not fixed)

| #   | Scenario | Gap                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | S1       | **Stateless session for a missing recruiter**: `JwtStrategy.validate` returns the token payload without a DB lookup, so a valid token for a recruiter who no longer exists (here: a dev-DB session against a fresh DB with the same `JWT_SECRET`) is accepted, and the header shows their email. There is no recruiter deletion, so it only matters across DBs.           |
| G2  | S2       | **An open, settled board doesn't show new applications** until a reload or refocus: polling runs only while something is in flight.                                                                                                                                                                                                                                       |
| G3  | S2       | **Re-applying with the identical PDF** stores a new CV version, re-runs the paid parse and rescores the candidate's other applications. No content hash short-circuits it.                                                                                                                                                                                                |
| G4  | S2, S4   | **full_text scores ignore GitHub evidence**: none of the 34 quotes of the two GitHub candidates cited GitHub, though the block was in the prompt (about 4.2k input tokens vs 1.5k). Elena's `@sindresorhus` profile (18 TypeScript repos) earned 0 on "React and TypeScript". Search, by contrast, ranked her 2nd for "React TypeScript frontend" on those GitHub chunks. |
| G5  | S6       | **Find matches false positives from generic chunk text**: Daniel (Java backend; no React, TypeScript, Figma or Jest in his CV) is the top Frontend match at 3/7 criteria; Hannah tops Backend at 4/8; Daniel's real Kubernetes and cost-cutting bullets don't match "Running Kubernetes" / "reducing cloud cost" on Platform. Step 11 measures this.                      |
| G6  | S8       | **RAG grounding failures are not diagnosable**: 1 of 6 rag scores failed both attempts. The log only says `problems=1`, and the problem texts (which contain CV excerpts) aren't kept anywhere, so the cause can't be confirmed after the fact (step 9 saw a fabricated heading label).                                                                                   |
| G7  | S10      | **Endless polling behind a failed parse**: a board with a `pending` score whose candidate parse `failed` refetches applications every 3 s until a recruiter retries the parse.                                                                                                                                                                                            |
| G8  | S10      | **A failed rescore hides the previous score**: after a provider outage the badge shows "Score failed"; the previous valid result (97) is still stored but not shown.                                                                                                                                                                                                      |

Observed and by design: three criteria scored 0 carry a quote (e.g. Elena's "Mobile Developer (Android, iOS, Flutter)" against the React criterion). The Checkpoint B rule allows one concrete contrary fact for a 0.

## Fixed after the checkpoint

Plan: `docs/plans/stage-2-checkpoint-c-fixes.md`. The six code gaps were fixed in a follow-up PR. Each fix was re-checked live on a migrated copy of this checkpoint's database (`rag_ats_checkpoint_c_fixes`), so the original DB still holds the checkpoint's evidence.

| Gap | Fix                                                                                                                     | Live re-check                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| G1  | `JwtStrategy.validate` looks the recruiter up and rejects a token whose recruiter is gone                               | `/auth/me` 200 → recruiter row deleted → `/auth/me` and `/vacancies` 401                                                           |
| G2  | An open board refreshes every 30 s when nothing is in flight                                                            | A curl apply appeared on the open board with no reload; 3 requests in about 90 s                                                   |
| G3  | `cv_documents.content_sha256`; an identical re-upload by a parsed candidate with an unchanged GitHub URL reuses the CV  | Maya re-applied with the same PDF: still 1 CV, 0 parse calls, other score untouched, new application scored at once                |
| G6  | A double grounding failure stores its problems in `application_scores.failure_details` (never logged, never in the API) | Covered by unit and integration tests; a non-grounding failure stored `null` live                                                  |
| G7  | A score behind a failed parse no longer counts as in flight; static "Waiting for CV (parse failed)" chip                | That badge live; the board fell back to the 30 s idle interval instead of 3 s                                                      |
| G8  | A failed rescore shows the previous score greyed out with "Last rescore failed — showing the previous score"            | An invalid-key rescore of Tomasz: badge "Fit score 97 of 100 (last rescore failed)", the drawer adds "Showing the previous score." |

G4 (full_text ignores GitHub) and G5 (Find matches false positives) stay open for step 11, which measures retrieval and score quality.

## Caveats

- One run on 8 short fictional CVs; the judgements on search and matches are plausibility checks, not precision/recall (step 11).
- 6 of 14 applications went through `curl`, not the form; the form itself was exercised 4 times plus all the S3 validation cases.
- Latency is from a single local machine with the jobs in-process; it says nothing about load.
- The fixture pairs unrelated public GitHub accounts with fictional CVs, which makes G4's "evidence" artificial.
