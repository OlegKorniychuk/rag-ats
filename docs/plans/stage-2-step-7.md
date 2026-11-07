# Stage 2 · Step 7 — Embeddings and semantic pool search

Parent roadmap: `docs/plans/stage-2.md`, Part C, Step 7. Branch: `feat/semantic-search` off an up-to-date `main` (#33 is merged). The first commit copies this plan to `docs/plans/stage-2-step-7.md`.

## Context

The pool on `/candidates` can only be narrowed by a client-side substring filter on name, email and skills (`apps/web/src/candidates/filter.ts`, sdd §12). Step 7 adds the first RAG building block:

- every parsed candidate's CV and GitHub text is chunked and embedded into pgvector;
- `POST /candidates/search { query }` returns ranked candidates together with the chunks that matched;
- the search box on `/candidates` runs this semantic search.

Steps 8 (find matches for a vacancy) and 9 (RAG scoring mode) reuse the chunks, the retrieval query and the snippet UI.

Dude's decisions:

- **Chunking**:
  - CV: the raw extracted text, packed on line boundaries into windows of about 1000 characters, with about one line of overlap;
  - GitHub: one chunk per repo plus one profile chunk;
  - chunk text stays verbatim, because step 9 will verify quotes against it.
- **No backfill command.** The dev DB only holds test data and gets wiped. The startup sweep still re-queues lost embed jobs, the same as for parse and score.
- **Search UX**: semantic search runs on Enter, and the query goes in `?q=`. An empty box shows the plain list. The client-side filter is removed.

## Architecture decisions

### Contract (`packages/shared/src/api.ts`, first)

```ts
/** POST /candidates/search body: natural-language query over the shared pool. 1–500 chars after trim. */
export interface SearchCandidatesRequest {
  query: string;
}

/** A chunk of candidate text that matched a search, verbatim from its source. */
export interface SearchSnippet {
  source: 'cv' | 'github';
  text: string;
  similarity: number;
}

export interface CandidateSearchResult {
  candidate: CandidateResponse;
  /** Best chunk's cosine similarity, 0–1. Results are sorted by it, descending. */
  similarity: number;
  /** Up to 3 best-matching chunks, best first. */
  snippets: SearchSnippet[];
}

/** POST /candidates/search -> 200 */
export type SearchCandidatesResponse = CandidateSearchResult[];
```

`CandidateResponse` stays the same, and no embedding status is exposed. A candidate who isn't embedded yet simply doesn't show up in search; the UI caption explains this.

### Data (Drizzle, `apps/api/src/db/schema.ts`)

- **Images**: `docker-compose.yml` and `test/testcontainers-db.util.ts` switch from `postgres:17` to `pgvector/pgvector:pg17-trixie`. The pgvector image is built on the official postgres image, so the existing dev volume keeps working.
- **Migration** (`db:generate`): hand-prepend `CREATE EXTENSION IF NOT EXISTS vector;`, since drizzle-kit doesn't emit it.
- **`candidate_chunks`**, using Drizzle's `vector({ dimensions: 1536 })`:
  - `id` uuid pk
  - `candidate_id` fk, cascade
  - `cv_document_id` fk, cascade
  - `source` text with a `cv|github` check
  - `chunk_index` int
  - `text`
  - `embedding vector(1536) not null`
  - `model` text
  - `created_at`
  - an index on `candidate_id`
- **`candidates.embedded_cv_document_id`** (uuid, null, fk set null) records which parsed CV the current chunks belong to. It is the version key: the GitHub snapshot only changes on a parse, so a parsed CV id covers both CV and GitHub chunks.
- **No ANN index (HNSW) yet.** At this pool size (hundreds of candidates, a few thousand chunks), an exact `ORDER BY embedding <=> $q` scan takes milliseconds. It also gives exact recall for the step 11 eval. HNSW goes into sdd §12 as a scale item.

### Chunking (`apps/api/src/rag/chunking.ts`, pure)

- **`chunkCvText(text)`**:
  - split on `\n` and drop blank lines;
  - pack whole lines greedily up to `CV_CHUNK_MAX_CHARS = 1000`;
  - carry the previous chunk's last line, if it's ≤ 200 chars, into the next chunk as overlap;
  - split a line longer than the max at sentence boundaries, falling back to whitespace;
  - each chunk is the original lines joined by `\n`, so the text stays verbatim.
- **`chunkGithubSnapshot(snapshot)`**:
  - returns `[]` unless `status === 'ok'`;
  - one profile chunk: profile URL, bio, languages;
  - one chunk per repo, built by a `renderGithubRepo(repo)` helper extracted from `buildGithubBlock` (`src/llm/prompts/cv-profile.prompt.ts:80`). Extracting it keeps chunk text identical to what the scorer sees;
  - each repo chunk is capped at 1500 chars.
- **Total cap**: `MAX_CHUNKS_PER_CANDIDATE = 60`. Chunks are ordered CV first, then GitHub, and `chunk_index` is per candidate.

### Embeddings (`apps/api/src/llm/`)

- **`LlmClient.embed(texts: string[]): Promise<{ vectors: number[][]; usage }>`**:
  - uses `client.embeddings.create({ model, input })` in batches of ≤ 100;
  - asserts each vector has length 1536;
  - logs usage in the existing `LLM usage: …` format.
- **Model**: new env var `OPENAI_EMBEDDING_MODEL`, default `text-embedding-3-small`, added to `EnvConfig` and `.env.example`. `EMBEDDING_DIMENSIONS = 1536` is a constant shared with the schema.

### Job `embed-candidate` (`apps/api/src/jobs/`)

- **Queue**: `EMBED_CANDIDATE_QUEUE`, payload `{ candidateId, cvDocumentId }`. Policy `short` with `singletonKey: candidateId`.
  - `retryLimit: 2` with backoff. This deliberately differs from parse and score, which use 0: embed failures have no user-visible status or retry button, so pg-boss retries them instead.
- **`EmbedCandidateWorker`**, following `ParseCandidateWorker`'s pattern (`cls.run`, guards, slow calls outside transactions):
  1. Skip unless the candidate is `parsed`, `parsedCvDocumentId === job.cvDocumentId`, and `embeddedCvDocumentId !== job.cvDocumentId`.
  2. Load the CV text (`cvDocuments.findTextById`) and the snapshot (`candidates.findGithubSnapshot`), chunk them, and embed.
  3. A `@Transactional` `saveIfCurrent` re-checks `parsedCvDocumentId`, then calls `chunks.replaceForCandidate(...)` (delete plus insert) and sets `embedded_cv_document_id`.
  - On failure it logs and rethrows, so pg-boss retries.
- **Trigger**: `ParseCandidateWorker.saveIfLatest` returns whether it saved, so its return becomes `{ saved, applicationIds }`. After commit, when the profile was saved, it calls `jobs.enqueueEmbed(candidateId, cvDocumentId)`. A failed enqueue is only logged.
- **Sweep**: `JobsModule.sweepBacklog` also re-queues `candidates.findEmbedBacklog()`, meaning `parsed` candidates whose `embedded_cv_document_id IS DISTINCT FROM parsed_cv_document_id`.
- **Stale chunks after a new CV**: the old chunks stay searchable until the new parse and embed replace them. This is acceptable and noted in §12.

### Search (`apps/api/src/candidates/`)

- **New repository** `CandidateChunksRepository`, with an interface, a token and a Drizzle implementation registered in `repositories.module.ts`:
  - `replaceForCandidate(candidateId, cvDocumentId, chunks)`;
  - `findNearest(embedding, limit)` → `{ candidateId, source, text, similarity }[]`, where `similarity = 1 - (embedding <=> q)`, using Drizzle's `cosineDistance`.
- **`CandidatesRepository.findByIds(ids)`**: reuses the `findAll` mapping (latest CV plus `withGithub`).
- **`CandidateSearchService.search(query)`**:
  1. embed the query (one call);
  2. `findNearest(vec, 50)`;
  3. pass the hits to a pure `rankCandidates(hits, { minSimilarity, maxCandidates: 20, maxSnippets: 3 })`. It drops hits below `MIN_SIMILARITY`, groups by candidate, scores each candidate by its best chunk and sorts;
  4. hydrate with `findByIds`, keeping the ranked order.
  - `MIN_SIMILARITY` starts at 0.3 and is tuned during the live smoke.
  - If the embedding call fails, it returns **503** "Search is temporarily unavailable".
- **Controller**: `@Post('search') @HttpCode(200)` on `CandidatesController`.
  - Body DTO `SearchCandidatesRequestDto`: `@Transform` trim, `@IsString`, `@IsNotEmpty`, `@MaxLength(500)`.
  - Response DTOs for the result and the snippet, with Swagger.
  - The pool is shared, so there's no recruiter scoping. The global JWT guard applies.
  - `src/contract.check.ts` gets the new DTO↔contract checks.

### Web (`apps/web`)

- **`components/QuoteBlock.tsx`**: move `QuoteBlock` and `SOURCE_LABELS` out of `pipeline/ScoreDrawer.tsx`. It renders `ScoreQuote` and `SearchSnippet` alike (`{ source, text }`); `ScoreDrawer` imports it.
- **Data layer**:
  - `searchCandidates(query)` in `api/candidates.ts`;
  - `candidateKeys.search(q) = ['candidates', 'search', q]` (a distinct second segment from `detail(id)`);
  - `useCandidateSearch(q)`, enabled while `q` is set, with `staleTime: 60_000` and `refetchOnWindowFocus: false` so an unchanged query isn't re-embedded.
- **`CandidatesPage`**:
  - The `TextField` "Search candidates" has a placeholder such as "e.g. backend engineer with Kafka and Kubernetes". A local draft is submitted on Enter to `?q=`. Escape or clearing it removes `q`.
  - No `q`: the existing table (`useCandidates`, polling unchanged).
  - With `q`: `candidates/CandidateSearchResults.tsx`.
    - Each result shows the name link, a match % (`Math.round(similarity * 100)`), the first skills as chips, and its snippets via `QuoteBlock`. Long snippets are clamped, with a "Show more" toggle.
    - States: loading, `QueryErrorAlert`, and `No candidates match "q"`.
    - Header: "N matches for "q"".
    - Caption: "Only candidates whose CV has been processed appear in search."
- **Delete** `candidates/filter.ts` and its test.

## Tests

- **API unit**:
  - `chunking.spec.ts`: packing, overlap, splitting a long line, empty text, verbatim joins, GitHub profile and repo chunks, non-ok status, the cap.
  - `rankCandidates` spec: threshold, grouping, best-first snippets, the max limits.
  - `LlmClient.embed` batching.
- **MSW** (`test/msw/openai.handlers.ts`): `openaiEmbeddingsHandler` for `https://api.openai.com/v1/embeddings`.
  - It returns a deterministic `fakeEmbedding(text)`: lowercase tokens hashed into 1536 buckets, then L2-normalised. Similarity then tracks keyword overlap, so e2e can assert relevance.
  - It is added to the default e2e server handlers. `openaiUnmatchedHandler` and request capture also cover the embeddings URL.
- **Integration** (testcontainers, pgvector image):
  - chunks repository: replace, nearest-first ordering with hand-made vectors, cascade;
  - embed worker: writes chunks plus the embedded id; skips stale, duplicate and unparsed jobs; drops the result when a newer parse landed in between;
  - parse worker enqueues embed;
  - `findEmbedBacklog`.
- **E2E** (`candidates.e2e-spec.ts`, no new journey spec):
  - apply 2–3 candidates whose CVs differ (e.g. Kubernetes/Terraform vs React), and wait for parse and embed;
    - `waitForEmbedded` helper: polls `candidates.embedded_cv_document_id` via the test app's DB;
  - a "kubernetes terraform" search ranks the right candidate first, with a snippet containing those words;
  - 400 for empty, whitespace-only, missing and over-500-char queries; 401 without a cookie; 503 when the embeddings mock returns 500;
  - a new CV replaces the chunks: a search for the old text no longer returns that candidate's old snippet.
- **Web (RTL + MSW)**:
  - `CandidatesPage`: list without `q`; Enter updates `?q=` and shows results with snippets and match %; pre-fill from `?q=` runs the search; no results; error; Escape returns to the list.
  - `queries` / `api` tests for search.
  - `ScoreDrawer` tests still pass after the `QuoteBlock` move.

## Task list

Execution follows the usual pattern: Sonnet subagents do Tasks 1–4, and the main session reviews, re-runs tests, does the smoke and browser checks, and writes the **docs inline** (Task 5). Task 1 goes first. After it, Tasks 2 and 4 run in parallel (`apps/api` vs `apps/web`), and Task 3 follows Task 2.

### Task 1: Contract and foundation (M)

- `api.ts` types.
- The pgvector images (compose plus testcontainers).
- The schema and migration (extension, `candidate_chunks`, `embedded_cv_document_id`).
- `OPENAI_EMBEDDING_MODEL` and `LlmClient.embed` with its unit test.
- The MSW embeddings handler and `fakeEmbedding`.

**Verify**: API build, lint, unit tests, and `test:integration`. All existing e2e tests stay green on the new image.

### Task 2: Chunking and the embed job (M)

- `rag/chunking.ts` plus the `renderGithubRepo` extraction (the `buildGithubBlock` output must stay byte-identical; its tests guard this).
- `CandidateChunksRepository.replaceForCandidate`.
- `EmbedCandidateWorker`, the queue registration, `enqueueEmbed`, the parse-worker trigger, the sweep.
- The unit and integration tests above.

**Verify**: API build, lint, unit, integration, and e2e twice.

### Task 3: Search endpoint (M)

- `findNearest`, `findByIds`, `rankCandidates`, `CandidateSearchService`, the controller route and DTOs, the contract check.
- The e2e cases above.

**Verify**: API build, lint, unit, integration, and e2e twice.

### Task 4: Web search (M)

- The `QuoteBlock` move, the api client, `useCandidateSearch`, the `CandidatesPage` rework, `CandidateSearchResults`, deleting the filter, and tests.

**Verify**: web tests twice, `npm run build -w apps/web`, `npm run lint -w apps/web`.

### Checkpoint: Live smoke (main)

- Run `docker compose up -d db` on the pgvector image, then `db:migrate`.
- Wipe the dev candidates (candidates cascade to CVs, applications and scores; recruiters and vacancies are kept). **I'll confirm with you before running the delete.**
- Apply the 8 Checkpoint A CVs (`data/checkpoint-a/`) through the apply flow. Check every candidate ends up with chunks, and record the chunk counts and embedding tokens.
- Queries such as "Kubernetes and Terraform", "React frontend with testing", "machine learning in Python", "Java Spring microservices", "Go", plus a nonsense query:
  - check the top hits and snippets;
  - set `MIN_SIMILARITY` so the nonsense query returns nothing and real queries keep their relevant candidates;
  - record the values in the PR.

### Checkpoint: Browser (main)

- `/candidates`: plain list; Enter runs a ranked search with snippets and match %; `?q=` survives a reload; Escape returns to the list; no-match message.
- The ScoreDrawer quotes still render.
- Kill the servers by PID afterwards.

### Task 5: Docs (main session, inline)

- **`docs/sdd.md`**:
  - title and status;
  - §2 architecture (pgvector, embed job);
  - §3 module map;
  - §4 `candidate_chunks` and `embedded_cv_document_id`;
  - §6 endpoint count plus `POST /candidates/search`;
  - §7 contracts;
  - §8 decisions: chunking, the version key, exact search, threshold, 503;
  - §9 `OPENAI_EMBEDDING_MODEL`;
  - §10 `/candidates` search, `QuoteBlock`, `candidateKeys.search`;
  - §11 tests and smoke results;
  - §12: replace the "client-side substring filter" entry, update "Stage 2 remainder", and add: no HNSW, no embed status in the UI, stale chunks until re-embed, name/email not searchable.
- **README** walkthrough line.
- **`docs/plans/stage-2.md`**: mark the step 7 chunking open question as resolved.
- Run `npx prettier --check .` last.

### Checkpoint: Complete

- Run the CI-equivalent locally.
- Ask for commit approval (plan / api / web / docs).
- Push and open the PR "Stage 2 step 7: embeddings and semantic pool search" (no test plan, no attribution), then watch CI.

## Risks

| Risk                                                                  | Impact | Mitigation                                                                                   |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| Fake e2e embeddings don't reflect real semantics                      | Med    | The hashed bag-of-words keeps keyword relevance testable; the live smoke covers real quality |
| A badly tuned `MIN_SIMILARITY` hides good results or shows noise      | Med    | Tuned on the smoke queries, including a nonsense one; one constant, documented               |
| drizzle-kit migration lacks `CREATE EXTENSION`, or `vector` rc quirks | Med    | Hand-edited migration; integration tests run migrations on the pgvector image                |
| A failed embed silently leaves a candidate unsearchable               | Low    | pg-boss retries plus the startup sweep; the UI caption; §12                                  |
| Name or email queries return nothing useful                           | Low    | The plain list stays one Escape away; documented                                             |
| `renderGithubRepo` extraction changes the scorer's GitHub block       | Low    | Byte-identical output asserted by the existing prompt tests                                  |

## Out of scope

- Find matches for a vacancy (step 8) and the RAG scoring mode (step 9).
- An ANN index, pagination, hybrid keyword + vector search.
- An embed status in the contract or UI, and a backfill command.
- Highlighting the matched terms inside snippets.
