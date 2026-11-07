# Stage 2 · Step 8 — Find matches for a vacancy

Parent roadmap: `docs/plans/stage-2.md`, Part C, Step 8. Branch: `feat/vacancy-matches` off `main` (#34 merged).

## Context

Step 7 made the pool searchable from free text. Step 8 turns it around: from a vacancy, the recruiter asks "who in the pool fits this?" and adds the good ones to the pipeline in one click. Adding reuses step 5 (`POST /vacancies/:id/applications`, `source: 'added'`), which then scores the candidate.

Dude's decisions:

- **Retrieval: both modes, compared.**
  - `criteria` (default, used by the UI): embed each extracted vacancy criterion, retrieve the nearest chunks per criterion, rank candidates by weighted criterion coverage, and show which criteria each candidate matched. This is the per-criterion retrieval step 9 (RAG scoring) needs, so it is built as reusable code.
  - `whole_text`: embed title + requirements as one query and rank with step 7's `rankCandidates`. Kept for the step 11 comparison and the live smoke; not used by the UI.
- **UI: a drawer.** A "Find matches" button in the pipeline header (open vacancies only) opens a right-side drawer with ranked matches, matched criteria, snippets and an **Add** button each. An added candidate leaves the list and appears on the board.

## Architecture decisions

### Contract (`packages/shared/src/api.ts`, first)

```ts
export type MatchMode = 'criteria' | 'whole_text';

/** One vacancy criterion, as matched against a candidate's chunks. */
export interface CriterionMatch {
  criterionId: string;
  criterion: string;
  importance: CriterionImportance;
  /** Best chunk similarity for this criterion; null when none of the candidate's chunks was retrieved for it. */
  similarity: number | null;
  /** similarity ≥ the match floor. */
  matched: boolean;
}

export interface MatchSnippet extends SearchSnippet {
  /** The criterion this chunk was retrieved for; null in `whole_text` mode. */
  criterionId: string | null;
}

export interface VacancyMatch {
  candidate: CandidateResponse;
  /** Ranking score, 0–1: weighted criterion coverage (`criteria`) or best chunk similarity (`whole_text`). */
  score: number;
  /** Every vacancy criterion in `criteria` mode (must first); empty in `whole_text` mode. */
  criteria: CriterionMatch[];
  /** Up to 3 snippets, best first, at most one per criterion. */
  snippets: MatchSnippet[];
}

/** GET /vacancies/:id/matches?mode=criteria|whole_text (default criteria) */
export interface VacancyMatchesResponse {
  mode: MatchMode;
  matches: VacancyMatch[];
}
```

### API

- **Route** `GET /vacancies/:id/matches` on `VacanciesController`, optional `mode` query (`VacancyMatchesQueryDto`, `@IsOptional() @IsIn(['criteria','whole_text'])`).
  - Owner-scoped via `getOwnedVacancy` (404 not found / not mine); **409 "Vacancy is closed"** for a closed vacancy (it can't take candidates, and matching costs a call); **503 "Matching is temporarily unavailable"** when the embeddings or the inline criteria extraction call fails.
- **`VacancyMatchService`** (`src/vacancies/matches/`), injected into the controller:
  1. Owned + open check.
  2. **Criteria mode**: get current criteria. `VacanciesRepository.findCriteria(vacancyId)` returns `{ criteria, criteriaHash, title, requirements }`; when the hash matches `vacancyCriteriaHash(title, requirements)` they're used as-is. Otherwise extract inline with `CriteriaExtractor` (one LLM call, ~3 s, ~$0.001) and store via `saveCriteria(…, hash)` so later scoring reuses them; a lost hash race just uses the fresh criteria for this response.
  3. Embed all criterion texts in one `LlmClient.embed` call.
  4. For each criterion, `chunks.findNearest(vec, PER_CRITERION_CHUNK_LIMIT = 30, { excludeVacancyId })`.
  5. Pure `rankByCriteria(criteria, hitsPerCriterion, { floor, maxCandidates: 10, maxSnippets: 3 })` (`src/rag/rank-by-criteria.ts`, reused by step 9):
     - per candidate and criterion, best similarity among that criterion's hits (`null` if the candidate wasn't retrieved for it);
     - `matched = similarity ≥ MATCH_FLOOR` (start 0.3, tuned in the smoke);
     - `score = Σ wᵢ·sᵢ / Σ wᵢ`, with `w = 2` for must and `1` for nice, and `sᵢ = similarity if matched else 0`;
     - candidates with no matched criterion are dropped; sorted by score desc, then matched-must count, then id;
     - snippets: the best chunk of each matched criterion, best first, de-duplicated by text, max 3.
  6. **Whole-text mode**: embed `title + "\n" + requirements` once, `findNearest(vec, 50, { excludeVacancyId })`, `rankCandidates` with step 7's floor, mapped to `VacancyMatch` (`criteria: []`, `criterionId: null`, `score` = best similarity).
  7. Hydrate with `candidates.findByIds`, keep ranked order, round to 3 decimals.
- **Exclusion in SQL**: `findNearest(embedding, limit, options?: { excludeVacancyId?: string })` adds `candidate_id NOT IN (SELECT candidate_id FROM applications WHERE vacancy_id = $id)`, so applicants of any stage never use up the top-k.
- **Search stays as is**: step 7's call sites pass no options.

### Web (`apps/web`)

- **Data layer**: `getVacancyMatches(vacancyId)` in `api/vacancies.ts`; `vacancyKeys.matches(id) = ['vacancies', id, 'matches']`; `useVacancyMatches(id, { enabled })` with `staleTime: 60_000` and `refetchOnWindowFocus: false`. `useAddMatch(vacancyId)` posts `addCandidateToVacancy` and invalidates `vacancyKeys.applications(id)`, `vacancyKeys.matches(id)` and `candidateKeys.applications(candidateId)`.
- **`PipelinePage`**: a "Find matches" button (search icon) next to the status chip, shown only for open vacancies; it opens `pipeline/MatchesDrawer.tsx` (right anchor, ~480 px). The query runs only while the drawer is open.
- **`MatchesDrawer`**:
  - title "Matches from the candidate pool"; caption "Ranked by how closely each candidate's CV and GitHub match the requirements. Added candidates are scored like applicants.";
  - loading: spinner with "Finding matches…" (the first open may extract criteria);
  - error: `QueryErrorAlert what="matches"`; empty: "No pool candidates match this vacancy yet.";
  - one card per match: name (link to `/candidates/:id`), "N of M criteria" chip, the criteria as small chips (matched: success outlined with a check; unmatched: default; must criteria labelled), snippets via `QuoteBlock clamp` with the criterion's text as a caption above each, and an **Add** button;
  - Add: a pending spinner on that card's button; on success a snackbar "Added {name} — scoring started" and the card disappears after refetch; a 409 shows its message inline on the card.

## Tests

- **Unit**: `rankByCriteria` (weights, floor, null vs unmatched, dropping zero-match candidates, tie-break, snippet dedupe and cap); `VacancyMatchService` mode selection and hash check with fakes where cheap (else covered by e2e).
- **Integration**: `findNearest` with `excludeVacancyId` (an applicant's chunks are skipped, others unaffected); `VacanciesRepository.findCriteria`.
- **E2E** (`vacancies.e2e-spec.ts`; reuse step 7's `textPdf`, `waitForEmbedded`, threshold override for the fake embeddings, and the criteria MSW handler):
  - three pool candidates (Kubernetes/Terraform, React/Jest, Python/Airflow) applied to vacancy A; the same recruiter's vacancy B with Kubernetes/Terraform criteria → the DevOps candidate first with matched criteria and a snippet tagged with its criterion;
  - a candidate already on B is excluded;
  - `?mode=whole_text` returns `mode: 'whole_text'`, `criteria: []`, the DevOps candidate first;
  - criteria absent → extracted inline once (one criteria request captured) and stored; a second call makes no criteria request; current criteria are reused after a scoring run;
  - 404 for another recruiter's vacancy, 409 closed, 400 bad uuid / bad mode, 401, 503 on embeddings 500 and on criteria 500;
  - add from matches (existing POST) → the candidate drops out of the next matches response.
- **Web (RTL + MSW)**: button only for open vacancies; drawer fetches only when opened; loading, error, empty; card content ("N of M criteria", chips, snippet captions); Add posts, shows the snackbar and the card disappears; inline 409.

## Task list

Sonnet subagents do Tasks 1–3; the main session reviews, re-runs tests, does the smoke and browser checks, and writes the docs inline (Task 4).

### Task 1: Contract and retrieval core (M)

- `api.ts` types; `findNearest` exclusion option + integration test; `VacanciesRepository.findCriteria`; `rankByCriteria` + spec.

**Verify**: API build, lint, unit, integration.

### Task 2: Matches endpoint (M) — after Task 1

- `VacancyMatchService` (both modes, inline criteria), DTO, controller route with Swagger, contract checks, e2e.

**Verify**: API build, lint, unit, integration, e2e twice.

### Task 3: Web drawer (M) — in parallel with Task 2, after Task 1

- API client, keys and hooks, `MatchesDrawer`, `PipelinePage` button, tests.

**Verify**: web tests twice, build, lint.

### Checkpoint: Live smoke (main)

- On the dev DB (8 Checkpoint A candidates): create vacancies like Checkpoint B's `backend-java`, `devops-platform`, `data-ml`, `frontend-react` (no applicants), run matches in both modes, compare top-3 with the expected strong CVs from `data/checkpoint-b/vacancies.json`, record criteria-extraction and embedding tokens, tune `MATCH_FLOOR`.
- Add one match per vacancy and check it gets scored.

### Checkpoint: Browser (main)

- Button hidden on a closed vacancy; drawer loads, shows matched criteria and snippets; Add puts the candidate on the board (score spinner, then a score) and removes it from the drawer.

### Task 4: Docs (main, inline)

- `docs/sdd.md`: status, §3, §6 (route + count), §7 contract, §8 decisions (two modes, weighting, exclusion, inline criteria, 409/503), §10 drawer, §11 tests + smoke table (both modes), §12 limits. README walkthrough. `docs/plans/stage-2.md` unchanged unless a decision moves.

### Checkpoint: Complete

- CI-equivalent locally, `npx prettier --check .` last; ask for commit approval (plan / api / web / docs); push; PR "Stage 2 step 8: find matches for a vacancy"; watch CI.

## Risks

| Risk                                                                  | Impact | Mitigation                                                                                         |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Short criteria vs ~1000-char chunks give low, compressed similarities | Med    | Floor tuned in the smoke on both modes; coverage counts matched criteria, not raw similarity alone |
| First open of the drawer waits on an LLM criteria extraction          | Low    | Spinner text says so; criteria are stored, so it's once per vacancy edit                           |
| Inline extraction races the extraction job                            | Low    | Same hash-guarded `saveCriteria`; worst case one extra ~$0.001 call                                |
| 15 criteria × exact scan per open                                     | Low    | 15 small queries over a few thousand chunks; one embeddings call                                   |
| `whole_text` mode exposed on the API without a UI                     | Low    | Documented as an eval/diagnostic mode in the contract and §8                                       |

## Out of scope

- RAG scoring (step 9); bulk add; matching from the candidate side; caching matches server-side; pagination.
