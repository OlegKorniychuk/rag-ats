# Eval baseline (Stage 2 steps 11–12)

Stage 2 roadmap steps 11 and 12 (`docs/plans/stage-2.md`, plans `docs/plans/stage-2-step-11.md` and `docs/plans/stage-2-step-12.md`). Step 11 built `npm run eval`, which measures retrieval and scoring against the step 10 synthetic ground truth. Step 12 replaced quoting with evidence-unit IDs before the full run, so the run below is both step 11's baseline and step 12's "after". The "before" for grounding and cost comes from the step 10 seed and a pre-fix smoke run (Dude's decision, 2026-11-21).

Generated reports (do not edit): `docs/eval/baseline/baseline-units.{json,md}` and the label directory `docs/eval/baseline/baseline-units/` (scores, retrieval, run log, both review files and their summaries). Smoke runs: `smoke-quotes` (pre-fix), `units-smoke`, `units-smoke-2`.

**Outcome:**

- **Run**: 381 pairs × 2 scoring modes plus 50 noise pairs × 2 = **862 scores, 0 failed, $3.95** metered (cap $6), against the seeded `rag_ats_seed` database, read-only.
- **Score agreement with the rule**: Spearman ρ **0.936** (full_text) and **0.940** (rag), MAE 7.6 and 7.7 points, Cohen κ 0.745 and 0.766. full_text and rag do not differ beyond sample noise (every paired CI contains 0).
- **Run-to-run noise**: the same pair scored twice differs by 4.5 (full_text) and 3.6 (rag) points on average.
- **Grounding**: 2/431 (full_text) and 8/431 (rag) scores needed the in-job retry, **none failed**, none had a criterion zeroed. Before step 12: 21% of first answers on the seed, and 18% / 64% on the pre-fix smoke.
- **Cost per score** fell from $0.0061 / $0.0105 (pre-fix smoke) to **$0.0043 / $0.0048**; mean output tokens from 1024 / 1706 to 640 / 659.
- **Citation review**: 92.5% (full_text) and 90.0% (rag) of 40 sampled citations each support the criterion or are related to it.
- **Retrieval**: search nDCG@10 **0.810**, P@10 0.655, R@20 0.857; Find matches P@10 **1.00** (criteria) and 0.98 (whole_text).
- **Checkpoint C gaps**: G4 (full_text rarely cites GitHub) is mostly closed on this set: 97% of GitHub-only skills are credited and 72% cite GitHub. G5 (weak candidates in Find matches) is 0 weak in any criteria top 10.
- **Weak spot**: keyword stuffers score about 19 points above the rule in both modes.

## Method

### Data and sample

The step 10 set: 100 personas, 10 vacancies, rule ground truth for all 1000 pairs (bands strong ≥ 75, partial 40–74, weak < 40), 20 search queries with relevance sets, and Dude's blind labels for 30 pairs. The eval runs against `rag_ats_seed`, the database the step 10 seed filled through the real pipeline, so it reuses the stored criteria, chunks and GitHub snapshots and writes nothing there (a slim Nest context with no job workers).

Scoring all 1000 pairs twice would cost about $9, and 777 of them are weak. The sample takes every strong (62) and partial (161) pair, 150 random weak pairs, and every spot-check pair not already in: **381 pairs**. Weak pairs carry the weight 777 / 158 = 4.92, so the weighted MAE and band agreement estimate the whole population. Spearman ρ, κ and the plain MAE are over the sample, where weak pairs are under-represented. A stratified 50-pair subset is scored a second time per mode for the noise estimate. Seed 1 everywhere; the job order is shuffled with the same seed so a capped run still covers every band.

### What is measured

| Part            | How                                                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search          | The production `searchWithHits` (50 nearest chunks, floor 0.3, up to 20 candidates) for the 20 queries; P@k, R@k, nDCG@10 (relevant 1, partial 0.5), MRR; a floor sweep 0.2–0.35 on the same chunks                                |
| Find matches    | Both modes over the whole pool, with no applicant exclusion and no cap of 10 (so R@20 is measurable); relevance from the rule bands (strong 1, partial 0.5, weak 0); G5 = weak-band share of the top 10                            |
| Scoring         | `ApplicationScorer` in both modes with the vacancy's stored criteria; agreement of the overall score with the rule score (ρ, MAE, band κ, quadratic κ), bootstrap 95% CIs (1000 resamples), a paired bootstrap for full_text − rag |
| Noise           | Test-retest MAE and ρ on the 50 pairs scored twice                                                                                                                                                                                 |
| Grounding       | First-pass rate (retried + failed over ok + failed) and after-retry rate, API and parse errors excluded; failure buckets; zeroed criteria                                                                                          |
| G4              | Every tag the rule counts as met only through GitHub, mapped to the criteria that mention it by alias: credited (criterion score > 0) and cites GitHub                                                                             |
| Cost            | Metered tokens per call at third-party `gpt-5.4-mini` prices (unverified)                                                                                                                                                          |
| Citation review | 40 random citations per mode labelled `supports` / `weak` / `irrelevant` by the main session; Dude spot-checked 10 borderline ones and agreed with all                                                                             |

## Results

### Score agreement

| Mode      |   n | Spearman ρ           | MAE                  | Cohen κ              | Quadratic κ | Mean signed error | Weighted MAE | Weighted band agreement |
| --------- | --: | -------------------- | -------------------- | -------------------- | ----------: | ----------------: | -----------: | ----------------------: |
| full_text | 381 | 0.936 [0.916, 0.949] | 7.580 [6.850, 8.339] | 0.745 [0.688, 0.800] |       0.849 |            +3.108 |        6.602 |                   0.891 |
| rag       | 381 | 0.940 [0.921, 0.952] | 7.664 [6.960, 8.475] | 0.766 [0.710, 0.817] |       0.862 |            +3.071 |        6.234 |                   0.908 |

full_text minus rag: ρ −0.004 [−0.016, 0.008], MAE −0.084 [−0.709, 0.530], κ −0.021 [−0.072, 0.030]. On this set the two modes are interchangeable, as on the Checkpoint B set (step 9).

- **The scorer runs about 3 points above the rule** in both modes.
- **Partial pairs are hardest**: MAE 10.2 (full_text) and 10.8 (rag), against 4.9 / 5.5 for strong and 6.0 / 5.4 for weak. The rule's partial credit (too few years, skills-list-only) and the scorer's softer reading of "N+ years" disagree most there.
- **Against Dude's labels** (30 pairs): band κ 0.557 (full_text) and 0.650 (rag); the rule itself agrees with Dude at κ 0.650. The scorer is about as close to a human reader as the rule is.

Slices (MAE, signed error):

| Slice              | Pairs | full_text    | rag          |
| ------------------ | ----: | ------------ | ------------ |
| Ukrainian CVs      |    19 | 5.2 (−0.8)   | 5.6 (+1.0)   |
| Keyword stuffers   |    13 | 20.8 (+19.3) | 18.5 (+17.3) |
| Injection personas |     5 | 5.0 (−3.8)   | 11.4 (+4.6)  |
| The rest           |   344 | 7.2 (+2.8)   | 7.3 (+2.6)   |

- **Keyword stuffers are over-scored**: the rule gives a skills-list-only mention partial credit (0.5); the scorer credits it nearly in full when the list names the exact technology. The prompt allows citing one technology from a skills list, so this is a calibration choice, not a grounding failure.
- **Injection personas were not inflated** in full_text; rag's 11.4 MAE is 5 pairs and within its noise range.
- **Ukrainian CVs score as well as English ones.**

### Run-to-run noise

| Mode      | Pairs | Test-retest MAE | Max delta | Mean signed delta | ρ     |
| --------- | ----: | --------------: | --------: | ----------------: | ----- |
| full_text |    50 |            4.46 |        29 |             −0.02 | 0.977 |
| rag       |    50 |            3.62 |        18 |             +1.14 | 0.981 |

About half of the MAE against the rule (7.6) is the scorer's own noise (4.5). A later change to scoring has to move MAE by more than that to count.

### Grounding: before and after step 12

| Run                               | Citing   | Scores | First pass, full_text | First pass, rag | After retry, full_text | After retry, rag |
| --------------------------------- | -------- | -----: | --------------------: | --------------: | ---------------------: | ---------------: |
| Step 10 seed (full_text only)     | quotes   |    232 |                  ~21% |               — |          4.7% (11/232) |                — |
| `smoke-quotes` (pre-fix)          | quotes   |     22 |            18% (2/11) |      64% (7/11) |             18% (2/11) |       18% (2/11) |
| `units-smoke` (unit IDs)          | unit IDs |     22 |            18% (2/11) |      27% (3/11) |                     0% |       18% (2/11) |
| `units-smoke-2` (stronger prompt) | unit IDs |     22 |             0% (0/11) |       0% (0/11) |                     0% |               0% |
| **`baseline-units`** (full run)   | unit IDs |    862 |          0.5% (2/431) |    1.9% (8/431) |                 **0%** |           **0%** |

- **Every misquote class is gone**: no unknown evidence ID, missing, duplicate or unknown criterion appeared in 862 scores. Quotes are now verbatim by construction: the server resolves IDs to the unit text.
- **The only failure left in the smokes** was a criterion scored above 0 with no cited unit. The stronger prompt (evidence before score, score 0 without a unit) removed it in `units-smoke-2`; the code rule "retry once, then zero" is the backstop and never fired in the full run.
- **The 10 retries in the full run** are not explained: the cache stores the final attempt only, so the first answer's problem isn't recorded. In the smokes every retry was the no-evidence case.
- **Step 12's "done when"** asked for 0% on the first pass. The full run is at 0.5% / 1.9% first pass and 0% after the retry, down from 21% (seed) and 64% (rag smoke). Agreement could not be compared with a pre-fix baseline, since no pre-fix full run was made; the numbers above are the baseline from here on.

### Cost

| Run              | Mode      | Mean input tokens | Mean output tokens | Mean USD per ok score |
| ---------------- | --------- | ----------------: | -----------------: | --------------------: |
| `smoke-quotes`   | full_text |              1928 |               1024 |               $0.0061 |
| `smoke-quotes`   | rag       |              3773 |               1706 |               $0.0105 |
| `baseline-units` | full_text |              1907 |                640 |               $0.0043 |
| `baseline-units` | rag       |              2505 |                659 |               $0.0048 |

Output tokens dropped by about 40% (full_text) and 60% (rag): the model writes IDs, not quote text, and rag's retries are gone (they doubled the input tokens). The eval's dry-run estimate uses $0.006 per score × 1.3, so it over-estimates by about a third.

### Citation review

| Mode      | Citations | supports | weak | irrelevant | supports + weak |
| --------- | --------: | -------: | ---: | ---------: | --------------: |
| full_text |        40 |       29 |    8 |          3 |           92.5% |
| rag       |        40 |       22 |   14 |          4 |           90.0% |

Checkpoint B's reviews measured 97.2% (full_text, `tuned-2`) and 93.3% (rag, `rag-2`) on 8 hand-designed CVs; this set is larger and harder, and the reader was the main session, so the comparison is loose.

- **Weak** citations are mostly a neighbouring skill cited for the one asked (SwiftUI and Redux for React/Vue/Angular, Playwright for Jest, threat modelling for the OWASP Top 10), a bare skill name for a years-of-experience criterion, or a GitHub project for "production experience". A few carry high scores (85–95).
- **Irrelevant** citations share a word with the criterion ("Terraform workflows" for Git workflows) or are a role line cited for Git. One rag score of 30 rested on an irrelevant unit (iOS work in Java for "Python or Go").
- **Units read as whole statements.** Two odd units: a README line that holds its `## Features` heading and the bullets after it (the README excerpt is one line in the GitHub block), and a skills-list fragment ("Hibernate, Go") from a wrapped line.

### Retrieval

| Retrieval           |   P@5 |  P@10 |  R@10 |  R@20 | nDCG@10 | Mean results |
| ------------------- | ----: | ----: | ----: | ----: | ------: | -----------: |
| Search (20 queries) | 0.810 | 0.655 | 0.726 | 0.857 |   0.810 |         19.3 |
| Matches, criteria   | 1.000 | 1.000 | 0.471 | 0.733 |   0.874 |         63.1 |
| Matches, whole_text | 1.000 | 0.980 | 0.465 | 0.714 |   0.878 |         25.7 |

- **Search**: MRR 0.917. The weakest queries are "Kotlin Android developer" (nDCG 0.46, first relevant hit at rank 3) and "TypeScript and React frontend" (0.54). The floor barely matters between 0.2 and 0.3; at 0.35 R@20 drops from 0.857 to 0.799, so `MIN_SIMILARITY` 0.3 stays.
- **Find matches**: every top 10 in criteria mode is strong or partial for all 10 vacancies; whole_text puts 2 weak candidates into the Full-Stack top 10 (frontend-only CVs). R@10 is about 0.47 because a vacancy has 16–32 relevant candidates, more than 10 slots.
- **G5** (Checkpoint C's false positive from generic text): 0 weak candidates in any criteria top 10, 2% in whole_text. On this set the step 8 design holds; the Checkpoint C case was one CV in a pool of 8.

### G4: GitHub evidence

| Mode      | GitHub-only tags | Credited | Cite GitHub |
| --------- | ---------------: | -------: | ----------: |
| full_text |               76 |    97.4% |       72.4% |
| rag       |               76 |    98.7% |       88.2% |

In Checkpoint C full_text cited GitHub in none of 34 quotes. Here a skill evidenced only on GitHub is credited almost always, and cited from GitHub in most cases; the rest credit it from a related CV unit. rag cites GitHub more because each repo is its own chunk, retrieved by the criterion.

## Project spend

All live OpenAI runs logged in `docs/eval/`, against SPEC's $20 ceiling (third-party `gpt-5.4-mini` prices, unverified). A few step smokes during development (steps 2–9, cents each) were not logged and are not included.

| Run                                    | Report                       |      Cost |
| -------------------------------------- | ---------------------------- | --------: |
| Checkpoint A (5 parse runs)            | `checkpoint-a.md`            |     $0.18 |
| Checkpoint B (3 scoring runs)          | `checkpoint-b.md`            |     $1.00 |
| Step 9 RAG scoring (2 runs)            | `rag-scoring.md`             |     $0.78 |
| Checkpoint C walkthrough               | `checkpoint-c.md`            |     $0.23 |
| Step 10 synthetic generation           | `synthetic-data.md`          |     $0.71 |
| Step 10 seed (smoke, full, 2 retries)  | `synthetic-data.md`          |     $1.92 |
| Steps 11–12 eval (3 smokes + full run) | this report, `baseline/*.md` |     $4.36 |
| **Total**                              |                              | **$9.19** |

## Limits

- **Synthetic data**: CVs are cleaner and more regular than real ones, and the labels come from a rule that a human agreed with at κ 0.65. The numbers measure agreement with that rule, not hiring quality.
- **One run per pair** (two for 50): the noise estimate rests on 50 pairs per mode.
- **No pre-fix full run**: the step 12 effect on agreement is not measured; the before/after compares grounding and cost only.
- **Citation review by the main session**, with Dude's spot-check of 10 rows.
- **Prices** are third-party figures for `gpt-5.4-mini`, unverified against OpenAI's pricing page.

## Reproduce

```bash
DATABASE_URL=…/rag_ats_seed npm run eval -- --dry-run --label baseline-units   # plan and estimate
DATABASE_URL=…/rag_ats_seed npm run eval -- --label baseline-units             # resumes from the cache
npm run eval -- --label baseline-units --report-only                           # rebuild the reports
npm run eval -- --label baseline-units --write-review --sample 40              # citation review files
npm run eval -- --summarise-review docs/eval/baseline/baseline-units/review-rag.md
```

The cache makes a re-run free: every finished score is skipped. A new label scores everything again (about $4).
