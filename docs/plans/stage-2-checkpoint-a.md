# Stage 2 · Checkpoint A — live CV parse quality and cost check

On approval this plan is saved as `docs/plans/stage-2-checkpoint-a.md` and committed with the first commit.

## Context

Steps 1–3 deliver CV upload, async LLM parsing and GitHub enrichment (PR #28). The roadmap's Checkpoint A says: before scoring starts, parse 5–10 varied CVs live, log tokens and cost, and make sure profile quality is acceptable.

The step 2 smoke test found these quality gaps (sdd §12):

- `experience` is terse;
- duties are sometimes listed as `projects`;
- job roles sometimes land in `skills`.

The prompt and schema have never been tuned, and there is no repeatable way to measure them.

Dude's choices:

- a **synthetic, varied CV set** (no personal data, committed);
- **measure, then tune the prompt** (prompt and schema `.describe()` only, no contract change);
- a **reusable script plus a written report**.

Outcome: a committed CV set, a `parse-eval` script, a baseline vs tuned report in `docs/eval/`, and a tuned prompt.

## Architecture decisions

- **Branch:** `feat/checkpoint-a` off `main` once #28 is merged. If it isn't merged yet, branch off `feat/github-enrichment` and rebase later.
- **CV set:** `data/checkpoint-a/`.
  - It holds 8 fictional CVs as HTML sources (committed), the PDFs rendered from them (committed), and `manifest.json`.
  - Rendering is a one-off: `render.sh` uses headless `chromium --print-to-pdf`, which is already installed. No new npm deps.
  - Coverage: junior frontend (1-col); senior backend (2-col); data/ML; DevOps; mobile; career switcher (teacher → dev, to test roles leaking into `skills`); a Ukrainian-language CV; a CV with a planted prompt-injection line.
  - Two of them carry GitHub URLs of well-known public OSS accounts.
  - Each manifest entry: `file`, optional `githubUrl`, plus light expectations:
    - `mustHaveSkills`
    - `forbiddenInSkills` (job titles, soft phrases)
    - `expectedProjects` (keywords)
    - `expectedEmployers` (must appear in `experience`)
- **Eval script, `parse-eval`:** it lives in `apps/api/src/scripts/parse-eval.ts`, so `nest build` compiles it, and runs as `npm run parse-eval -w apps/api -- --label baseline --runs 2`.
  - It reuses the real pieces with no DB, server or queue: `CvTextExtractor`, `GithubProfileFetcher`/`GithubClient`, and `CvProfileParser` with a real `LlmClient`.
  - Token usage is captured by wrapping `LlmClient.parseStructured`, so no production signature changes.
  - Env is loaded and validated the same way the app does it (`EnvConfig`). The key is never printed.
  - Per CV and run, it records the extracted text length, the GitHub status, the profile, the usage, and whether each manifest check passed.
  - Output goes to `docs/eval/checkpoint-a/<label>.json` and a markdown summary with:
    - a per-CV table of checks passed, input/output tokens and cost;
    - totals;
    - the full profiles in collapsible sections.
  - Pricing comes from flags, defaulting to **$0.75 / $4.50 per 1M input/output tokens for `gpt-5.4-mini`**. That's the third-party listed price; OpenAI's own page wasn't checked, so the report says so.
  - Check logic, cost math and report rendering are pure functions with unit specs. The live run itself is never part of CI.
- **Tuning scope:** only `llm/prompts/cv-profile.prompt.ts` and the `.describe()` texts in `llm/cv-profile.schema.ts`. Field types and `api.ts` stay as they are.
  - Targets:
    - `experience` becomes one line per role: title, company, dates and 1–2 key achievements;
    - `projects` holds named projects only, never generic duties;
    - `skills` holds technologies, tools and methods only, never job titles or soft-skill phrases;
    - dedupe skills between the CV and GitHub.
  - The existing exact-match prompt specs are updated to match.
- **Execution split** (per memory):
  - Sonnet subagents handle Tasks 1 and 2, the code-heavy ones.
  - The main session handles the live runs, quality review, tuning iterations and all docs, since tuning needs fast run → read → adjust loops.
- **Budget:** about 8 CVs × 2 runs × (baseline plus up to 3 tuning rounds) × about 2.5k tokens is about 200k tokens, under $0.25. GitHub calls are about 10 per run, fine without a token.

## Task list

### Task 1: Synthetic CV set (Sonnet)

- 8 HTML CVs with realistic content, varied layouts (1-col and 2-col, tables, a skills sidebar), and fictional names/companies/emails.
- `render.sh` produces the PDFs; `manifest.json` holds the expectations.

**Acceptance:**

- Every PDF passes `isPdf` and `CvTextExtractor` gives non-empty text. A small integration spec iterates over the manifest.
- No real personal data (the GitHub URLs point to public OSS accounts only).

**Verify:** the new spec plus `npm run test:integration`. **Size:** M

### Task 2: `parse-eval` script (Sonnet)

- Script, pure helpers (`checks.ts`, `cost.ts`, `report.ts`), the npm script, and unit specs for checks, cost and the report.
- A dry run with `--dry-run` (extract and GitHub only, no LLM) works without spending money.

**Acceptance:**

- Unit specs are green.
- `--dry-run` prints text lengths and GitHub statuses for all 8 CVs.
- Build and lint are clean.

**Verify:** `npm run test -w apps/api`, `npm run build`, `npm run lint`, and a dry run. **Deps:** 1. **Size:** M

### Checkpoint: Tooling

Everything green, then review both diffs.

### Task 3: Baseline run (main)

- `--label baseline --runs 2`, live.
- Read every profile and note the issues per CV, plus 2-column extraction problems, the injection handling, and the Ukrainian output.

**Checkpoint with dude:** show the baseline report and the proposed tuning before changing the prompt.

### Task 4: Prompt and schema tuning (main)

- Up to 3 iterations: change, unit specs, live `--label tuned-N`.
- Stop when the manifest checks plus a manual read show the gaps are fixed with no regressions (including the GitHub path and the injection CV).

**Verify:** `npm run test -w apps/api`, `npm run test:integration`, and `npm run test:e2e`, since prompts feed the MSW-captured request assertions.

### Task 5: Report and docs (main)

- `docs/eval/checkpoint-a.md`: method, CV set, baseline vs tuned (checks, tokens, cost per CV and total), findings, remaining gaps, and the pricing caveat.
- `docs/sdd.md`: §11 live-eval note, the §12 parse-quality bullet updated, and the new script in the module map and commands.
- README: the `parse-eval` command.

### Checkpoint: Complete

- CI-equivalent run locally.
- Ask for commit approval. Suggested commits: plan / cv set / script / prompt tuning / report and docs.
- Push, open the PR "Stage 2 checkpoint A: parse eval and prompt tuning", watch CI.

## Risks

| Risk                                        | Mitigation                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| LLM variance hides the effect of tuning     | 2 runs per CV per label; compare check pass rates and read profiles manually                 |
| 2-column PDFs extract scrambled             | It's a finding; record it and don't fix extraction in this checkpoint unless trivial         |
| Pricing figure is unverified                | Price passed as a flag; the report labels its source                                         |
| Overfitting the prompt to 8 CVs             | Rules stay generic (field definitions), not CV-specific; step 10's 100-CV set re-checks this |
| Prompt change breaks e2e request assertions | Run e2e in Task 4                                                                            |
