# Stage 2 · Step 9 — RAG scoring mode

Parent roadmap: `docs/plans/stage-2.md`, Part C, Step 9. Branch: `feat/rag-scoring` off `main` (#35 merged).

## Context

Scoring (step 4, tuned in Checkpoint B) puts the whole normalised CV and the `<github>` block into one prompt (`mode: 'full_text'`). Step 9 adds the thesis's RAG variant: for each criterion, retrieve the candidate's most similar chunks (step 7's embeddings, step 8's per-criterion retrieval) and score that criterion **only** from them. Both modes stay, switched by `SCORING_MODE`, so the eval can compare them.

Dude's decisions:

- **Grounding**: started strict (per-criterion); the rag-1 eval rejected real evidence retrieved for another criterion on 12/64 pairs, so it is lenient: any chunk retrieved for the application, never unretrieved text.
- **Live comparison now**: `score-eval` gets `--mode rag` (chunks and embeds in memory, no DB) and is run on the Checkpoint B set against the `tuned-2` full-text results.

## Architecture decisions

### Contract (`packages/shared/src/api.ts`, first)

```ts
export type ScoringMode = 'full_text' | 'rag';

/** A chunk retrieved for a criterion in `rag` mode, verbatim. */
export interface RetrievedChunk {
  source: 'cv' | 'github';
  text: string;
  similarity: number;
}

// CriterionScore gains:
/** `rag` mode: the chunks this criterion was scored from, best first; null in `full_text` mode. */
retrieved: RetrievedChunk[] | null;

// ScoreResult.mode: 'full_text' → ScoringMode
```

Stored results from before step 9 have no `retrieved`; the score mapper defaults it to `null`. No migration: `application_scores.mode` is already a text column, and the result is jsonb.

### Retrieval

- `CandidateChunksRepository.findNearest(embedding, limit, { candidateId })`: a new option restricting the scan to one candidate's chunks (≤ 60 rows, exact).
- Per application: embed every criterion text in one `LlmClient.embed` call, then the `RAG_CHUNKS_PER_CRITERION = 3` nearest chunks of the candidate per criterion. No floor: a criterion the candidate doesn't meet still gets its nearest chunks, which is where contrary evidence ("their stack is X") comes from.
- In-memory twin for the eval: pure `nearestChunks(queryVector, chunks, k)` (`src/rag/nearest-chunks.ts`, cosine in JS) returning the same shape. Exact cosine in both paths, so the eval's retrieval equals production's for the same chunks and vectors.

### Scorer (`src/llm/`)

- **Prompt** (`prompts/application-score-rag.prompt.ts`):
  - the system prompt is the tuned full-text one plus a RAG rules block: each criterion lists the evidence chunks retrieved for it; those chunks are the place to look first, but a quote may come from any chunk in `<evidence>` when it is genuine evidence for the criterion; if none show the requirement, score it low and quote the nearest contrary fact; never use text outside `<evidence>` or outside knowledge of the candidate;
  - the user prompt has `<criteria>` with one line per criterion ending in its chunk ids (`c3 [must] Kafka … — evidence: e2, e5, e7`), then `<evidence>` with every distinct retrieved chunk once (`<chunk id="e2" source="cv">…</chunk>`), escaping chunk tags inside the text the same way `buildGithubBlock` does;
  - the schema (`application_score`) is unchanged: quotes still carry `source: 'cv' | 'github'`.
- **Verification**: `verifyQuotes` is unchanged (one `{ cv, github }` source). In `rag` mode the sources are the union of every chunk retrieved for the application (deduped, escaped), joined per source with a separator that normalisation can't bridge (`\n¶\n`), so a quote can't straddle two chunks; `github` is `null` when no github chunk was retrieved. Retrieval stays per criterion (it decides which chunks are listed and is stored as `retrieved`).
- **`ApplicationScorer.scoreRag({ criteria, evidence })`** (`evidence: { criterionId, chunks: RetrievedChunk[] }[]`) shares the attempt/normalise/verify/assemble loop with `score` (refactored into one private method taking the prompt builder and the sources). Each returned criterion carries `retrieved`. Same `LlmGroundingError` after two failed attempts.

### Worker and triggers (`src/jobs/`)

- `SCORING_MODE` env (`EnvConfig`, `@IsIn(['full_text','rag'])`, default `full_text`; `.env.example`). Read by `ScoreApplicationWorker`; the mode is stored on the row (`mode` column) and in the result.
- `rag` mode in the worker, after the existing guards:
  1. if the candidate's chunks aren't built from the parsed CV (`embedded_cv_document_id ≠ parsed_cv_document_id`), leave the score `pending` and return. The embed job re-queues it;
  2. embed the criteria, retrieve per criterion, `scoreRag`, then the existing `saveIfCurrent`. An embeddings failure is recorded as `failed` with the generic message, like any other scoring error.
- **Embed → score trigger**: after `EmbedCandidateWorker` saves the chunks, it enqueues the candidate's `pending` scores (`ScoresRepository.findPendingByCandidate`). Harmless in `full_text` mode (the duplicate-job guard makes it a no-op when they are already queued or scored).
- **Switching the mode** affects only new scores: existing results keep their mode and are not marked stale. A rescore uses the current mode.

### Web (`apps/web`)

- `ScoreDrawer`: the footer becomes "Scored {date} · {model} · Full text|RAG".
- In `rag` mode each criterion gets a collapsed "Evidence retrieved (3)" toggle listing its chunks as clamped `QuoteBlock`s with a similarity chip. Quotes render as today.

### Eval (`src/scripts/score-eval*`)

- `--mode full_text|rag` (default `full_text`). In `rag` mode, per CV per invocation: `chunkCandidate(cvText, snapshot)`, embed the chunks once (cached like the CV text). Per vacancy per run: embed the criteria once. Per pair: `nearestChunks` per criterion → `scoreRag`.
- Checks: grounding re-verified against the union of the pair's retrieved chunks (same rule as the scorer); band agreement, spread, filler suspects and `data-ml` coverage as before. The report and JSON record the mode and the retrieved chunk ids per criterion, and the cost includes embedding tokens (`--embedding-price`, default $0.02 / 1M).
- `--write-review` works unchanged, with an extra "retrieved" column.

## Tests

- **Unit**:
  - `nearestChunks` (order, k, ties);
  - the RAG prompt builder (chunk ids, dedupe, escaping, evidence lines);
  - `verifyQuotes` with per-criterion sources (quote from another criterion's chunk fails with the right message; no match across the chunk separator);
  - `scoreRag` (valid, quote from another criterion's chunk accepted, retry after a quote from an unretrieved chunk, grounding error, `retrieved` attached, usage summed);
  - the score mapper defaulting `retrieved` to null;
  - `score-eval` rag helpers (retrieval wiring, cost with embeddings).
- **Integration**:
  - `findNearest` with `candidateId`;
  - `findPendingByCandidate`;
  - score worker in `rag` mode (waits when not embedded; scores from retrieved chunks, stores `mode: 'rag'` and `retrieved`; an embeddings 500 → `failed`);
  - the embed worker enqueues pending scores.
- **E2E** (`scoring.e2e-spec.ts`, a second app with `SCORING_MODE=rag`): apply → parsed → embedded → scored with `mode: 'rag'`; every quote is inside that criterion's `retrieved` chunks; the score request's prompt contains `<evidence>` and not the full `<cv>`; rescore stays `rag`; the default app still scores `full_text` with `retrieved: null`.
- **Web**: footer mode label; evidence toggle in `rag` mode only; old results without `retrieved` render.

## Task list

Sonnet subagents do Tasks 1–5. The main session reviews, re-runs tests, runs the live eval and smoke, labels the review sample, and writes the docs inline (Task 6).

- **Task 1 — Contract and retrieval foundations (M)**: contract types and mapper default; `SCORING_MODE` env; `findNearest` `candidateId`; `findPendingByCandidate`; `nearestChunks`; tests. _Verify_: build, lint, unit, integration.
- **Task 2 — RAG scorer (M)**, after Task 1: RAG prompt, per-criterion `verifyQuotes`, `scoreRag` plus the shared loop refactor (full-text behaviour byte-identical: the existing scorer and prompt tests pass unchanged); unit tests. _Verify_: build, lint, unit.
- **Task 3 — Worker, trigger and e2e (M)**, after Task 2: the worker's `rag` path, the embed → score trigger, integration and e2e. _Verify_: everything, e2e twice.
- **Task 4 — Web drawer (S)**, after Task 1, in parallel with 2–3. _Verify_: web tests twice, build, lint.
- **Task 5 — `score-eval --mode rag` (M)**, after Task 2, in parallel with 3–4. _Verify_: build, lint, unit, `--dry-run` in both modes.

### Checkpoint: Live eval (main)

- `npm run score-eval -w apps/api -- --label rag-1 --mode rag --runs 2 --write-review`, about $0.35–0.7. Compare with `tuned-2` on grounded/failed/retried, band agreement, spread, tokens and cost per score.
- Label a seeded random sample of the rag review (30 citations) with the Checkpoint B labels (supports / weak / irrelevant), and offer Dude a spot-check.
- If the RAG prompt needs one tuning round, do it (`rag-2`) and keep both runs. Results go to `docs/eval/checkpoint-b/rag-*.{json,md}` and a write-up in `docs/eval/rag-scoring.md`.

### Checkpoint: Live smoke and browser (main)

- Dev API with `SCORING_MODE=rag`: rescore 2–3 applications on the step 8 vacancies. Check `mode: 'rag'`, the evidence in the drawer, tokens versus the previous full-text scores, and that a new application waits for embedding and then scores.
- Switch back to `full_text` and rescore one: it is full text again.

### Task 6 — Docs (main, inline)

- `docs/sdd.md`:
  - status and §3;
  - §7 contract;
  - §8 decisions: per-criterion retrieval, lenient grounding, the embed → score trigger, the mode switch not marking stale, no floor;
  - §9 `SCORING_MODE`;
  - §10 drawer;
  - §11 tests, eval and smoke;
  - §12 limits.
- README env and walkthrough.
- `docs/eval/rag-scoring.md`.

### Checkpoint: Complete

- CI-equivalent run locally, then `npx prettier --check .` last.
- Ask for commit approval: plan / api / web / eval (script + results) / docs.
- Push, open the PR "Stage 2 step 9: RAG scoring mode", watch CI.

## Risks

| Risk                                                                                                 | Impact | Mitigation                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CVs are small (2–3 chunks), so per-criterion top-3 often contains most of the CV and RAG ≈ full text | Med    | That is a finding, not a bug. The eval reports evidence coverage (distinct chunks shown / total chunks) per pair so the write-up can say how much was hidden |
| Lenient grounding lets a quote come from a chunk shown for another criterion                         | Low    | Quotes are still verbatim from retrieved text; retrieval per criterion is stored, and the citation review checks relevance of each quote                     |
| Contrary evidence for 0-scored criteria is missing from the retrieved chunks                         | Med    | No floor (always top-3); the prompt asks for the nearest contrary fact from <evidence>; citation review checks the 0-score rows                              |
| Score jobs racing the embed job in `rag` mode                                                        | Low    | The worker waits while not embedded; the embed job enqueues pending scores; the startup sweep covers lost jobs                                               |
| The full-text path changes during the refactor                                                       | Low    | Existing scorer and prompt tests unchanged; e2e default app asserts `full_text`                                                                              |

## Out of scope

- Tuning `full_text` further, or hybrid modes.
- Caching criteria embeddings.
- Rescoring everything when the mode switches.
- The synthetic set and eval harness (steps 10–11).
