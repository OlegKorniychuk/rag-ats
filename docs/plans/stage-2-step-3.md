# Stage 2 · Step 3 — GitHub enrichment

Parent roadmap: `docs/plans/stage-2.md`, Part A, Step 3. Saved as `docs/plans/stage-2-step-3.md` on approval (committed with the first commit).

## Context

Step 2 (PR #27) parses each candidate's latest CV into a profile via an async pg-boss job. Applicants can also give a GitHub URL, but it is only stored. Step 3 fetches public GitHub data during the parse job and feeds it to the LLM alongside the CV, so skills and projects shown in repos end up in the profile. The fetched data is stored as a snapshot, which is also the quote source for step 4 scoring, and shown on the candidate page. A GitHub failure never fails the parse: it degrades to a CV-only parse with a visible note (dude's call). Scope per candidate (dude's call): the top 6 repos plus the READMEs of the top 3, about 3k chars each.

## Architecture decisions

- **Contract first** (`packages/shared/src/api.ts`):
  - `GithubStatus = 'ok' | 'not_found' | 'unavailable'`.
  - `GithubRepoSummary { name, url, description: string | null, language: string | null, stars, topics: string[], pushedAt }`.
  - `GithubSummary { username, profileUrl, status, fetchedAt, repos: GithubRepoSummary[], languages: { name, repoCount }[] }`.
  - `CandidateResponse.github: GithubSummary | null`. It is null when there is no GitHub URL, or before the first fetch.
  - README excerpts and the profile bio are **not** in the response; they're internal, used by the LLM and later by scoring.
- **Schema:** `candidates.github_snapshot` jsonb null (internal shape `GithubSnapshot` = the summary plus `bio` and per-repo `readmeExcerpt`). One generated migration, non-destructive. The candidate read maps the snapshot to `GithubSummary` (strips the internals). `saveParsedProfile` gains a `githubSnapshot` argument, written in the same transaction as the profile.
- **GitHub client** `apps/api/src/github/`:
  - `parseGithubUsername(url)`: accepts only `https://(www.)github.com/<user>[/...]`, username `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`, otherwise null. The host is always `api.github.com`, so no SSRF.
  - `GithubClient`:
    - `fetch` against `https://api.github.com` with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and `User-Agent: rag-ats`.
    - Optional `Authorization: Bearer ${GITHUB_TOKEN}`.
    - `AbortSignal.timeout(10s)`.
    - Calls: `GET /users/{u}`, `GET /users/{u}/repos?type=owner&sort=pushed&per_page=100`, and `GET /repos/{u}/{r}/readme` with `Accept: application/vnd.github.raw` for the top 3.
  - `GithubProfileFetcher.fetch(username) → GithubSnapshot`:
    - Repo selection: non-fork, non-archived, sorted by stars desc then `pushed_at` desc, take 6.
    - Languages are aggregated from each repo's primary language, counted across all owned non-fork repos.
    - READMEs: strip images/HTML tags/badges, collapse whitespace, trim to 3,000 chars. A missing README (404) is just skipped.
    - Errors: user 404 → `{ status: 'not_found' }`; 403/429 rate limit, 5xx, timeout or network → `{ status: 'unavailable' }`, logged with no token. It never throws to the worker.
  - Env: `GITHUB_TOKEN` optional (secrets rule: never print it).
  - Behind an injectable class, so step 10's synthetic seed can swap in a fixture-backed implementation.
- **Parser** (`llm/`):
  - `CvProfileParser.parse(cvText, github?: GithubSnapshot)`.
  - The prompt file (`llm/prompts/cv-profile.prompt.ts`) gains GitHub rules: profile bio, repos (name, description, language, topics, stars) and README excerpts go in a separate `<github>…</github>` block, also untrusted.
  - The model adds skills and projects evidenced by the repos, never invents, and keeps `experience` CV-based.
  - The GitHub block is capped at ~12k chars.
  - The profile schema is unchanged.
- **Worker** (`jobs/parse-candidate.worker.ts`):
  - After `markParsing`, if the candidate has a parseable `githubUrl`, fetch the snapshot outside any transaction, before the LLM call. `findParseState` gains `githubUrl`.
  - Pass the snapshot to the parser and save it with the profile in `saveIfLatest`.
  - No URL → snapshot null.
  - A GitHub failure → snapshot with the failure status; the parse continues from the CV only.
  - Reparse refetches GitHub.
- **Web:**
  - Candidate page "GitHub" section after "View CV", shown when `github` is non-null:
    - `ok`: profile link, language chips (name · count), and a repo list with the name linked via `safeExternalUrl`, description, language, ★ stars and the last push date.
    - `not_found` / `unavailable`: an info Alert, "GitHub data unavailable (profile not found / GitHub could not be reached) — the profile was parsed from the CV only."
    - Empty repos: "No public repositories".
- **Tests:**
  - GitHub is mocked with **MSW** (`test/msw/github.handlers.ts`: a user, repos (with forks/archived for filtering) and READMEs; 404 user; 403 rate limit; 500).
  - The e2e global server gets a default GitHub handler (404 user, so existing specs stay CV-only and deterministic). No live calls in tests.

## Task list

Each task is executed by a Sonnet subagent. I review, re-run tests, and ask before committing. Branch: `feat/github-enrichment` off updated `main`.

### Task 1: Contract, schema, repository

- `api.ts` types above.
- `github_snapshot` jsonb plus the migration (generated, unedited).
- Internal `GithubSnapshot` type plus the `toGithubSummary` mapper (strips bio and readmes). Reads expose `github`.
- `saveParsedProfile(id, cvId, profile, githubSnapshot | null)`; `findParseState` adds `githubUrl`.
- DTOs (`GithubSummaryResponseDto`, `GithubRepoSummaryResponseDto`) plus `contract.check.ts`.
- Web fixtures get `github: null`.

**Acceptance:**

- the build and contract check pass;
- integration tests cover snapshot round-trip and mapping (no `readmeExcerpt`/`bio` in reads), `null` when absent, and `findParseState.githubUrl`.

**Verify:** `npm run build`, `npm run test:integration`. **Size:** M

### Task 2: GitHub client + fetcher

- `github/github.module.ts`, `github-client.ts`, `github-profile-fetcher.ts`, `github-username.ts`.
- `EnvConfig.GITHUB_TOKEN?`; `.env.example`.
- MSW handlers file.

**Unit specs:**

- username parsing (valid, trailing path, `www`, wrong host, bad chars, too long);
- selection (forks/archived excluded, stars then push order, max 6);
- language aggregation;
- READMEs only for the top 3, stripped and trimmed, missing README skipped;
- statuses for 404, 403/429 and 500, plus a timeout (fake or short);
- token header sent only when configured;
- no token in logs.

**Verify:** `npm run test -w apps/api`. **Size:** M

### Task 3: Parser + worker integration

- Prompt file: GitHub rules plus a `<github>` block builder with the 12k cap.
- `CvProfileParser.parse(cvText, github?)`.
- Worker fetches, passes and saves the snapshot.
- `JobsModule` imports `GithubModule`.
- e2e MSW default GitHub handler (404).

**Tests:**

- unit (parser): the request contains the `<github>` block only when the snapshot is `ok`, and the cap is applied;
- integration (worker):
  - with a URL, the profile and snapshot are saved;
  - an unknown user → `parsed` + `not_found` snapshot;
  - 500 → `parsed` + `unavailable`;
  - no URL → no GitHub calls, snapshot null;
  - reparse refetches.
- e2e: apply with `githubUrl` (MSW user) → `parsed`, and `GET /candidates/:id` has `github.status: 'ok'` with the repos and no README text.

**Verify:** unit + integration + e2e green (e2e twice). **Deps:** 1, 2. **Size:** M

### Checkpoint: API

- Everything is green.
- **Live smoke:** apply 1–2 synthetic CVs with the GitHub URL of a well-known public OSS account (not personal data), plus one nonexistent username.
  - Check that repo-derived skills/projects appear, the snapshot looks right, and the not-found case parses CV-only.
  - Record LLM token usage, which will be higher with READMEs.
  - Use no `GITHUB_TOKEN` unless rate-limited.
  - Never print secrets.

### Task 4: Web — GitHub section

- `candidates/GithubSection.tsx` (or inline on `CandidatePage`), placed after the View CV row.
- Tests (RTL + MSW):
  - `ok` renders the repos (links via `safeExternalUrl`, language, stars, date) and the language chips;
  - `not_found` and `unavailable` render the info alert;
  - `null` hides the section;
  - empty repos shows "No public repositories".

**Verify:** web tests ×2, build, lint. **Deps:** 1. **Size:** S–M

### Checkpoint: Browser

Candidate page for the live-smoke candidates: the GitHub section renders, links open in a new tab, and the not-found note shows. Kill servers by PID.

### Task 5: Docs

- `docs/sdd.md`:
  - status;
  - module map (`github/`);
  - data model (`github_snapshot`, internal vs response shape);
  - contracts;
  - design decisions: URL parsing and SSRF note, selection rules, README sanitising and caps, degrade-to-CV-only, untrusted GitHub text, rate limits/token;
  - frontend section;
  - testing (GitHub MSW);
  - limitations (unauthenticated 60/h, primary-language-only aggregation, portfolio URLs not fetched);
  - env.
- README env list (`GITHUB_TOKEN`).

**Verify:** prettier, read-through against the code. **Size:** S

### Checkpoint: Complete

CI-equivalent run locally, then ask for commit approval (plan / api / web / docs), then push, then PR "Stage 2 step 3: GitHub enrichment" (no test plan, no attribution), then watch CI.

## Risks

| Risk                                                       | Impact | Mitigation                                                                                     |
| ---------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| Unauthenticated rate limit (60/h, ~5 calls per candidate)  | Med    | Optional `GITHUB_TOKEN`; degrade to `unavailable`; reparse later                               |
| README content bloats tokens or carries prompt injection   | Med    | Strip HTML/images, 3k per README, 12k total GitHub block, untrusted-data prompt rule           |
| e2e accidentally hitting real GitHub                       | Med    | Global MSW default 404 handler; `onUnhandledFrame` already blocks external hosts               |
| Odd GitHub URLs (org pages, repo links, `gist.github.com`) | Low    | Strict parser: first path segment of `github.com` only, else snapshot null (treated as no URL) |
| Snapshot shape drift between internal and response         | Low    | `toGithubSummary` mapper + contract check + integration test for stripped fields               |

## Out of scope

Portfolio URL fetching, GitHub OAuth, contribution graphs/commit history, per-repo language byte breakdowns, scoring (step 4).
