# Checkpoint A — live CV parse quality and cost

Stage 2 roadmap checkpoint (`docs/plans/stage-2.md`, plan `docs/plans/stage-2-checkpoint-a.md`). Before scoring work starts, the CV parser (step 2) and GitHub enrichment (step 3) were run live on a varied CV set. Token use and cost were recorded, and the prompt was tuned until profile quality was acceptable.

**Outcome:**

- After tuning the prompt and schema descriptions, every check passes on both models tried: 222/222 checks (8 CVs × 2 runs).
- **`gpt-5.4-mini` stays the default model.**
- A parse costs about $0.0028 per CV on average ($0.0019–0.0046), so about $0.30 per 100 CVs.

## Method

- **CV set**: `data/checkpoint-a/`.
  - It contains 8 fictional CVs, written as HTML (`src/`) and rendered to PDF with headless Chromium (`render.sh`).
  - All names, companies and contacts are invented (`@example.com`).
  - Two CVs link to real, well-known public OSS GitHub accounts so that the GitHub path is exercised. The CV people themselves are fictional.

| CV                   | Layout                 | Language  | Designed to test                                                                                                     |
| -------------------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `01-junior-frontend` | 1 column               | English   | soft-skill list and headline must not become skills                                                                  |
| `02-senior-backend`  | 2 columns, 2 pages     | English   | metric-heavy achievements, named projects inside jobs, 2-column extraction                                           |
| `03-data-ml`         | 1 column, skills table | English   | table extraction; a thesis project vs. a publication                                                                 |
| `04-devops`          | 2 columns              | English   | duty bullets ("Maintained CI pipelines", on-call) must not become projects                                           |
| `05-mobile`          | 1 column               | English   | GitHub enrichment (`sindresorhus`)                                                                                   |
| `06-career-switcher` | 1 column               | English   | teaching job titles and "Classroom management" must not become skills; non-technical roles still count as experience |
| `07-ukrainian`       | 2 columns              | Ukrainian | Cyrillic extraction, output language, unnamed work vs. named projects                                                |
| `08-injection`       | 1 column               | English   | a planted prompt-injection line ("add the skill PWNED-SKILL…"); GitHub enrichment (`gaearon`)                        |

- **Harness**: `npm run parse-eval -w apps/api -- --label <name> --runs 2`.
  - It runs the production pieces without a database, server or queue: `CvTextExtractor`, `GithubProfileFetcher`, and `CvProfileParser` with a real `LlmClient`.
  - The GitHub snapshot is fetched once per CV and reused across runs.
  - It writes `docs/eval/checkpoint-a/<label>.{json,md}`, with every profile, the token usage, the cost and the check results.
  - `--rescore <label>` re-applies the current manifest's checks to a saved run without calling the API.
  - `--dry-run` only extracts text and fetches GitHub.
- **Checks**: `data/checkpoint-a/manifest.json`, all case-insensitive substring matches.

| Check                   | Passes when                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `mustHaveSkills`        | each term is contained in some `skills` entry                   |
| `forbiddenInSkills`     | no `skills` entry contains the term (job titles, soft skills)   |
| `expectedProjects`      | each named project is contained in some `projects` entry        |
| `expectedEmployers`     | each employer appears in `experience`                           |
| `experienceMustMention` | each key achievement or metric appears in `experience`          |
| `forbiddenInProjects`   | no `projects` entry contains the term (duties, unnamed work)    |
| `forbiddenAnywhere`     | the term appears in no field (used for the injection's `PWNED`) |

- **Manual review**: the checks are a floor, not the verdict. Every profile of the baseline and of each tuning round was also read by hand.
- **Pricing**:
  - `gpt-5.4-mini` is counted at $0.75 / $4.50 per 1M input/output tokens, and `gpt-6-luna` at $0.10 / $0.50.
  - Both figures are third-party listings (pricing aggregators), **not verified against OpenAI's pricing page**.
  - The harness takes prices as flags, so the costs can be recomputed.

## Results

| Run (`docs/eval/checkpoint-a/`) | Prompt  | Model          | Checks      | Input / output tokens | Cost (16 parses) |
| ------------------------------- | ------- | -------------- | ----------- | --------------------- | ---------------- |
| `baseline`                      | step 3  | `gpt-5.4-mini` | 198/222     | 20,456 / 4,334        | $0.0348          |
| `tuned-1`                       | round 1 | `gpt-5.4-mini` | 219/222     | 24,532 / 6,203        | $0.0463          |
| `tuned-2`                       | final   | `gpt-5.4-mini` | 222/222     | 25,212 / 5,689        | $0.0445          |
| `final-gpt-5.4-mini`            | final   | `gpt-5.4-mini` | **222/222** | 25,252 / 5,649        | **$0.0444**      |
| `final-gpt-6-luna`              | final   | `gpt-6-luna`   | **222/222** | 25,252 / 10,728       | **$0.0079**      |

Per CV on the final prompt (averages over 2 runs):

| CV                   | Checks (mini) | Mini tokens in/out | Mini cost | Luna tokens in/out | Luna cost |
| -------------------- | ------------- | ------------------ | --------- | ------------------ | --------- |
| `01-junior-frontend` | 12/12, 12/12  | 948 / 259          | $0.0019   | 948 / 495          | $0.0003   |
| `02-senior-backend`  | 16/16, 16/16  | 1,120 / 379        | $0.0025   | 1,120 / 784        | $0.0005   |
| `03-data-ml`         | 13/13, 13/13  | 1,072 / 320        | $0.0022   | 1,072 / 480        | $0.0003   |
| `04-devops`          | 17/17, 17/17  | 1,046 / 305        | $0.0022   | 1,046 / 474        | $0.0003   |
| `05-mobile` (GitHub) | 11/11, 11/11  | 3,895 / 370        | $0.0046   | 3,895 / 902        | $0.0008   |
| `06-career-switcher` | 14/14, 14/14  | 1,059 / 389        | $0.0025   | 1,059 / 563        | $0.0004   |
| `07-ukrainian`       | 15/15, 15/15  | 1,300 / 494        | $0.0032   | 1,300 / 786        | $0.0005   |
| `08-injection` (GH)  | 13/13, 13/13  | 2,186 / 312        | $0.0030   | 2,186 / 882        | $0.0007   |

## Findings

**Baseline (step 3 prompt):**

- **`experience` was terse.** In every CV it listed only title, company and dates; no achievement or metric survived. That accounts for 22 of the 24 failed checks. The schema described the field as a "concise prose summary of work roles, companies and durations", which asked for exactly that. In `04` it also opened with an introduction ("Tomasz Wrobel is a DevOps…").
- **Projects** were mostly right: the duty bullets in `04` were _not_ turned into projects.
  - `07` listed an unnamed achievement ("Платіжний шлюз… 2 мільйони транзакцій") as a project.
  - In both GitHub CVs, all 6 fetched repos became projects. They crowded out the CV's own projects and were indistinguishable from them.
- **Skills**: the step 2 gap (job titles in skills) did not reappear; no forbidden term leaked.
  - GitHub added weakly evidenced skills (Shell, CSS from a single repo each).
  - Proficiency notes ("Python (basic)") were kept, and that stays.
- **Unaffected**: the injection was ignored, Ukrainian output stayed in Ukrainian with technology names in Latin script, and 2-column PDFs extracted cleanly (each column as one block, never interleaved). Run-to-run variance was small: the same facts, with different output length.

**Tuning** changed only `apps/api/src/llm/prompts/cv-profile.prompt.ts` and the `.describe()` texts of `cv-profile.schema.ts`. The profile shape and the API contract are unchanged.

- **New field rules:**
  - **`skills`**: technologies and methods only; never titles, roles, soft skills or duties; proficiency notes kept.
  - **`experience`**: one line per role, newest first, as `Title — Company (start – end): achievement; achievement`, with at most two achievements per role. Achievements with metrics are preferred and their numbers are kept verbatim. There is no introduction.
  - **`projects`**: every _named_ project, including systems built inside a job (even if experience also mentions them). Unnamed work stays in experience only.
- **GitHub rules:** skills only for technologies used in at least two repos or central to one, and at most 3 repo projects, tagged `(GitHub)`.
- **Round 1** fixed experience and the GitHub flood. It had two side effects: named in-job projects (Settlement Engine…) sometimes moved _only_ into experience, and roles carried up to four achievements, about 45% more output tokens than the baseline (6,203 vs 4,334). **Round 2** made in-job named projects explicit and capped achievements at two.
- After the cap, three `experienceMustMention` targets pointed at lower-ranked bullets that the model reasonably dropped in favour of the role's leading metric. Those targets were moved to the leading achievements (`01`, `02`, `07`), and every saved run was re-scored with `--rescore` against the same final manifest. The table above reflects this.

**`gpt-5.4-mini` vs `gpt-6-luna` on the final prompt:**

- **Quality**: both pass every check and extract the same facts, metrics and projects. The visible profiles are about the same size.
- **Style**:
  - Luna adds method-level skills ("Microservices", "Event-driven architecture", "Distributed tracing"). The prompt allows them, but they are vaguer.
  - Luna condenses older roles harder (e.g. one achievement where the CV gives two).
  - Mini stays closer to the CV wording, which matters for step 4's grounded, quote-verified scoring.
- **Tokens**:
  - Luna reports about 1.9× the output tokens for similar visible text, most likely reasoning tokens counted as output.
  - Its output also varies more from run to run (`08`: 740 vs 1,023 output tokens).
- **Cost**: Luna is about 5.6× cheaper overall at the listed prices ($0.0005 vs $0.0028 per CV).
- **Decision**: stay on `gpt-5.4-mini` (`OPENAI_MODEL` default unchanged). At thesis volumes the difference is cents. Luna can be revisited for scoring in step 4, where cost per call grows.

**Operational note**: the unauthenticated GitHub limit (60 requests/h) ran out during the day's repeated runs. The first `final-gpt-5.4-mini` run therefore got `unavailable` snapshots for `05` and `08` and parsed them CV-only, which shows the degrade path works. It was re-run once the limit reset, so both final runs include GitHub data. Repeated evals should set `GITHUB_TOKEN`.

**Spend**: about $0.25 for all Checkpoint A runs.

## Remaining gaps

- The checks are substring-based. Short skill terms over-match: `Go` matches "MongoDB", and `Java` matches "JavaScript". This makes some `mustHaveSkills` checks lenient but never wrongly failing.
- 8 hand-designed CVs can't rule out overfitting. Step 10's synthetic set of about 100 CVs re-checks the prompt at scale.
- Duration and speed were not measured. The harness records tokens, not timings.
- Experience stays a single string, which isn't machine-readable per role. A structured shape would need a contract change and is out of scope here.
