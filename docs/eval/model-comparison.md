# Model comparison: gpt-5.4-mini vs gpt-6-luna

`gpt-6-luna` was compared with the default `gpt-5.4-mini` on every LLM stage, using the existing evals with nothing but `OPENAI_MODEL` changed (the prompts are the same and `LlmClient` sends no model-specific parameters). **Decision: stay on `gpt-5.4-mini`.** Luna ranks candidates as well, is more stable and is 5–6× cheaper, but it scores about 8 points below the rule across the board and so failed the agreed decision rule on score error and band agreement. Run files: `checkpoint-a/final-gpt-6-luna.*`, `checkpoint-b/units-{mini,luna}.*`, `baseline/luna-units.*`, `questions/q-luna.*`.

## Setup

- **Prices** (USD per 1M tokens, input / output): mini 0.75 / 4.50 (third-party listed, unverified, as everywhere in these reports), Luna 0.10 / 0.50. The generated Luna reports repeat the mini pricing caveat; their costs use the Luna prices (`--input-price 0.1 --output-price 0.5`, added to `eval` and `questions-eval` for this run).
- **Held fixed**: the same CVs, vacancies and samples as the mini runs. `eval` and `questions-eval` read the seeded `rag_ats_seed` database, so Luna scored against the criteria mini extracted, and Luna's questions were built from mini's scores.
- **Prompts were tuned on mini** (Checkpoints A and B), which favours mini.
- **Decision rule**, agreed before the runs. Luna counts as comparable when all of these hold:
  - `eval`, both modes: Spearman ρ ≥ mini − 0.02, MAE ≤ mini + 1.0, failed scores ≤ 1 %;
  - citation review: supports + weak ≥ 90 % per mode;
  - Checkpoint B: band agreement and grounded counts no worse than mini by more than 1 pair;
  - questions: 30/30 ok, gap-below-50 ≥ 80 %, no hypothetical gap questions.

## Results

### CV parsing (Checkpoint A, 8 CVs, 2 runs, 2026-10-20)

From `checkpoint-a.md`: both models passed 222/222 checks. Luna was about 5.6× cheaper per CV ($0.0005 vs $0.0028) with about 1.9× the output tokens (likely reasoning tokens counted as output). It also added vaguer method-level skills and condensed older roles harder.

### Criteria extraction and scoring on hand-made CVs (Checkpoint B, 4 vacancies × 8 CVs, 2 runs)

Both models were run on the current code (evidence-unit IDs); the earlier `tuned-2` mini runs predate step 12 and are not comparable.

| Metric                                        | mini (`units-mini`) | Luna (`units-luna`) |
| --------------------------------------------- | ------------------- | ------------------- |
| Scored / failed / retried                     | 64 / 0 / 0          | 64 / 0 / 0          |
| Grounded                                      | 64/64               | 64/64               |
| Band agreement                                | **52/52**           | **47/52**           |
| Spread across runs (mean / max)               | 1.8 / 9             | 2.2 / 12            |
| Citations of run 1                            | 263                 | 179                 |
| Citation review: supports / weak / irrelevant | 187 / 55 / 21       | 147 / 28 / 4        |
| Supports + weak                               | 92.0 %              | 97.8 %              |
| Output tokens (scoring)                       | 36.5k               | 59.4k               |
| Cost (64 scores + 8 extractions)              | $0.279              | $0.046              |

All 5 Luna misses are scores below the expected band (e.g. `02-senior-backend` on `backend-java` 86/74, `03-data-ml` on `data-ml` 70/73). Luna cites fewer and tighter units: fewer bare job titles and dates, and fewer score-0 contrary facts. The review was done by the main session with Checkpoint B's rules and spot-checked by Dude (20 borderline rows across this and the next review, all agreed).

### Scoring at scale (`eval`, 381 pairs per mode, the `baseline-units` sample)

| Metric (full_text / rag)                         | mini (`baseline-units`) | Luna (`luna-units`) |
| ------------------------------------------------ | ----------------------- | ------------------- |
| Failed scores                                    | 0 / 0                   | 0 / 0               |
| Spearman ρ vs rule                               | 0.936 / 0.940           | 0.942 / 0.939       |
| MAE vs rule                                      | 7.58 / 7.66             | **9.41 / 9.54**     |
| Mean signed error                                | +3.1 / +3.1             | **−8.0 / −8.3**     |
| Quadratic κ vs rule bands                        | 0.849 / 0.862           | 0.759 / 0.751       |
| Weighted MAE (population)                        | 6.60 / 6.23             | 6.62 / 6.64         |
| Weighted band agreement                          | 0.891 / 0.908           | 0.903 / 0.900       |
| Band κ vs Dude's 30 labels (rule vs Dude: 0.650) | 0.557 / 0.650           | **0.739** / 0.639   |
| Test-retest MAE (50 pairs scored twice)          | 4.46 / 3.62             | **2.06 / 2.52**     |
| Keyword stuffers, MAE (13 pairs)                 | 20.8 / 18.5             | **8.5 / 10.2**      |
| Ukrainian CVs, MAE (19 pairs)                    | 5.2 / 5.6               | 9.4 / 10.3          |
| GitHub-only tags credited (G4)                   | 0.974 / 0.987           | 0.842 / 0.895       |
| Citation review, supports + weak (40 per mode)   | 92.5 % / 90.0 %         | 95.0 % / 100 %      |
| Mean output tokens per score                     | 640 / 659               | 1074 / 1133         |
| Spend (862 scores)                               | $3.95                   | $0.66               |

Luna's errors are a constant offset, not noise: it ranks pairs as well as mini (ρ), repeats itself more closely (test-retest), and its population-weighted error is the same (the sample over-represents strong and partial pairs, where a −8 shift costs most). The shift moves pairs near a band edge into the lower band, which is what lowers κ against the rule and the Checkpoint B band agreement. Against Dude's own labels, Luna's full_text bands agree better than mini's and better than the rule itself. Luna also resists keyword stuffing (signed error −2.2 / −0.2 against mini's +19.3 / +17.3) and credits GitHub-only skills less readily.

**Ukrainian CVs are not a language-specific gap.** The slice MAE looks worse only because mini happens to have almost no bias there (−0.8 against +3.3 on the rest), so its error is unusually low. Luna is below the rule by about the same amount on Ukrainian and other CVs (full_text −9.4 vs −8.0, rag −10.3 vs −8.2), and below mini by about the same amount (−8.6 vs −11.3, rag −11.3 vs −11.3). With 19 pairs from 5 personas, the 1–2 point difference is within noise.

### Interview questions (`questions-eval`, the same 30 applications as `q2`)

| Metric                                            | mini (`q2`)  | Luna (`q-luna`) |
| ------------------------------------------------- | ------------ | --------------- |
| Ok / retried / failed                             | 30 / 0 / 0   | 30 / 0 / 0      |
| Questions per application (mean / min / max)      | 8.1 / 6 / 10 | 7.6 / 6 / 8     |
| Fact / gap                                        | 147 / 97     | 140 / 89        |
| Gap questions on a criterion scored below 50      | 85.6 %       | 100 %           |
| Fact questions citing a unit the score also cited | 79.6 %       | 79.3 %          |
| Hypothetical gap questions                        | 0            | 0               |
| Sets with more than 8 questions                   | 5            | 0               |
| Output tokens                                     | 22.0k        | 51.8k           |
| Cost                                              | $0.146       | $0.032          |

Luna follows the prompt more literally: every set is within 6–8, every gap question targets a low-scored criterion, and almost every gap question uses the "have you…? if not, what is your closest experience…" pattern, which reads as formulaic. The questions were not labelled by hand.

## Decision rule

| Condition                                             | Result                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `eval` ρ ≥ mini − 0.02                                | pass (0.942 / 0.939)                       |
| `eval` MAE ≤ mini + 1.0                               | **fail** (+1.8 / +1.9)                     |
| `eval` failed scores ≤ 1 %                            | pass (0)                                   |
| Citation review ≥ 90 %                                | pass (95.0 % / 100 %; Checkpoint B 97.8 %) |
| Checkpoint B no worse than mini by > 1 pair           | **fail** (band agreement 47 vs 52)         |
| Questions: 30/30, gap-below-50 ≥ 80 %, 0 hypothetical | pass                                       |

Luna is not "comparable" under the rule, so `gpt-5.4-mini` stays the default. Both failures come from the same −8 calibration offset. A scoring prompt calibrated for Luna might remove it; that is a separate experiment (Checkpoint B on Luna costs about $0.05).

## Cost

Measured cost per call at the listed prices: full_text score $0.0043 (mini) vs $0.0007 (Luna), rag score $0.0048 vs $0.0008, question set $0.0049 vs $0.0011, CV parse $0.0028 vs $0.0005. Luna writes 1.6–2.4× the output tokens, so its saving is 5–6×, less than the 7.5× / 9× per-token price ratio. This comparison cost $1.02: Checkpoint B $0.279 (mini) + $0.046 (Luna), `eval` $0.664, `questions-eval` $0.032.

## Limits

- One run per model for `eval` and questions (Checkpoint B: 2 runs). The 50 repeated pairs give the run-to-run noise.
- Prompts were tuned on mini.
- Luna scored with criteria mini extracted (seeded DB) and generated questions from mini's scores; an end-to-end Luna pipeline (re-seed) was not run.
- Synthetic data; the rule is the reference, and a human agreed with it at κ 0.65.
- Citation reviews were done by the main session with a 20-row human spot-check; the Luna questions were not labelled.
