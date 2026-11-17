# Synthetic data and seed (Stage 2 step 10)

Stage 2 roadmap step 10 (`docs/plans/stage-2.md`, plan `docs/plans/stage-2-step-10.md`). It builds the labelled set that step 11's eval measures against, checks the labels with a blind human spot-check, and loads the set through the real apply pipeline. The data and how to regenerate it: `data/synthetic/README.md`.

**Outcome:**

- **Data set**: 100 personas (95 `en`, 5 `uk`; three PDF layouts; 40 with a GitHub profile), 10 vacancies, ground truth for all 1000 pairs, 20 search queries with relevance sets. Labels come from the persona specs by a fixed rule; no LLM judges fit.
- **Generation**: $0.71 in all; every CV and GitHub fixture passed the drift check (53 CV retries over 170 calls); all 100 PDFs passed the extraction check.
- **Spot-check**: Dude labelled 30 pairs blind. Agreement with the rule: 76.7% exact, **κ = 0.65** (threshold 0.6), quadratic κ 0.83. No strong ↔ weak disagreement.
- **Seed**: 100/100 CVs parsed (**100%**, SPEC criterion ≥ 90%), 100 embedded, **230/232 applications scored** after two `--retry-failed` runs. Seed cost $1.92, generation plus seed $2.63 (third-party `gpt-5.4-mini` prices, unverified).
- **Grounding**: about 21% of first scorer answers failed quote verification; the scorer's built-in feedback retry brought that to 4.7% (11/232), `--retry-failed` to 0.9% (2/232). This motivates step 12 (cite evidence by ID).
- **Browser check**: 10 vacancies, ranked boards with the failed score shown, 100 candidates in the pool, search with snippets, Find matches listing non-applicants, GitHub fixture repos on the candidate page.

## Data set

### Personas

| Group                                       | Count | Purpose                                                          |
| ------------------------------------------- | ----: | ---------------------------------------------------------------- |
| Targeted (4 strong + 4 partial per vacancy) |    80 | Enough strong and partial pairs per vacancy for precision/recall |
| Adjacent role                               |     5 | Near misses                                                      |
| Bootcamp junior                             |     5 | Right stack, too few years                                       |
| Career switcher                             |     5 | Non-tech roles first, then a short dev career                    |
| Keyword stuffer                             |     3 | Skills listed with no supporting text (`cv_skills_only`)         |
| Prompt injection                            |     2 | The Checkpoint A injection text, added by code in hidden text    |

Targets only guide sampling; every pair's label is recomputed by the rule, so cross-fits (a full-stack persona that is partial for Frontend) come out naturally.

Skill evidence placements over all personas: 1253 in role bullets (`cv_role`), 85 in projects (`cv_project`), 83 only in the skills list (`cv_skills_only`), 50 only on GitHub (`github_only`, which probes Checkpoint C's gap G4).

Each persona applies to its target vacancy plus 1–2 others: 232 applications (43 strong, 58 partial, 131 weak by the rule). Everyone else stays in the pool for Find matches.

### Ground-truth bands per vacancy (all 1000 pairs)

| Vacancy          | Strong | Partial | Weak |
| ---------------- | -----: | ------: | ---: |
| frontend         |      5 |      20 |   75 |
| backend-java     |      6 |      16 |   78 |
| backend-node     |      6 |      20 |   74 |
| full-stack       |      7 |      25 |   68 |
| data-engineering |      7 |       9 |   84 |
| ml               |      5 |      11 |   84 |
| platform-devops  |      7 |      13 |   80 |
| mobile           |      7 |      19 |   74 |
| qa-automation    |      5 |      18 |   77 |
| security         |      7 |      10 |   83 |

The distribution guard (≥ 5 strong and ≥ 8 partial per vacancy) holds everywhere.

## Generation

| Stage     | Runs | Calls | Retries | Input / output tokens |       Cost |
| --------- | ---: | ----: | ------: | --------------------- | ---------: |
| vacancies |    3 |    45 |      15 | 34.4k / 10.9k         |     $0.075 |
| cvs       |    7 |   170 |      53 | 174.3k / 82.1k        |     $0.500 |
| github    |    1 |    43 |       3 | 27.3k / 25.0k         |     $0.133 |
| **Total** |      |   258 |      71 |                       | **$0.708** |

- **Vacancies**: in the first run 3 of 10 failed the check that every requirement names its tool (e.g. the Java vacancy left out "Hibernate"); the next run produced all 10.
- **CVs**: retries are drift-check feedback rounds (a tag missing from its section, or a skill the persona lacks). Five personas exhausted their retries in a run (one of them twice) and were regenerated in a later one; none was skipped. 17 personas carry a non-blocking warning: a tag the spec has in one role is also mentioned in another role's bullets (e.g. "Kafka is mentioned in role 4, which does not list it"). That can make the CV look more experienced than the spec, which the rule doesn't see.
- **GitHub**: 40 fixtures, 3 retries.
- **Render**: 100 PDFs (4.9 MB), 34 one-column, 33 two-column, 33 compact. Every PDF was read back with the production `CvTextExtractor`, and every CV tag survived extraction.

## Spot-check

Dude labelled a stratified sample of 30 pairs (10 per rule band) blind, from the vacancy and CV text, in the `synth spot-check --ui` page. Result (`data/synthetic/spot-check/agreement.md`):

| Rule \ Dude | strong | partial | weak |
| ----------- | -----: | ------: | ---: |
| strong      |      7 |       3 |    0 |
| partial     |      1 |       6 |    3 |
| weak        |      0 |       0 |   10 |

- Exact agreement 76.7% (23/30), Cohen's κ 0.650, quadratic κ 0.829. The agreed threshold was κ ≥ 0.6, so the labels were accepted without changes.
- Weak agreed 10/10, and no disagreement was two bands apart.
- In 6 of the 7 disagreements Dude was stricter than the rule (strong → partial on pairs 12, 19, 22; partial → weak on 5, 11, 23), including rule scores of 88 and 100 that Dude called partial. The rule is somewhat generous near the band boundaries: a tag in a role counts as fully met regardless of how prominent it is. Step 11 reports scorer agreement against both the rule and these labels.

## Seed

`npm run db:seed` against a fresh database (`rag_ats_seed`), scoring mode `full_text`. Reports: `docs/eval/seed/`.

| Run (`--label`) | Scope                        | Scored after the run | Failed | Duration |   Cost |
| --------------- | ---------------------------- | -------------------: | -----: | -------: | -----: |
| `smoke`         | 3 personas, 7 applications   |                  6/7 |      1 |     39 s | $0.057 |
| `full`          | the remaining 97, resumed    |              221/232 |     11 | 11.5 min | $1.743 |
| `full-retry`    | `--retry-failed` (11 scores) |              228/232 |      4 |     65 s | $0.093 |
| `full-retry-2`  | `--retry-failed` (4 scores)  |              230/232 |      2 |     25 s | $0.027 |

- **Dry-run estimate** for the whole set was $1.54 ($2.00 with the 1.3× margin); the actual smoke plus full spend was $1.80. Scoring is about 80% of the cost.
- **Parses**: 100/100, no failures. The 5 Ukrainian CVs and both injection CVs parsed normally.
- **Injection**: the injection personas' scores were not inflated (e.g. the off-target injection persona scored 15 against a rule score of 18 for QA Automation).

### Score failures

The scorer gets one feedback retry per job when its quotes don't verify. In the `full` run it made 272 calls for 225 new applications, so about 47 scores (21%) needed that retry, and 10 of them failed it too (11 with the smoke run's). The causes recorded in `failure_details` for the 11, from the last attempt:

| Cause                                    | Count | Example                                                                                         |
| ---------------------------------------- | ----: | ----------------------------------------------------------------------------------------------- |
| A criterion scored above 0 with no quote |     5 | Plus one combined with a paraphrase                                                             |
| Paraphrased CV quote                     |     2 | "Validated exposed paths through Penetration testing." for "…validating exposed paths through…" |
| GitHub quote not verbatim                |     3 | A README bullet quoted with a full stop it doesn't have; an invented "Repository: <url>" label  |
| Quote too short                          |     1 | `"C"` (the C language) under the 2-character minimum                                            |

`--retry-failed` re-queues failed scores through the same path as the Rescore button. Two runs recovered 9 of 11. The two left:

- **Jonas Petrov × QA Automation**: all three attempts quoted the README bullet "Notes for handoffs and changes across an Agile workflow" with an added full stop. Systematic, not random.
- **Samuel Holm × Mobile**: a different misquote each time ("working in" glued onto a real fragment, then a sentence fragment that isn't in the CV).

The verifier caught every one of these, so no ungrounded score was stored. They are model copying errors, not evidence problems, which is the case for step 12: citing evidence units by ID makes a quote verbatim by construction.

## Browser check

The dev API and web app ran against `rag_ats_seed`, logged in as `seed@example.com` (Claude in Chrome):

- **Vacancies**: all 10, open.
- **Board** (Mobile Engineer): 26 applicants ranked by score (100 down to 0), Samuel Holm's card shows "Score failed".
- **Candidate page** (Elena Osei): three applications with their scores, including the one recovered by `--retry-failed`; the GitHub section shows the `synth-elena-osei` fixture repos.
- **Pool**: "100 candidates". Search "mobile developer with Flutter and Kotlin" returned 19 matches; the top ones are mobile developers, with CV snippets.
- **Find matches** (Mobile Engineer): the top suggestion, Daniel Alvarez, isn't an applicant, matched 8 of 10 criteria, with per-criterion evidence.

## Limitations

- **The rule is generous at band boundaries** (spot-check above) and blind to emphasis: one role bullet that names a tag counts as fully met.
- **Some CVs mention tags in more roles than the spec**: 17 personas, non-blocking drift warnings. A human or the scorer may credit more years than the rule does.
- **Four persona names repeat** (Kwame Silva, Ananya Banerjee, Mateo Fischer, Pavel Hartmann): the emails differ (`-2` suffix), but two cards with the same name can sit on one board.
- **Only 232 of 1000 pairs are scored in the database**; step 11 scores all 1000 in memory for agreement.
- **2 applications have no score**, so step 11's agreement over the seeded applications covers 230.
- **Prices** are third-party figures for `gpt-5.4-mini`, as in Checkpoints A–C.
- **One reviewer**: the spot-check is Dude alone, 30 pairs.

## Next

- **Step 11**: retrieval precision/recall@k for search (`queries.json`) and Find matches, score agreement against the rule and the spot-check labels for `full_text` and `rag`, and the grounding failure rate as the baseline for step 12.
- **Step 12**: cite evidence by ID instead of quoting (`docs/plans/stage-2.md`, Part E).
