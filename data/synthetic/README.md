# Synthetic data set (Stage 2 step 10)

100 fictional developer personas, 10 vacancies and the ground truth for every persona × vacancy pair. Step 11's eval and `npm run db:seed` read it. Everything here is fictional: names come from first/last name lists, emails are `@example.com`, employers and GitHub accounts (`synth-<slug>`) don't exist.

Design and decisions: `docs/plans/stage-2-step-10.md`. Results (generation, spot-check, seed): `docs/eval/synthetic-data.md`.

## Files

| File                     | Made by                             | Content                                                                                                     |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `taxonomy.json`          | hand-written                        | Skill tags with aliases; short or ambiguous aliases (`Go`, `R`, `C`) flagged for case-sensitive matching    |
| `vacancies.draft.json`   | hand-written                        | The 10 vacancies' structure: requirement ids, `must`/`nice`, tags, `minYears`                               |
| `vacancies.json`         | `synth vacancies` (LLM)             | The same vacancies with LLM-written title, intro and requirement text; ids, kinds, tags and years unchanged |
| `personas.json`          | `synth personas` (code)             | 100 persona specs: career timeline, skills with years and evidence placement, GitHub username, `applyTo`    |
| `cvs/<id>.json`          | `synth cvs` (LLM, drift-checked)    | CV prose written from the spec                                                                              |
| `cvs/<id>.html`, `pdf/`  | `synth render` (code, Chromium)     | The CV rendered with one of `templates/` (`1-col`, `2-col`, `compact`) and printed to PDF                   |
| `github/<username>.json` | `synth github` (LLM, drift-checked) | A GitHub API-shaped fixture (user, repos, READMEs) for the 40 personas with a profile                       |
| `ground-truth.json`      | `synth labels` (code)               | All 1000 pairs: score 0–100, band, per-requirement status                                                   |
| `queries.json`           | hand-written + `synth labels`       | 20 search queries with required tags; relevant and partially relevant persona ids computed by the rule      |
| `generation-log.json`    | every LLM stage                     | Calls, tokens, retries, drift failures and warnings, cost per run                                           |
| `spot-check/`            | `synth spot-check`                  | The blind 30-pair sample, Dude's labels and the agreement with the rule                                     |

## How the labels are made

No LLM judges fit. Code builds each persona spec (roles with dates and the tags used in each, so skill years are summed role durations), and a fixed rule scores each pair from the spec:

- a requirement is **met** (1) when the persona has one of its tags evidenced in a role, a project or GitHub, with enough years;
- **partial** (0.5) when the years are short or the tag only appears in the skills list;
- **not met** (0) otherwise.

Score = `round(100 × Σ w·v / Σ w)` with must-haves weighted 2 and nice-to-haves 1. Bands: strong ≥ 75, partial 40–74, weak < 40.

The LLM only writes prose from the spec. A drift check rejects CV or GitHub text that drops a tag, places it in the wrong section, puts a `github_only` skill in the CV, or mentions a taxonomy skill the persona doesn't have; the call is retried with the problems as feedback. A blind human spot-check of 30 pairs agreed with the rule at κ = 0.65.

## Regenerating

From the repo root. Every LLM stage skips outputs that already exist (`--force` regenerates), logs to `generation-log.json` and stops at `--max-usd` (default $2). `--dry-run` prints the estimate only. Rendering needs Chromium (`CHROMIUM_BIN`, default `chromium`).

```bash
npm run synth -w apps/api -- personas --seed 1   # specs, no LLM
npm run synth -w apps/api -- vacancies           # LLM prose for the 10 vacancies
npm run synth -w apps/api -- cvs                 # LLM CV prose, drift-checked
npm run synth -w apps/api -- github              # LLM GitHub fixtures, drift-checked
npm run synth -w apps/api -- render              # HTML + PDF, extraction-checked
npm run synth -w apps/api -- labels              # ground truth + query relevance, no LLM
```

Spot-check (blind; the page never shows the rule's band until you score):

```bash
npm run synth -w apps/api -- spot-check --sample 30 --seed 1
npm run synth -w apps/api -- spot-check --ui      # label at http://127.0.0.1:4321
npm run synth -w apps/api -- spot-check --score   # or the Score button in the page
```

The first full generation cost about $0.71 (third-party `gpt-5.4-mini` prices). Regenerating the prose gives different text and can change what the scorer sees, but not the labels, which depend only on the specs.

## Seeding a database

See the README's "Seed the synthetic data" section. In short: `npm run db:seed -- --dry-run`, then `npm run db:seed -- --label <name>` against a fresh database. The seed serves GitHub data from `github/` (`GITHUB_FIXTURES_DIR`), so it never calls GitHub.
