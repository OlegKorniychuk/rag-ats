# Stage 2 · Step 11 — Eval harness plus docs

Parent roadmap: `docs/plans/stage-2.md`, Part D, Step 11. Branch: `feat/eval-harness` off `main` (#39 merged).

## Context

The SPEC's success criterion is a quantitative eval: retrieval precision/recall and score agreement against a self-labelled ground truth. Step 10 built that ground truth (`data/synthetic/`: 100 personas, 10 vacancies, rule labels for all 1000 pairs, 20 search queries with relevance sets, 30 blind human labels) and seeded it into `rag_ats_seed`. Step 11 measures the system against it and fixes the baseline that step 12 (cite evidence by ID) is compared to. It also measures the two quality gaps Checkpoint C left open: **G4** (full_text scoring ignores GitHub evidence) and **G5** (Find matches false positives from generic text). Fixing them is out of scope.

Dude's decision:

- **Score agreement uses a stratified sample, not all 1000 pairs**: all 62 strong + all 161 partial + 150 weak pairs (seeded RNG) + any of the 30 spot-check pairs not already in, in both scoring modes. About 375 pairs × 2 ≈ $5. Scoring every pair would be about $13, and step 12 re-runs the same eval. Population-level figures are reweighted by band.

## Architecture decisions

### No contract change

`packages/shared/src/api.ts` is untouched. The eval is a script. Production code changes are small refactors so the eval runs the real paths (below).

### The eval reads the seeded database and writes nothing

- It runs against a seeded DB (`DATABASE_URL` → `rag_ats_seed`). Candidates, CV text, GitHub snapshots, chunks with embeddings and the vacancies' extracted criteria all come from there, so retrieval and scoring see exactly what the app sees, and no CV is re-parsed, re-embedded or criteria re-extracted.
- **Slim Nest context** (`scripts/eval/app.ts`): config, DB, LLM, the chunk/candidate/vacancy repositories and `CandidateSearchService`. No `JobsModule`, so pg-boss and the workers don't start. Scores are computed in memory and never stored.
- **Preflight**: every persona maps to a candidate by email; all 100 are `parsed` and embedded for their current CV; all 10 seed vacancies (by title, seed recruiter) exist with criteria matching their current hash. Otherwise it stops with the list of what's missing.
- `LlmClient` is the seed's metering subclass, so cost is metered from real usage.

### Production refactors (behaviour unchanged)

- **`ApplicationScoreResult.attempts`** (1 or 2): the scorer already loops twice; it now reports how many calls it took. That gives the first-pass grounding failure rate without counting calls from outside. Not stored, not in the API.
- **`retrieveCriterionEvidence(llm, chunks, candidateId, criteria)`** in `rag/`: the body of `ScoreApplicationWorker.scoreFromChunks`, moved out so the worker and the eval share one rag retrieval path.

### Retrieval eval

Query embeddings only, a few cents.

- **Search** (`queries.json`, 20 queries): the production `CandidateSearchService.search` (50 nearest chunks, floor 0.3, up to 20 candidates).
  - Relevance: `relevant` = 1, `partiallyRelevant` = 0.5.
  - Metrics per query and mean: P@5, P@10, R@10, R@20, nDCG@10 (graded), MRR, and how many results came back.
  - **Floor sweep**: the same nearest chunks re-ranked with `rankCandidates` at floors 0.20 / 0.25 / 0.30 / 0.35, which shows what the fixed `MIN_SIMILARITY` costs in recall (sdd §12).
- **Find matches**, both modes (`criteria`, `whole_text`): the repository's `findNearest` and the same pure rankers (`rankByCriteria`, `rankCandidates`), floors and chunk limits as `VacancyMatchService`, with two differences, both stated in the report:
  - **No applicant exclusion.** Most strong pairs are already on boards (43 of 62), which would leave about 2 relevant pool candidates per vacancy. The whole pool is ranked instead.
  - **No cap of 10.** The whole ranked list is kept, so recall@20 is measurable.
  - Relevance: strong = 1, partial = 0.5, weak = 0 (rule bands).
  - Metrics per vacancy and mean: P@5, P@10, R@10, R@20, nDCG@10.
  - **G5**: the share of weak-band candidates in the top 10, with the worst examples (candidate, matched criteria, snippet).

### Scoring eval

- **Sample** (`scripts/eval/sample.ts`, seeded): as decided above. Each pair carries its band's sampling weight (strong 1, partial 1, weak 777/150).
- **Per pair and mode**:
  - `full_text`: `ApplicationScorer.score` with the DB CV text and GitHub snapshot;
  - `rag`: `retrieveCriterionEvidence` + `ApplicationScorer.scoreRag`;
  - both use the vacancy's stored criteria;
  - recorded: overall, per-criterion scores and quotes, attempts, usage, or the failure kind (`grounding` | `api` | `parse`).
- **Noise**: a 50-pair subset (stratified, seeded) is scored a second time per mode. Test-retest MAE and ρ give the run-to-run noise that step 12's "does not drop below the baseline" is judged against.
- **Concurrency 4**, a **resumable cache** (`docs/eval/baseline/<label>/scores.jsonl`, one line per pair × mode × run; a re-run skips done lines and retries failed ones only with `--retry-failed`).
- **Budget guard** (reuses `seed/budget.ts` and the meter):
  - `--dry-run` prints call counts and an estimate at $0.0065 per score (measured on the seed, retries included) × 1.3 and makes no calls.
  - A live run needs `--max-usd` (default $6) and stops starting new scores once spend plus in-flight estimates reach it.

### Metrics (`scripts/eval/metrics.ts`, pure)

- **Retrieval**: precision@k, recall@k, nDCG@k with graded gains, reciprocal rank.
- **Agreement**, per mode, against the rule:
  - Spearman ρ (average ranks for ties) and MAE of the overall score vs the rule score;
  - band agreement, Cohen's κ and quadratic κ (reusing `spot-check.ts`' `computeAgreement`);
  - mean signed error (does the scorer run high or low?);
  - per-band MAE.
- **Against Dude's labels**: band κ on the 30 spot-check pairs, next to the rule's own κ (0.65).
- **Population view**: weighted MAE and weighted band agreement using the sampling weights. ρ is reported on the sample only and says so.
- **Uncertainty**: a 95% bootstrap CI (1000 resamples, seeded) for ρ, MAE and κ, and a paired bootstrap for the full_text − rag difference.
- **Grounding** per mode:
  - first-pass failure rate (`attempts = 2` or grounding failure);
  - failure rate after the in-job retry (grounding failures);
  - API errors counted apart and excluded;
  - failure causes from `LlmGroundingError.problems`, bucketed like `docs/eval/synthetic-data.md`.
- **Cost** per mode: mean input/output tokens and USD per score (`parse-eval/cost.ts` pricing).
- **G4**:
  - over sampled pairs where the rule meets a requirement only through a `github_only` tag, find the scorer criteria that mention one of the tag's aliases (`synth/aliases.ts` matching);
  - report the share credited (score > 0) and the share citing a `github` quote, per mode;
  - pairs whose tag maps to no criterion are counted apart.

### Report

- `docs/eval/baseline/<label>.json`: every metric plus per-query, per-vacancy and per-pair rows.
- `docs/eval/baseline/<label>.md`: generated tables.
- `docs/eval/eval-baseline.md`: the written report (main session). Headline numbers, CIs, full_text vs rag, G4/G5 findings, limitations and what step 12 compares against.
- **Citation review sample** (`--write-review --sample 40`, reuses `score-eval/review.ts`): 40 random citations per mode, as a stub to fill in. The main session reviews it; Dude spot-checks 10. Its relevance rate is the step 12 baseline for citation relevance.

### CLI

`npm run eval -w apps/api` (and root `npm run eval`), entry `src/scripts/eval.ts` (SPEC's `apps/api/scripts/eval.ts` is corrected to match the other scripts):

```
--part retrieval|scoring|all   (default all)
--modes full_text,rag          (default both)
--label <name>  --seed <n>  --weak <n=150>  --noise <n=50>
--limit <n>                    (first n sampled pairs, for the smoke)
--concurrency <n=4>  --max-usd <n=6>  --dry-run  --retry-failed
--write-review --sample <n>    --summarise-review <file>
```

### Cost estimate (third-party `gpt-5.4-mini` prices, as before)

| Part                          | Calls            | Estimate   |
| ----------------------------- | ---------------- | ---------- |
| Retrieval (embeddings only)   | ~40 embed calls  | < $0.01    |
| Scoring, ~375 pairs × 2 modes | ~750 (+ retries) | ~$4.90     |
| Noise, 50 pairs × 2 modes     | ~100             | ~$0.65     |
| rag criterion embeddings      | ~375             | < $0.02    |
| **Total**                     |                  | **~$5.60** |

## Tests

- **Unit**:
  - metrics against hand-computed values: P/R/nDCG with graded gains and empty relevance sets; Spearman with ties; MAE; weighted aggregates; bootstrap determinism under a seed;
  - sampler: band quotas, spot-check pairs included once, determinism, weights;
  - G4 alias → criterion mapping;
  - grounding-cause bucketing;
  - the budget decision;
  - cache resume and `--retry-failed`;
  - report rendering;
  - the scorer's `attempts`;
  - `retrieveCriterionEvidence` (the existing worker tests keep passing).
- **Integration** (testcontainers, OpenAI mocked with MSW, as in the seed test):
  - a 3-persona mini set seeded into a container;
  - the preflight catches a missing candidate;
  - retrieval runs and returns metrics;
  - scoring writes the cache;
  - a re-run makes no LLM calls;
  - the eval context starts no pg-boss workers and writes no rows.
- **No e2e**: no endpoint changes.

## Task list

Sonnet subagents do Tasks 1–6. The main session reviews each task, re-runs the tests, does the live runs and the citation review, and writes the docs inline (Task 7).

- **Task 1 — Metrics and sampler (S)**, independent: `metrics.ts`, `sample.ts`, unit tests. _Verify_: build, lint, unit.
- **Task 2 — Production refactors (S)**, independent: `attempts` on the score result, `retrieveCriterionEvidence` extracted and used by the worker, unit tests. _Verify_: build, lint, unit, integration (scoring worker), e2e unchanged.
- **Task 3 — Eval context and data loading (M)**, independent: the slim Nest context, loading the synthetic files, persona → candidate mapping, preflight, the G4 alias → criterion mapper, unit tests plus the integration test's setup and preflight case. _Verify_: build, lint, unit, integration.
- **Task 4 — Retrieval eval (M)**, after Tasks 1 and 3: search with the floor sweep, matches in both modes over the whole pool, G5, unit tests with a fake chunk repository, the integration retrieval case. _Verify_: build, lint, unit, integration.
- **Task 5 — Scoring runner (M)**, after Tasks 1–3, in parallel with Task 4: the per-pair runner for both modes, noise reruns, concurrency, cache and resume, the budget guard and dry-run, failure classification, G4 per pair, unit tests, the integration scoring case. _Verify_: build, lint, unit, integration twice (the second run makes no calls).
- **Task 6 — Report and CLI (M)**, after Tasks 4 and 5: `eval.ts` with the flags, JSON + Markdown rendering, the review stub and summary, npm scripts (api and root), unit tests for rendering and args. _Verify_: build, lint, unit; `--dry-run` against `rag_ats_seed` prints the estimate.

### Checkpoint: Live retrieval (main)

- `eval --part retrieval --label retrieval-1` against `rag_ats_seed`. It costs cents, so no go-ahead is needed.
- Sanity-read a few queries and vacancies against `queries.json` and the bands: are the misses real, or a mapping bug?

### Checkpoint: Live scoring (main, ask Dude first)

- `--dry-run`, then `--limit 10` as a smoke, then the full run with `--max-usd 6`, and `--retry-failed` only if API errors occurred.
- Report the cost, the grounding failures and anything odd before writing up.

### Checkpoint: Citation review (main + Dude)

- `--write-review --sample 40` per mode. The main session labels relevance, and Dude spot-checks 10. Then `--summarise-review`.

### Task 7 — Docs (main, inline)

- `docs/eval/eval-baseline.md` (the written report).
- `docs/sdd.md`:
  - status line: Stage 2 steps 1–11 built;
  - the Stage 2 as-built summary;
  - §8: eval design decisions (seeded DB, read-only, stratified sample, whole-pool matches);
  - §9: the eval flags;
  - §11: tests and eval results;
  - §12: refresh the search/matches/scoring limits, G4 and G5 with the measured numbers.
- README: an "Run the eval" section after the seed.
- `SPEC.md`: the eval script path.
- `docs/plans/stage-2.md`: step 11 done; step 12's baseline references point at `eval-baseline.md`.

### Checkpoint: Complete

- CI-equivalent run locally, then `npx prettier --check .` last (the generated reports).
- Ask for commit approval: plan / refactors / harness / reports + docs.
- Push, open the PR "Stage 2 step 11: eval harness and baseline", and watch CI.

## Risks

| Risk                                                                         | Impact | Mitigation                                                                                                            |
| ---------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| Scorer criteria don't line up with rule requirements, so G4 misattributes    | Med    | Alias-based mapping with unmapped pairs counted apart; overall-score agreement doesn't depend on the mapping          |
| The stratified sample distorts population metrics                            | Med    | Weighted MAE and band agreement; ρ labelled sample-only; the sample design is stated in the report                    |
| Whole-pool matches differ from what the UI shows (exclusion, cap 10)         | Low    | Same rankers, floors and limits; both differences stated; the UI behaviour is a filter on top of the measured ranking |
| A live run overspends through retries or a bug                               | Med    | Dry-run, `--limit 10` smoke, hard `--max-usd`, resumable cache                                                        |
| Run-to-run noise is mistaken for a mode difference (or for step 12's effect) | Med    | Noise reruns, bootstrap CIs, a paired bootstrap for full_text − rag                                                   |
| The eval context accidentally starts workers and mutates `rag_ats_seed`      | Med    | No `JobsModule`; the integration test asserts no pg-boss schema activity and no new rows                              |
| Synthetic CVs are cleaner than real ones, which inflates the numbers         | Med    | Stated as a limitation (already in §12); uk, stuffer and injection personas reported as their own slices              |

## Out of scope

- Fixing G4 or G5, or tuning floors and prompts based on the results (follow-ups, informed by this report).
- Scoring all 1000 pairs.
- Changes to the API contract or UI.
- Step 12 (evidence IDs).
