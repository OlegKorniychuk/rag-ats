# Stage 2 · Step 10 — Synthetic data plus seed

Parent roadmap: `docs/plans/stage-2.md`, Part D, Step 10. Branch: `feat/synthetic-data` off `main` (#38 merged).

## Context

Step 11 needs a labelled set to measure retrieval (precision/recall@k for search and matches) and score agreement (Spearman, MAE; full_text vs rag). The SPEC asks for about 100 fully synthetic dev CVs with GitHub-style profiles, 10 vacancies and self-labelled ground truth, loaded through the real apply pipeline. Checkpoint C also left two quality gaps for step 11 to measure (G4: full_text ignores GitHub evidence; G5: Find matches false positives), so the set must contain cases that expose them.

Dude's decisions:

- **Ground truth is built from specs, not judged by an LLM.**
  - Code writes a structured persona spec (career timeline, skills, where each skill is evidenced). Vacancies have tagged requirements. A fixed rule computes the label of every pair.
  - The LLM only writes the CV prose and GitHub repo text from the spec. A drift check rejects text that adds or drops skills.
  - Dude blind-labels about 30 pairs to measure how well the rule matches human judgement.
- **The seed applies each candidate to 2–3 vacancies** (about 250 applications). Everyone else stays in the pool, so Find matches has something to find. Step 11 scores all 1000 pairs in memory for agreement.
- **A fixture GithubClient** serves the synthetic profiles when `GITHUB_FIXTURES_DIR` is set. The real parse → GitHub → embed → score path runs unchanged, and it never touches the network.

## Architecture decisions

### No contract change

`packages/shared/src/api.ts` is untouched. The only runtime change is the optional `GITHUB_FIXTURES_DIR` env var.

### Data layout (`data/synthetic/`, committed)

| File                                         | Produced by                   | Content                                                                                                                 |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `taxonomy.json`                              | hand-written                  | ~80 skill tags with aliases (`postgresql: ["PostgreSQL", "Postgres"]`); short or ambiguous aliases flagged              |
| `vacancies.json`                             | `synth vacancies`             | 10 vacancies: title, intro, `requirements[]` (`id`, `text`, `kind: must \| nice`, `tags[]`, `minYears?`), rendered text |
| `personas.json`                              | `synth personas`              | 100 specs (below) plus `applyTo` vacancy ids                                                                            |
| `cvs/<id>.json`, `cvs/<id>.html`, `<id>.pdf` | `synth cvs`, `synth render`   | LLM-written CV content, the rendered HTML and the PDF                                                                   |
| `github/<username>.json`                     | `synth github`                | Fixture in GitHub API response shape: user, repos, READMEs                                                              |
| `ground-truth.json`                          | `synth labels`                | All 1000 pairs: score 0–100, band, per-requirement status                                                               |
| `queries.json`                               | hand-written + `synth labels` | ~20 NL search queries with required tags; relevant candidate ids computed                                               |
| `generation-log.json`                        | every LLM stage               | Calls, tokens and cost per stage                                                                                        |
| `spot-check/`                                | `synth spot-check`            | Blind sample for Dude, his labels, and the agreement result                                                             |
| `README.md`                                  | main session                  | How the set was produced and how to regenerate it                                                                       |

About 6 MB in all (100 PDFs at roughly 55 KB each, like the Checkpoint A PDFs).

### Persona spec (code, seeded RNG, no LLM)

- **Identity**: a fictional name drawn from first and last name lists, `<slug>@example.com`, language (`en`, plus about 5 `uk`), layout (`1-col`, `2-col`, `compact`).
- **Career timeline in code**: roles with a fictional employer, title, start/end month and the tags used in that role. Skill years = the summed duration of the roles that use the tag. The LLM never invents dates or years.
- **Skills**: `{ tag, years, evidence }`, where `evidence` is one of:
  - `cv_role`: in a role's bullets;
  - `cv_project`: in a named project;
  - `cv_skills_only`: listed in the skills section with no supporting text (keyword stuffing);
  - `github_only`: only in GitHub repos, absent from the CV. This probes G4.
- **GitHub**: about 40% of personas have a profile, username `synth-<slug>`.
- **Population**:
  - for each vacancy, 4 personas targeted at strong and 4 at partial (80 in all);
  - 20 off-target personas: career switchers, bootcamp juniors, adjacent roles, 3 keyword stuffers and 2 prompt-injection CVs (as in Checkpoint A).
  - Targets only guide sampling. The label is always recomputed by the rule, so cross-fits (a full-stack persona that's partial for Frontend) come out naturally.
- **`applyTo`**: the persona's target vacancy plus 1–2 random others (any band), so boards show a realistic mix. Off-target personas apply to 1–2 random vacancies.
- **Distribution guard**: every vacancy must end with ≥ 5 strong and ≥ 8 partial pairs by the rule. Otherwise the generator re-samples with the next seed.

### Ground-truth rule (`synth labels`)

- A requirement is **met** (1) when the persona has one of its tags with evidence `cv_role`, `cv_project` or `github_only`, and years ≥ `minYears`.
- It is **partial** (0.5) when the tag is present but years < `minYears`, or the only evidence is `cv_skills_only`.
- Otherwise it is **not met** (0).
- Score = `round(100 × Σ w·v / Σ w)`, with `must` weighted 2 and `nice` weighted 1. Bands follow Checkpoint B: strong ≥ 75, partial 40–74, weak < 40.
- **Matches relevance** (step 11): for each vacancy, pool candidates in the strong band are relevant, and partial counts as graded relevance.
- **Search relevance**: a query's relevant set is every persona meeting all of its tags (`cv_skills_only` counts as partial).

### LLM stages (`gpt-5.4-mini`, structured outputs via `LlmClient.parseStructured`)

- **Vacancies**: one call per vacancy from a role brief (frontend, backend Java, backend Node, full-stack, data engineering, ML, platform/DevOps, mobile, QA automation, security). Requirement `tags` are a schema enum over the taxonomy. Overlapping roles are on purpose. The main session reviews all 10.
- **CVs**: one call per persona.
  - Input: the spec with roles, tags per role, project names and evidence placement.
  - Output: a summary, bullets per role, projects, education and a skills list.
  - Rules: mention exactly the given tags, in the given places; no other technologies from the taxonomy; no real companies or people.
  - Injection personas get the Checkpoint A injection text added verbatim by code, not by the LLM.
- **GitHub**: one call per persona with a profile: a bio, 3–8 repos (name, description, language, topics, README excerpt) covering its `github_only` and some CV tags.
- **Drift check (code)** after each CV/GitHub call. Alias matching uses word boundaries, and the flagged short aliases (`Go`, `R`, `C`) match case-sensitively and only in tech contexts.
  - Every `cv_*` tag appears in its intended section.
  - Every `github_only` tag is absent from the CV and present in the repos.
  - No taxonomy tag that the persona lacks appears anywhere (leak check).
  - On failure: retry with the problems as feedback (up to 2 retries). After that, re-sample that persona's prose seed. The spec is never changed to fit the text.
- **Caching**: every stage skips outputs that already exist, so a run can be resumed and stays cheap. `--force <ids>` regenerates. `--max-usd` (default $2) stops before the next call once the estimated spend reaches the cap.

### Rendering (`synth render`)

Three HTML templates (one column, two column with sidebar, compact) in `data/synthetic/templates/`. All text is escaped. Headless Chromium prints the PDFs (`CHROMIUM_BIN`, default `chromium`), reusing the Checkpoint A approach. Each PDF is checked with the production `CvTextExtractor`: readable, and every `cv_*` tag alias survives extraction. A failure flags the persona for a template change and isn't silently skipped.

### Fixture GitHub client (`apps/api/src/github/`)

- `FixtureGithubClient extends GithubClient` overrides `getUser`, `listOwnerRepos` and `getReadme` to read `<dir>/<username>.json`. An unknown username → `GithubNotFoundError`. It makes no network call.
- The username is already validated by `parseGithubUsername`. The resolved path must also stay inside the directory.
- `GithubModule` provides it when `EnvConfig.GITHUB_FIXTURES_DIR` is set. Boot fails when it's set with `NODE_ENV=production`, and the app logs one warn line at startup.
- The seed sets it itself. Dude can set it in `.env` for the dev server, so a reparse of a seeded candidate keeps their GitHub data.

### Seed (`npm run db:seed -w apps/api`, `src/scripts/seed.ts`)

- Boots `NestFactory.createApplicationContext(AppModule)` against `DATABASE_URL`, with the jobs running in-process like the dev server. `GITHUB_FIXTURES_DIR` is forced to `data/synthetic/github`.
- Steps:
  1. Ensure the recruiter `seed@example.com` exists (`AuthService.register`). The password comes from `SEED_RECRUITER_PASSWORD` or a documented dev default, and is never printed.
  2. Create the 10 vacancies via `VacanciesService.create`, skipping any whose title already exists for the seed recruiter, and wait until their criteria are extracted.
  3. For each `applyTo` pair, call `ApplyService.submit(token, dto, file)` with a Multer-shaped file built from the PDF. Concurrency is capped at 4. A `ConflictException` (already applied) counts as done, so a re-run resumes.
  4. Wait until every seeded candidate is `parsed` or `failed`, embedded, and every score is `scored` or `failed`, by polling the DB with a timeout.
  5. Print and write `docs/eval/seed/<label>.{json,md}`: parse success (the ≥ 90% SPEC criterion), embedded, scored and failed counts, the scoring mode, tokens and cost.
- **Budget guard**:
  - `--dry-run` prints the call counts and an estimate from the measured unit costs (a parse ≈ $0.0028, a score ≈ $0.0053, a criteria extraction, embeddings), with a 1.3× margin, and makes no calls.
  - A live run requires `--max-usd` (default $3). A metering `LlmClient` (subclass provided via override) sums the real usage. Before each submit, spend plus the estimated cost of the queued work must stay under the cap. Otherwise it stops submitting, drains and reports `stopped: budget`.
- `--only <persona ids>` seeds a subset, which is used for the live smoke.
- `SCORING_MODE` is taken from env as usual. The report records it.

### Spot-check (`synth spot-check`)

- `--sample 30 --seed N` writes `spot-check/sample.md`: CV text plus vacancy text per pair, stratified across bands, with no label shown. Dude fills `spot-check/labels.json` with a band per pair.
- `--score` computes exact band agreement, Cohen's κ and the confusion matrix against the rule, and writes `spot-check/agreement.md`.
- A low κ means the rule or the generation is off. Fix whichever is wrong, then re-run before seeding.

### Cost estimate (third-party `gpt-5.4-mini` prices, as in Checkpoints A–C)

| Stage                          | Calls    | Estimate |
| ------------------------------ | -------- | -------- |
| Vacancies                      | 10       | ~$0.05   |
| CVs (incl. retries)            | ~130     | ~$1.00   |
| GitHub profiles                | ~45      | ~$0.25   |
| Seed parses + criteria + embed | 100 + 10 | ~$0.35   |
| Seed scores (~250)             | ~260     | ~$1.40   |
| **Total**                      |          | **~$3**  |

The SPEC asks to check with Dude before "any single script run likely to burn a large fraction of the $20 budget". Each run is capped at $2–3, so no single run qualifies, but the live generation and the live seed still each get a go-ahead (see the checkpoints below).

## Tests

- **Unit**:
  - ground-truth rule: met/partial/not, `minYears`, `cv_skills_only`, weights, band edges;
  - persona generator: same seed → same output; years summed from the timeline; the distribution guard; `applyTo` size; off-target mix;
  - drift check: word boundaries, case-sensitive short aliases, `github_only` absence, leak detection;
  - prompt builders and schemas: the tag enum, injection text added by code;
  - renderer: escaping, all three layouts;
  - `FixtureGithubClient`: reads a fixture, 404 for an unknown user, no path escape, matches the real fetcher's snapshot shape;
  - seed planner and cost estimator: pairs, skipping already-applied pairs, the cap decision;
  - spot-check: stratified sampling, κ.
- **Integration** (testcontainers, OpenAI mocked with MSW):
  - the env picks `FixtureGithubClient` in `GithubModule`, and boot fails in production;
  - the seed core on a 3-persona mini set: candidates end up parsed, embedded and scored, with GitHub data from the fixture; a re-run is a no-op; a tiny `--max-usd` stops submitting and reports it.
- **No new e2e**: the seed drives the services the apply e2e already covers.

## Task list

Sonnet subagents do Tasks 1–5. The main session reviews each task, re-runs the tests, does the live generation, the review and the seed, and writes the docs inline (Task 6).

- **Task 1 — Foundations (M)**: `taxonomy.json`, spec types, persona generator, ground-truth rule, `queries.json` relevance, `synth personas` and `synth labels` stages (no LLM), unit tests. _Verify_: build, lint, unit; `synth personas` + `synth labels` produce the files and the distribution guard passes.
- **Task 2 — LLM generation (M)**, after Task 1: vacancy, CV and GitHub prompts and schemas, the drift check with its retry loop, caching, `--max-usd`, `generation-log.json`, unit tests. _Verify_: build, lint, unit, `--dry-run`.
- **Task 3 — Render and spot-check (S)**, after Task 1, in parallel with Task 2: templates, Chromium render, the extraction check, `synth spot-check` sample and score, unit tests. _Verify_: build, lint, unit; render a hand-written sample spec.
- **Task 4 — Fixture GitHub client (S)**, independent: client, env var, module wiring, the production guard, unit and integration tests, `.env.example`. _Verify_: build, lint, unit, integration.
- **Task 5 — Seed (M)**, after Task 4: `seed.ts`, planner, metering client, budget guard, drain, report, `db:seed` scripts (api and root), integration test. _Verify_: build, lint, unit, integration twice; `--dry-run`.

### Checkpoint: Live generation (main, ask Dude first)

- `synth vacancies` → review all 10 (overlap, tags, realistic text).
- `synth cvs --only` 5 personas (one per layout and evidence kind, one `uk`, one injection) → read them, then the rest. `synth github`, `synth render`, `synth labels`.
- Read a sample of 10 PDFs as text against their specs. Report drift-check retries and failures, the band distribution per vacancy, and the cost.

### Checkpoint: Dude's spot-check

- `synth spot-check --sample 30` → Dude labels blind → `--score`. Agree on the threshold before seeding (proposal: κ ≥ 0.6). If it's lower, find whether the rule or the prose is wrong, fix it, regenerate the affected part, and re-check.

### Checkpoint: Live seed (main, ask Dude first)

- `db:seed --dry-run`, then `--only` 3 personas on a fresh DB (`rag_ats_seed`), then the full seed with `--max-usd 3`.
- In the browser (seed recruiter): 10 vacancies, boards with scored applicants, the pool shows 100 candidates, search returns snippets, Find matches lists non-applicants, and a GitHub-only candidate's profile shows the fixture repos.
- **Done when**: 100 candidates are parsed and scored in the UI with ≥ 90% parse success.

### Task 6 — Docs (main, inline)

- `data/synthetic/README.md`.
- `docs/eval/synthetic-data.md`: generation stats, drift-check results, band distribution, spot-check agreement, seed report, cost.
- `docs/sdd.md`: status and §3, §8 decisions (spec-built ground truth, the fixture client, the seed budget guard), §9 `GITHUB_FIXTURES_DIR` and seed vars, §11 tests and eval, §12 limits.
- README: the seed walkthrough.
- `docs/plans/stage-2.md`: mark the step 10 open question resolved.

### Checkpoint: Complete

- CI-equivalent run locally, then `npx prettier --check .` last (the generated JSON and Markdown).
- Ask for commit approval: plan / generator + data / fixture client / seed / docs.
- Push, open the PR "Stage 2 step 10: synthetic data and seed", and watch CI.

## Risks

| Risk                                                                          | Impact | Mitigation                                                                                                                          |
| ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| The LLM adds or drops skills, so the rule's label no longer matches the CV    | High   | Drift check with leak detection, retries with feedback, and the spot-check κ as an independent measure                              |
| Synthetic CVs are too clean or uniform, which inflates step 11's numbers      | Med    | Three layouts, `uk` CVs, keyword stuffers, injection, career switchers, `github_only` evidence; the limitation is written up in §12 |
| A rule-based label disagrees with how a human (or the scorer) weighs evidence | Med    | That's what the spot-check measures; step 11 reports agreement against both the rule and Dude's labels                              |
| Short aliases (`Go`, `R`, `C`, `Rust` in prose) give false drift hits         | Med    | Flagged aliases are case-sensitive and context-restricted; the unit tests cover them                                                |
| A Chromium render loses text in a layout                                      | Low    | Every PDF goes through the production extractor before it's accepted                                                                |
| A seed run drains the budget through retries or a bug                         | Med    | Dry-run first, a hard `--max-usd`, `--only` smoke, resumable re-runs                                                                |
| The fixture client is left on by accident outside a demo                      | Low    | Refused in production, a warn log at startup, and it only serves files from the configured directory                                |

## Out of scope

- The eval harness, metrics and report (step 11).
- Fixing G4 and G5 (step 11 measures them first).
- Seeding through HTTP, multiple recruiters, or more than 100 candidates.
- Real CVs or real GitHub accounts.
