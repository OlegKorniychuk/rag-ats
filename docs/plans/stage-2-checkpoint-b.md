# Stage 2 · Checkpoint B — live scoring and citation review

Parent roadmap: `docs/plans/stage-2.md`, Part B, Checkpoint B. Branch: `feat/checkpoint-b` off `main`.

## Context

Steps 4–6 score every application with per-criterion quotes that the server verifies. SPEC's success criterion is "100% of fit scores include a cited snippet traceable to source CV/profile text — no un-grounded scores". Server-side verification already guarantees a quote exists verbatim. Nothing has checked yet whether quotes actually **support** the score they are attached to.

Checkpoint B therefore runs live scoring on a small committed set, reviews every citation and tunes the prompts. The calibration notes collected so far (sdd §11) are:

- parenthetical examples ("designers (Figma, component libraries)") become separate must-haves;
- the extractor's 10-criterion cap silently drops requirements;
- criteria scored 0 sometimes carry a generic filler quote;
- "3+ years" is treated softly (2 years scored 80);
- re-scoring against unchanged criteria moved overalls by up to 7 points.

Dude's choices:

- **measure, then tune** (baseline, up to 3 tuning rounds, report baseline vs tuned);
- **a committed synthetic vacancy set** with light expected bands per pair;
- **citation review by the main session, spot-checked by dude** before the report is final.

Outcome:

- `data/checkpoint-b/vacancies.json`;
- a `score-eval` script;
- a citation review file;
- tuned criteria and score prompts;
- `docs/eval/checkpoint-b.md` (baseline vs tuned).

## Architecture decisions

### Vacancy set (`data/checkpoint-b/vacancies.json`)

About 4 fictional vacancies matched to the Checkpoint A CV roles, written to exercise the calibration notes:

| id                | Shape                                                                                             | Exercises                               |
| ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `backend-java`    | Senior backend, Java/Kafka/PostgreSQL/Kubernetes, "5+ years", clear must/nice split               | years requirement, nice-to-have marking |
| `frontend-react`  | React/TypeScript, with parenthetical examples ("testing (Jest, Playwright)", "designers (Figma)") | parenthetical splitting                 |
| `data-ml`         | Python/ML/data pipelines, **12+ distinct requirements**                                           | the 10-criterion cap                    |
| `devops-platform` | Terraform/Kubernetes/CI, "3+ years", one soft requirement ("ownership mindset")                   | soft requirements, years                |

Each vacancy lists `expect` per CV id: a band, either `strong` (≥ 75), `partial` (40–74) or `weak` (< 40). Only clear-cut pairs get a band; ambiguous pairs are left out rather than guessed. `data-ml` also lists `mustCoverTerms`, requirement keywords that must appear in some extracted criterion, so dropped requirements become measurable.

### Script: `score-eval`

`apps/api/src/scripts/score-eval.ts` plus pure helpers in `apps/api/src/scripts/score-eval/`, mirroring `parse-eval`.

- **How to run it**: `npm run score-eval -w apps/api -- --label <name> [--runs N] [--only vacancyId:cvId,…] [--input-price X --output-price Y] [--dry-run]`.
- **What it uses**: the real `CvTextExtractor`, `GithubProfileFetcher` (snapshots fetched once per CV and reused across runs), `CriteriaExtractor` and `ApplicationScorer` with a real `LlmClient`. No DB, server or queue. It reuses `parse-eval`'s env loading and validation and its cost helpers; it does not copy them.
- **Criteria**: extracted **once per vacancy per run**, as in production (one extraction shared by all applicants), and recorded.
- **Calls and retries**: `LlmClient.parseStructured` is wrapped to count calls and usage per pair, which gives the retry rate with no production signature change. A pair that ends in `LlmGroundingError` is recorded as `failed`, not thrown.
- **Independent re-verification**: every stored quote is re-checked with `verifyQuotes`/`normaliseForMatch` against the exact CV and GitHub text. This catches any drift between the scorer and the verifier.
- **Per-pair checks** (pure, unit-tested):
  - grounded: every scored criterion > 0 has a quote, and every quote re-verifies;
  - the expected band, if one was given;
  - filler suspicion: a criterion scored 0 whose quote is also quoted, word for word, for another criterion;
  - for `data-ml`, coverage of `mustCoverTerms`;
  - for `--runs > 1`, the spread of `overall` across runs.
- **Output**: `docs/eval/checkpoint-b/<label>.json` and `<label>.md`. The markdown has:
  - a pair matrix (vacancy × CV: overall per run, band ✓/✗, retries, tokens, cost);
  - totals (grounded %, retry %, failure %, band agreement, mean and max spread, cost);
  - per vacancy, its extracted criteria;
  - per pair, a collapsible breakdown (criterion, score, reasoning, quotes).
- **Review stubs**: `--write-review` also emits `docs/eval/checkpoint-b/<label>.review.md`, one row per citation (pair, criterion, score, quote, source), with an empty `label` column (`supports` / `weak` / `irrelevant`) and a `note` column.
- **Review summary**: `--summarise-review <file>` turns a filled-in review into counts per label, per vacancy and per score bucket (0, 1–49, 50+).
- **Dry run**: `--dry-run` extracts CV text and fetches GitHub only. It makes no LLM call and builds no client, like `parse-eval`.

### Citation review

- The main session reads **every** citation of the baseline run, with `--runs 1` for review, and fills in the labels:
  - `supports`: the quote is evidence for that criterion at that score;
  - `weak`: related but not enough on its own;
  - `irrelevant`: filler, or about something else.
- Dude spot-checks a random sample of about 20 rows (the script prints a seeded sample) and marks agreement. Disagreements are discussed before the report is final.
- The **target for the tuned prompts** is ≥ 95% `supports` + `weak`, zero ungrounded scores, and no criterion scored 0 with an `irrelevant` filler quote.

### Tuning scope

The work stays within the prompt files and the schema `.describe()` texts:

- `llm/prompts/vacancy-criteria.prompt.ts` and `llm/vacancy-criteria.schema.ts`:
  - keep parenthetical examples inside their parent criterion;
  - raise the cap, or merge closely related requirements so that none is dropped (the decision follows the baseline numbers);
  - keep "N+ years" as part of the criterion text.
- `llm/prompts/application-score.prompt.ts` and `llm/application-score.schema.ts`:
  - when the evidence for a 0 is absence, quote the most relevant contrary evidence or nothing that pretends to support it. **This rule is decided in the review**: whether a 0 may carry no quote needs a change in `verifyQuotes` (a score of 0 currently still requires some quote overall);
  - apply years requirements strictly against the stated dates.

Out of tuning scope: the contract, `verifyQuotes` semantics (unless the review shows the overall-quote rule forces filler, in which case it becomes a small, separately reviewed change), and the parse prompt.

Each round changes the prompts, updates the exact-match prompt specs, then runs `--label tuned-N --runs 2` live.

### Budget

- Per run: 4 vacancies × 8 CVs = 32 pairs, plus 4 extractions.
- About 2–5k input tokens per score with `gpt-5.4-mini` is about $0.003–0.006 per score, so about $0.15–0.20 per run of 32 pairs.
- The baseline at `--runs 2` plus up to 3 tuning rounds at `--runs 2` comes to about 8 runs, about $1.5–2 in total. Well within budget.
- GitHub: 2 CVs with public accounts, fetched once per invocation.

### Execution split (per memory)

- Sonnet subagents: Task 1 (vacancy set) and Task 2 (script).
- Main session: the live runs, the citation review, tuning and all docs.

## Task list

### Task 1: Vacancy set (Sonnet, S)

- `data/checkpoint-b/vacancies.json`: 4 vacancies as in the table above, plus `expect` bands for the clear-cut pairs and `mustCoverTerms` for `data-ml`. Read the 8 Checkpoint A CV sources to set the bands.
- A loader with validation (`score-eval/vacancies.ts`) and its unit spec: unknown CV ids, invalid bands, duplicate ids.

**Acceptance**:

- Every CV id exists in the Checkpoint A manifest.
- Each vacancy has at least 2 `strong` and 2 `weak` expectations.
- The spec is green.

### Task 2: `score-eval` script (Sonnet, M; deps 1)

- The script, the helpers (`checks.ts`, `report.ts`, `review.ts`), the npm script, reuse of `parse-eval`'s `cost.ts` and env loading, plus unit specs for checks, report rendering, review stub/summary and seeded sampling.
- The dry run works without spending.

**Acceptance**: unit specs green; `--dry-run` lists 8 CVs with text lengths and GitHub statuses and 4 vacancies; build and lint clean.

**Verify**: `npm run test -w apps/api`, `npm run build -w apps/api`, `npm run lint -w apps/api`, dry run.

### Checkpoint: Tooling

Everything green; both diffs reviewed.

### Task 3: Baseline run and citation review (main)

- `--label baseline --runs 2 --write-review` live.
- Read the matrix, the criteria per vacancy and every citation, and fill in `baseline.review.md`.
- Print the spot-check sample.

**Checkpoint with dude**: show the baseline numbers, the review summary and the spot-check sample; agree on the labels and the tuning plan (including the zero-score quote rule) before changing any prompt.

### Task 4: Tuning (main, up to 3 rounds)

- Change, specs, live `--label tuned-N --runs 2 --write-review`.
- Review only the citations whose criterion or score changed, plus all score-0 rows.
- Stop when the targets are met with no band regressions.

**Verify each round**: `npm run test -w apps/api`, `npm run test:integration`, `npm run test:e2e -w apps/api`, since the prompts feed the MSW-captured request assertions.

### Task 5: Report and docs (main)

- `docs/eval/checkpoint-b.md`: method, sets, baseline vs tuned (grounded %, citation labels, band agreement, spread, retries, cost), findings, remaining gaps, the pricing caveat.
- `docs/sdd.md`:
  - §11: a score-eval note, the Checkpoint B result, and the calibration notes closed or left open;
  - §12: the scoring-calibration bullet updated, the criteria-cap bullet updated or removed;
  - module map and commands: the new script.
- README: the `score-eval` command.

### Checkpoint: Complete

- CI-equivalent run locally.
- Ask for commit approval (plan / vacancy set / script / prompt tuning / report and docs).
- Push, open the PR "Stage 2 checkpoint B: scoring eval and citation review", watch CI.

## Risks

| Risk                                                            | Mitigation                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Run-to-run variance hides the effect of tuning                  | 2 runs per pair; compare band agreement and spread, not single numbers; review the changed citations by hand                             |
| Bands are my guesses and can be wrong                           | Only clear-cut pairs get a band; band misses are read case by case before anything is tuned on them                                      |
| A single reviewer biases the labels                             | Dude's seeded spot-check; disagreements are resolved before the report                                                                   |
| Dropping the "≥ 1 quote" rule for zero scores weakens grounding | Only if the review shows the rule forces filler; it becomes a separate, test-covered change and the SPEC criterion is restated precisely |
| Prompt changes break the e2e request assertions                 | Full API suites in every tuning round                                                                                                    |
| Overfitting to 4 × 8 pairs                                      | Generic rules only (criterion definitions, quoting rules); step 10's larger synthetic set re-checks them                                 |
