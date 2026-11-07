# Checkpoint B — live scoring and citation review

Stage 2 roadmap checkpoint (`docs/plans/stage-2.md`, plan `docs/plans/stage-2-checkpoint-b.md`). After grounded scoring (steps 4–6), the scorer was run live on a committed set of vacancies × CVs. Every citation was read and labelled, and the criteria and scoring prompts were tuned until the citations supported the scores they were attached to.

**Outcome:**

- **Grounding**: every scored application cites verbatim evidence (64/64 scored pairs; server verification plus an independent re-check). This satisfies SPEC's "100% of fit scores include a cited snippet traceable to source CV/profile text". No application failed scoring after tuning.
- **Relevance**: 97.2% of citations support or partly support the score they back (baseline 85.0%). Irrelevant citations fell from 64 to 8 of all citations, and from 55 to 1 on criteria scored 0.
- **Ranking**: every pair with an expected band landed in it (52/52, baseline 47/52). Run-to-run spread fell from a mean of 4.4 and max of 21 points to a mean of 1.8 and max of 6.
- **Cost**: about $0.005 per score with `gpt-5.4-mini` ($0.0027–0.0106), about $0.001 per criteria extraction. The whole checkpoint (3 runs × 64 scores) cost about $1.00.
- **Model**: `gpt-5.4-mini` stays the default.

## Method

- **CVs**: the 8 fictional Checkpoint A CVs (`data/checkpoint-a/`, see `docs/eval/checkpoint-a.md`), two of them with real public OSS GitHub accounts.
- **Vacancies**: `data/checkpoint-b/vacancies.json`, 4 fictional vacancies, each written to exercise open calibration notes from steps 4–6.

| Vacancy           | Requirements     | Designed to test                                                                                                  |
| ----------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `backend-java`    | 6 must + 2 nice  | "5+ years", must/nice split, an accepted alternative language ("Java 21, but deep Go or Kotlin welcome")          |
| `frontend-react`  | 5 must + 2 nice  | parenthetical example lists ("testing (Jest, React Testing Library, Playwright)") that must not become must-haves |
| `data-ml`         | 14 must + 1 nice | more requirements than the old 10-criterion cap; 14 required keywords make dropped requirements measurable        |
| `devops-platform` | 7 must + 2 nice  | "3+ years", a soft requirement ("an ownership mindset")                                                           |

- **Expected bands**: each vacancy lists an expected band for the clear-cut CVs only: `strong` (≥ 75), `partial` (40–74) or `weak` (< 40). There are 52 expectations across the 32 pairs, and no `partial` ones, because no partial pair was clear-cut. `data-ml` and `devops-platform` have one `strong` CV each, since no other CV in the set has ML or infrastructure experience; the plan's "2 strong per vacancy" was relaxed rather than forced.
- **Harness**: `npm run score-eval -w apps/api -- --label <name> --runs 2 --write-review`.
  - It runs the production pieces with no database, server or queue: `CvTextExtractor`, `GithubProfileFetcher`, `CriteriaExtractor` and `ApplicationScorer` with a real `LlmClient`.
  - Criteria are extracted once per vacancy per run, as in production. CV text and GitHub snapshots are fetched once per invocation.
  - LLM calls are counted per pair, so a retry (the scorer's one feedback round after a failed quote check) is visible.
  - It writes `docs/eval/checkpoint-b/<label>.{json,md}` (the matrix, totals, the extracted criteria per run and every breakdown) and `<label>.review.md` (one row per citation of run 1 for labelling).
- **Automatic checks per pair**:
  - grounded: every criterion scored above 0 has a quote, and every quote re-verifies (`verifyQuotes`) against the exact CV text and GitHub block the scorer saw;
  - band: the overall score's band against the expected one;
  - filler suspects: a criterion scored 0 that reuses another criterion's quote word for word;
  - coverage (`data-ml`): which required keywords appear in the extracted criteria;
  - spread: the difference between the two runs' overall scores.
- **Citation review**: every citation of run 1 was read and labelled in the review file.
  - `supports`: the quote is evidence for that criterion at that score. For a criterion scored 0, a concrete contrary fact (the candidate's actual stack or role in that area) counts as supporting the 0.
  - `weak`: related but not enough on its own.
  - `irrelevant`: a section heading, a bare job title or project name, a sentence about something else, or a fragment.
  - Dude spot-checked a seeded random sample of each reviewed run (20 rows of `baseline`, seed 7; 15 rows of `tuned-2`, seed 11) and agreed with every label.
  - `tuned-1` was an intermediate round and was not fully reviewed; its citation counts are reported for comparison.
- **Pricing**: $0.75 / $4.50 per 1M input / output tokens for `gpt-5.4-mini`, the same third-party listing as Checkpoint A, **not verified against OpenAI's pricing page**. The harness takes prices as flags.

## Results

| Run (`docs/eval/checkpoint-b/`) | Prompts (`prompts/`) | Grounded  | Failed | Retried | Band agreement   | Spread mean / max | `data-ml` coverage (run 1 / 2) | Cost (64 scores + 8 extractions) |
| ------------------------------- | -------------------- | --------- | ------ | ------- | ---------------- | ----------------- | ------------------------------ | -------------------------------- |
| `baseline`                      | `baseline/`          | 63/63     | 1      | 5       | 47/52 (90.4%)    | 4.4 / 21          | 7/14 / 10/14                   | $0.3422                          |
| `tuned-1`                       | `tuned-1/`           | 62/62     | 2      | 6       | 50/52 (96.2%)    | 2.1 / 5           | 14/14 / 14/14                  | $0.3366                          |
| `tuned-2` (final)               | `tuned-2/`           | **64/64** | **0**  | **2**   | **52/52 (100%)** | **1.8 / 6**       | **14/14 / 14/14**              | **$0.3259**                      |

Citations of run 1, by the score of the criterion they back:

| Run        | Citations | Score 0 | Score 1–49 | Score 50+ | supports / weak / irrelevant | supports + weak |
| ---------- | --------- | ------- | ---------- | --------- | ---------------------------- | --------------- |
| `baseline` | 426       | 175     | 87         | 164       | 221 / 141 / 64               | 85.0%           |
| `tuned-1`  | 295       | 14      | 96         | 185       | not reviewed                 | —               |
| `tuned-2`  | 287       | 30      | 83         | 174       | 210 / 69 / 8                 | **97.2%**       |

| Score bucket | `baseline` supports + weak | `baseline` irrelevant | `tuned-2` supports + weak | `tuned-2` irrelevant |
| ------------ | -------------------------- | --------------------- | ------------------------- | -------------------- |
| 0            | 68.6%                      | 55                    | 96.7%                     | 1                    |
| 1–49         | 94.3%                      | 5                     | 97.6%                     | 2                    |
| 50+          | 97.6%                      | 4                     | 97.1%                     | 5                    |

By vacancy (`tuned-2`): `backend-java` 97.7%, `data-ml` 98.6%, `devops-platform` 95.0%, `frontend-react` 98.0% supports + weak (baseline 93.4%, 80.4%, 90.4%, 74.7%).

Final pair matrix (`tuned-2`, overall per run; ✓ = expected band met in both runs, blank = no expectation, R = a retry was needed):

| CV                   | backend-java | frontend-react | data-ml | devops-platform |
| -------------------- | ------------ | -------------- | ------- | --------------- |
| `01-junior-frontend` | 0/0 ✓        | 89/90 ✓ R      | 0/0 ✓ R | 0/0 ✓           |
| `02-senior-backend`  | 96/94 ✓      | 3/0 ✓          | 4/3 ✓   | 50/54           |
| `03-data-ml`         | 10/11 ✓      | 0/0 ✓          | 96/96 ✓ | 24/27 ✓         |
| `04-devops`          | 26/32        | 0/0 ✓          | 0/0 ✓   | 97/98 ✓         |
| `05-mobile`          | 9/11 ✓       | 5/7 ✓          | 3/3 ✓   | 15/11 ✓         |
| `06-career-switcher` | 13/18 ✓      | 19/19          | 10/8 ✓  | 11/13 ✓         |
| `07-ukrainian`       | 96/96 ✓      | 0/0 ✓          | 6/4 ✓   | 44/47           |
| `08-injection`       | 36/33        | 82/78 ✓        | 6/3 ✓   | 11/14           |

Token use (`tuned-2`): 134,982 input / 47,456 output tokens for 64 scores (about 2.1k / 0.74k per score), and 5,398 / 1,563 for 8 extractions. Quotes per scored pair fell from 13.3 (baseline) to 9.1, because criteria scored 0 mostly carry no quote now.

## Findings

1. **Criteria extraction was the main error source, not the scorer.** The baseline extraction prompt said to split compound requirements and capped criteria at 10 (in the prompt, the schema and `MAX_CRITERIA` in code). The model applied the split to example lists:
   - `frontend-react` became Tailwind CSS, CSS Modules, Redux Toolkit, Zustand and React Query as separate must-haves. The cap then cut off UI testing tools, reusable components and both nice-to-haves. Both strong frontend CVs scored 52–66 because they don't use all five libraries.
   - `data-ml` lost 7 and 4 of its 14 requirements in the two runs (run 1 split "Advanced SQL" into three criteria).
   - The split differed between runs (backend run 2 separated Kafka from event-driven architectures, and mentoring from code review), which drove most of the 21-point spread.

   After round 1 (one criterion per stated requirement, examples and alternatives kept inside their parent, cap 15), the criteria map one-to-one onto the vacancy bullets and are identical across runs. Both strong frontend CVs now score 78–90, and `data-ml` keeps all 15.

2. **Score-0 criteria were padded with filler.** The baseline scoring prompt said "1 to 3 quotes per criterion" and, two lines later, that a 0 may have none; the schema said "1-3". The model filled most zeros with section headings ("SKILLS", "PROJECTS"), bare job titles or project names, or the same summary sentence for every criterion. 55 of the 64 irrelevant citations were on zeros. Round 1 allowed a 0 to carry a quote only for a concrete contrary fact, and score-0 citations fell from 175 to 14.
3. **The "at least one quote per application" rule then caused failures.** With zeros no longer padded, a CV unrelated to the vacancy (`04-devops` × `frontend-react`) scored 0 everywhere with nothing to quote. Verification rejected it twice, so the pair failed in both runs. On other pairs the retry feedback pushed the model to raise a score just to produce a quote (`01-junior-frontend` × `data-ml`: "explaining results to stakeholders" went from 0 to 35 and 50). Two options were considered: drop the rule (verifier change, and the SPEC criterion restated as "every non-zero score cites evidence"), or cite contrary evidence. Dude chose the second: in round 2 the prompt and the retry feedback say that when every score is 0, the model quotes the candidate's actual role or main stack once, on the criterion it most clearly contradicts, and never raises a score to have a quote. No pair failed after that, and both previously failing runs scored 0/0 with a contrary quote. The verifier is unchanged, so SPEC's criterion still holds literally.
4. **Over-generous credit for a related skill shrank but did not disappear.** The baseline gave 70 for "Docker" against managed Kubernetes, 70 for backend unit tests against UI testing, and 20 for build caching as Redis caching. The round 1 rule ("the score must follow from the quotes; a related skill is not the skill") removed those. In `tuned-2`, `05-mobile`'s language list (Kotlin, Swift, Dart, Java) still gets 60 for "scripting in Bash or Python", and `02-senior-backend`'s "Go" gets 40.
5. **Years requirements are still read softly.** `06-career-switcher` (one year) gets 45 against "2+ years of React and TypeScript". `02-senior-backend` (ten years of backend with on-call) gets 65 against "3+ years in DevOps, SRE or platform engineering". These are defensible partial credits and lower than the step 4 example (2 years scored 80 against "3+"), but a stated minimum is still not treated as a threshold.
6. **Grounding held throughout.** Server verification and the independent re-check agreed on every run (100% grounded in all three). The prompt changes never caused a quote to be paraphrased; retries were caused by missing quotes or the overall-quote rule, not by invented text.
7. **The prompt-injection CV was not an issue for scoring.** `08-injection`'s planted instruction did not lift its scores: weak on `data-ml` and `devops-platform`, strong only on `frontend-react`, where the CV genuinely matches.

## Calibration notes from steps 4–6

| Note                                                                   | Status after `tuned-2`                                                           |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Parenthetical examples become separate must-haves                      | **Closed**: examples and alternatives stay inside their criterion                |
| The 10-criterion cap silently drops requirements                       | **Closed**: cap 15, one criterion per stated requirement; `data-ml` keeps all 15 |
| Criteria scored 0 carry a generic filler quote                         | **Closed**: 1 irrelevant score-0 citation of 30 (baseline 55 of 175)             |
| Re-scoring against unchanged criteria moves overalls by up to 7 points | **Closed**: max spread 6 across 32 pairs, mean 1.8                               |
| "3+ years" is treated softly                                           | **Open**: still partial credit for fewer years (finding 5)                       |

## Remaining gaps

- **Related-skill credit**: a skills list for one technology still earns partial credit for a different one in a few pairs (finding 4).
- **Headings on high scores**: two citations are section headings ("НАВИЧКИ", "ДОСВІД РОБОТИ") attached to 70–100 scores that also carry real quotes. They don't change the score but add noise in the drawer.
- **One score-0 filler quote**: Redis caching quoted against client-side state management (`frontend-react` × `02-senior-backend`).
- **Small set**: 4 vacancies × 8 CVs, one reviewer plus spot-checks, and no partial expectations. The rules are generic (criterion definitions and quoting rules, nothing CV-specific), but step 10's larger synthetic set should re-check them, and step 11's eval should add partial-band expectations and a second reviewer or judge.
- **Pricing unverified**: as in Checkpoint A, the per-token prices are third-party figures.
