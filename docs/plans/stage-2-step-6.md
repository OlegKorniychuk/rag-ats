# Stage 2 · Step 6 — Auto-rescore on vacancy change

Parent roadmap: `docs/plans/stage-2.md`, Part B, Step 6. Branch: `feat/auto-rescore` off `main`.

## Context

Since step 4 every score is tied to the vacancy's criteria through `criteria_hash` (sha256 of the whitespace-collapsed title and requirements). Editing the title or requirements changes the hash. Existing scores then show as `stale`, and nothing rescores them until someone clicks Rescore on each card (sdd §12, "Vacancy edits don't rescore"). Step 6 closes that gap:

- a `PATCH /vacancies/:id` that changes the hash of an **open** vacancy resets all of its scores to `pending` and queues the rescore;
- the pipeline shows the transition, and the edit dialog warns before saving.

Dude's decisions (interview):

- **Closed vacancies are only marked stale.** Editing a closed vacancy costs no LLM calls. Its scores show as outdated until the vacancy is **reopened**, and reopening rescores every outdated score.
- **Web: note plus banner.**
  - The edit dialog shows a note only once the title or requirements actually differ.
  - After saving, the snackbar says applicants are being re-scored.
  - The pipeline shows an info banner while stale scores are in flight, and a different one for a closed vacancy with outdated scores.
  - No contract change.

## Architecture decisions

### Contract

None. `PATCH /vacancies/:id` keeps its request and `VacancyResponse`. `ApplicationScore.stale` and the `pending`/`scoring` statuses already describe the transition, and the client can tell whether the title or requirements changed on its own.

### One rule for edit and reopen

After a successful update, `VacanciesService.update` rescores when **both** of these hold:

- the vacancy is `open` after the update;
- the hash changed, **or** the status went from `closed` to `open`.

"Rescore" means resetting every score of the vacancy whose `criteria_hash` is distinct from the current hash. That covers never-scored rows (`null`) and `failed` rows with an old hash, while keeping `result`, so `stale` is derived as usual. After commit it calls `jobs.enqueueCriteria(vacancyId)` once.

- **Edit of an open vacancy**: every score has the old hash, so all of them are reset.
- **Reopen**: only the scores that went outdated while the vacancy was closed are reset. A reopen with nothing outdated resets nothing and makes no LLM call; the extraction job finds no pending scores, or isn't queued at all if no rows were reset.
- **Edit of a closed vacancy**: no reset and no job. The hash still changes, so scores read `stale` with `status: 'scored'`, which means outdated and not in flight.
- **Status-only close, or a whitespace-only edit**: the hash doesn't change, so nothing happens.

### API

- **`ScoresRepository.resetOutdatedForVacancy(vacancyId, criteriaHash): Promise<string[]>`**:
  - sets `status: 'pending', error: null, updatedAt` on the vacancy's scores where `criteria_hash IS DISTINCT FROM $hash`;
  - leaves the `result`;
  - returns the reset ids;
  - mirrors `resetPendingForCandidate`.
- **`VacanciesService.update`** becomes:
  1. a `@Transactional()` private method: ownership check, read the old hash and status, update, compute the new hash with `vacancyCriteriaHash`, apply the rule above, and if it fires call `resetOutdatedForVacancy`;
  2. after commit, if any rows were reset, `jobs.enqueueCriteria(vacancyId)`. An enqueue failure is logged, not returned, the same as apply and add; the startup sweep picks up `pending` scores of parsed candidates.
- **Why queue criteria extraction and not the scores themselves**:
  - the extraction job is `exclusive` per vacancy;
  - it re-extracts when the hash is outdated, and only enqueues the pending scores when the hash is current;
  - so one LLM extraction is shared by all applicants, and score jobs don't race each other to queue it.
- **In-flight scores** need no new code. A job already `scoring` when the edit lands finishes its LLM call, and `saveIfCurrent` sees the new hash, resets to `pending` and re-queues it (step 4). Rapid successive edits waste at most one round of calls: the extraction worker re-checks the hash after its LLM call and retries up to 3 times.
- The vacancies module already imports `JobsModule` (step 5).

### Web (`apps/web`)

- **Edit dialog** (`VacancyFormDialog`, edit mode only). It watches title and requirements and compares them to the vacancy's values after collapsing whitespace, the same as the server's hash, via a small `vacancies/rescore.ts` helper `changesCriteria(before, after)`. When they differ it shows an info `Alert` above the actions:
  - open vacancy: "Saving will re-score every applicant against the new requirements.";
  - closed vacancy: "This vacancy is closed: applicants' scores will be marked outdated and re-scored when you reopen it."
- **Snackbar after saving** (edit mode):
  - "Vacancy updated · re-scoring applicants" when the criteria changed and the vacancy is open;
  - otherwise "Vacancy updated", as today.
- **Pipeline banner** (`pipeline/RescoreBanner.tsx`, on `PipelinePage` above the board), from the applications data:
  - any score that is `stale` and in flight: an info `Alert` "Re-scoring N applicants. Their previous scores are greyed out until the new ones are ready.";
  - vacancy `closed` and any score that is `stale` and not in flight: a warning `Alert` "Scores are outdated: the requirements changed while the vacancy was closed. Reopen the vacancy to re-score its applicants.";
  - otherwise nothing.
  - The existing polling (score in flight) already refreshes the board, and the existing badge and drawer stale states stay as they are.
- **Cache**: `useUpdateVacancy` invalidates `vacancyKeys.all`, and `['vacancies', id, 'applications']` sits under it, so an open pipeline refetches and starts polling. No change needed; a test asserts it.

### Tests

- **Integration (`scores.repository.integration-spec.ts`)**: `resetOutdatedForVacancy` resets only that vacancy's rows with a distinct hash, including `null` and `failed` rows. It keeps `result`, leaves current-hash rows alone, and returns the reset ids.
- **E2E (`vacancies.e2e-spec.ts` or `scoring.e2e-spec.ts`, whichever holds the score helpers; no new journey spec)**:
  - PATCH requirements of an open vacancy with scored applicants returns 200, and right after, the scores are `pending` and `stale` with the old `result`. Then a second criteria call is captured and every score is `scored` with the new criteria.
  - PATCH title only also triggers a rescore.
  - A whitespace-only change, and a status-only close, change no score and make no OpenAI call.
  - Edit a closed vacancy: the scores are `scored` and `stale` and no OpenAI call is made. Reopening it rescores them.
  - Reopen with nothing outdated: no OpenAI call.
  - The existing PATCH validation and 404 cases still pass.
- **Unit (web)**: `changesCriteria` (whitespace, title, requirements, unchanged).
- **Web (RTL + MSW)**:
  - the dialog note appears only when title or requirements change, with the open or closed wording, and not for whitespace-only edits;
  - the snackbar wording;
  - `RescoreBanner` (in-flight count, closed-outdated warning, none);
  - an open pipeline refetches after a vacancy update.

## Task list

Execution follows the usual pattern. Sonnet subagents do Tasks 1–3; the main session reviews, re-runs tests, does the live smoke and browser check, and writes the **docs inline** (Task 4). With no contract change, Tasks 1, 2 and 3 can all run in parallel: Task 1 is `apps/api` only, and Tasks 2 and 3 touch different `apps/web` files.

### Task 1: API reset rule, repository and e2e (M)

- `resetOutdatedForVacancy` with its integration cases.
- `VacanciesService.update` with the transactional reset and the enqueue after commit.
- The e2e cases listed above.

**Verify**: `npm run build -w apps/api`, `npm run lint -w apps/api`, `npm run test -w apps/api`, `npm run test:integration`, `npm run test:e2e -w apps/api` twice.

### Task 2: Web edit-dialog note and snackbar (S)

- `vacancies/rescore.ts` (`changesCriteria`), the note in `VacancyFormDialog`, the snackbar wording, and tests.

**Verify**: web tests twice, `npm run build -w apps/web`, `npm run lint -w apps/web`.

### Task 3: Web pipeline banner (S)

- `RescoreBanner`, wired on `PipelinePage`, plus tests (including the refetch after a vacancy update).

**Verify**: web tests twice, build, lint.

### Checkpoint: API (main)

- Everything is green.
- **Live smoke**, on the step 5 smoke vacancies:
  - edit the requirements of an open one with 2 applicants (e.g. add a must-have). Check the criteria are re-extracted, both scores go `pending` and stale and then `scored`, and how the overalls move. Record the tokens;
  - close the vacancy, edit it again, and check that no LLM call is made and the scores are stale;
  - reopen it and check it rescores.

### Checkpoint: Browser (main)

- The edit dialog note appears and disappears as the fields change, with both wordings.
- After saving, the pipeline shows greyed badges plus the info banner, and both clear once the new scores land.
- A closed, edited vacancy shows the warning banner; reopening it starts the rescore.
- Kill the servers by PID afterwards.

### Task 4: Docs (main session, inline)

- `docs/sdd.md`:
  - status;
  - §6 note on `PATCH /vacancies/:id` side effects;
  - §8 design decisions (the reset rule, closed vacancies, extraction as the single entry point);
  - §10 dialog note and banner;
  - §11 tests and live smoke;
  - §12: replace "Vacancy edits don't rescore", and add the in-flight edge case for closed vacancies.
- README walkthrough line.

### Checkpoint: Complete

- CI-equivalent run locally.
- Ask for commit approval (plan / api / web / docs).
- Push, open the PR "Stage 2 step 6: auto-rescore on vacancy change", watch CI.

## Risks

| Risk                                                                                                    | Impact | Mitigation                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Every requirements edit re-runs N paid scores                                                           | Med    | Only for open vacancies; whitespace-only edits don't count; the dialog warns first; about $0.005 per applicant (step 4)     |
| Rapid successive edits waste LLM calls                                                                  | Low    | The hash guards in extraction and `saveIfCurrent` cap it at one wasted round                                                |
| A score in flight while a **closed** vacancy is edited is still rescored (`saveIfCurrent` re-queues it) | Low    | Rare, since a closed vacancy only gets manual rescores; documented in §12                                                   |
| The client's "criteria changed" check drifts from the server hash                                       | Low    | Same normalisation (collapse whitespace, trim, case-sensitive); unit-tested; the note only affects wording, never behaviour |
| Reopen rescoring surprises the recruiter                                                                | Low    | The closed-vacancy dialog note and the pipeline warning banner both say reopening re-scores                                 |

## Out of scope

- Editing criteria directly, or showing them outside the drawer.
- Debouncing or batching edits.
- Showing the applicant count or cost before saving (would need a contract change).
- Checkpoint B (live citation review), which follows this step.
