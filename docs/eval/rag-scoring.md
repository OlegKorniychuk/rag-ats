# RAG scoring — live comparison with full-text scoring

Stage 2 step 9 (`docs/plans/stage-2-step-9.md`). The same Checkpoint B set (4 vacancies × 8 Checkpoint A CVs, 2 runs) was scored in the new `rag` mode and compared with the tuned full-text run `tuned-2` (`docs/eval/checkpoint-b.md`). The harness is `npm run score-eval -w apps/api -- --label <name> --mode rag --runs 2 --write-review`. It chunks the CVs and GitHub data with the production chunker, embeds them in memory, retrieves with the same exact-cosine top-k and scores with the production `ApplicationScorer.scoreRag`. No database, server or queue is involved.

**Outcome:**

- **With lenient grounding, RAG scoring matches full text on this set.** It grounds every score (64/64), hits every expected band (52/52) and fails nothing. Scores differ from full text by 3.0 points on average (max 12). Run-to-run spread is a little higher (mean 2.7 vs 1.8, max 9 vs 6).
- **Strict per-criterion grounding failed 19% of pairs** (`rag-1`). Every failure was on a CV that had GitHub data, and the scores were real evidence the strict rule rejected. The relevant CV chunk had been retrieved for a different criterion, so the step switched to lenient grounding.
- **RAG barely hides anything on these CVs.** They are short (2–3 chunks each), so the model saw 92% of each candidate's chunks on average (100% for every CV-only candidate, 67–72% for the two with GitHub data). This set cannot show RAG's main benefit, which is scoring long profiles from a small slice.
- **Cost is about the same**: $0.0053 vs $0.0049 per score. RAG prompts are larger for short CVs (rules, evidence lines, overlapping chunks) and smaller for GitHub-heavy profiles.
- **Default stays `full_text`.** `rag` is available via `SCORING_MODE` and for the step 11 eval.

## Setup

- **Chunks:** CV text packed on line boundaries into ~1,000-character windows; one chunk per GitHub repo plus a profile chunk (step 7). 2–3 chunks per CV-only candidate; 10 (05-mobile) and 9 (08-injection) with GitHub data.
- **Retrieval:** per criterion, the 3 nearest chunks of the candidate (`text-embedding-3-small`, exact cosine), no similarity floor.
- **Prompt:** one call per application. `<criteria>` lines end with the ids of the chunks retrieved for each criterion, and `<evidence>` lists every distinct chunk once. The system prompt is the tuned full-text prompt plus a RAG rules block (`prompts/rag-2/application-score-rag.prompt.ts`).
- **Grounding:**
  - `rag-1` was **strict**: a criterion's quotes had to come from its own retrieved chunks.
  - `rag-2` is **lenient**: a quote may come from any chunk retrieved for the application, but never from unretrieved text. In both rounds a quote can't straddle two chunks.

## Results

| Run (`docs/eval/checkpoint-b/`) | Mode      | Grounding | Grounded  | Failed | Retried | Band agreement   | Spread mean / max | Evidence coverage mean / min | Cost (64 scores + 8 extractions + embeddings) |
| ------------------------------- | --------- | --------- | --------- | ------ | ------- | ---------------- | ----------------- | ---------------------------- | --------------------------------------------- |
| `tuned-2`                       | full text | —         | 64/64     | 0      | 2       | 52/52 (100%)     | 1.8 / 6           | —                            | $0.3259                                       |
| `rag-1`                         | RAG       | strict    | 52/52     | **12** | 15      | 40/52 (76.9%)    | 2.4 / 11          | 96% / 56%                    | $0.4321                                       |
| `rag-2`                         | RAG       | lenient   | **64/64** | **0**  | 2       | **52/52 (100%)** | 2.7 / 9           | 92% / 56%                    | $0.3483                                       |

Embeddings cost $0.0002 per run (about 7.5k tokens: 6.6k for the CV chunks once, about 470 per run for the criteria).

**Tokens per score**, first attempts only:

| Run       | Input, CV-only candidates | Input, candidates with GitHub data | Output |
| --------- | ------------------------- | ---------------------------------- | ------ |
| `tuned-2` | 1,633                     | 3,351                              | 717    |
| `rag-2`   | 2,168                     | 2,814                              | 765    |

**Agreement with full text** (`tuned-2` vs `rag-2`, same pair and run): mean absolute difference 3.0 points, max 12. The largest moves are all on partial or ambiguous pairs, and RAG scored them higher every time:

- 06-career-switcher on `frontend-react`: 19 → 31 and 19 → 30;
- 02-senior-backend on `devops-platform`: 50 → 62 and 54 → 64;
- 07-ukrainian on `devops-platform`: 44 → 56.

No pair changed band.

## Why strict grounding failed

All 12 `rag-1` failures were on the two candidates with GitHub data (05-mobile 7 of 8 runs, 08-injection 4 of 8), plus one run of 07-ukrainian. A diagnostic re-run of 05-mobile × `backend-java` printed the verifier's problems.

The mentoring criterion's top-3 were two CV chunks and a GitHub chunk. The CV chunk containing "Interview and mentor mobile candidates and junior developers." ranked fourth, because it is a long chunk that opens with the header and summary. That chunk had been retrieved for other criteria, so the model saw it in `<evidence>`, quoted it for mentoring, and the strict check rejected it twice. With seven GitHub chunks competing for three slots per criterion, this happened on most vacancies.

The rejected quotes were real evidence in front of the model, not hallucinations, so `rag-2` accepts any retrieved chunk. Unretrieved text and quotes straddling two chunks still fail.

A separate, rarer failure seen while diagnosing: the model sometimes writes a heading as a label, e.g. "Profile: Mobile developer…" for a CV that has `PROFILE` on its own line. The retry fixes it; in `rag-2` it caused 2 retries and no failures.

## Citation review

A seeded random sample of 30 `rag-2` citations (`--sample 30 --seed 13`) was labelled with the Checkpoint B rubric: 16 supports, 12 weak, 2 irrelevant, so **93.3% supports + weak** (`rag-2.review.md`, `rag-2.review.summary.md`). The two irrelevant ones are a bare repository heading and a bare job title, the same kinds the Checkpoint B tuning reduced. Contrary-evidence quotes for criteria scored 0 (e.g. "Full-stack developer with five years of experience building SaaS products with React, Node.js and PostgreSQL." against ML and data-warehouse criteria) were present and relevant.

`tuned-2`'s full review was 97.2% (287 citations). A 30-row sample can't separate the two; a full review belongs to the step 11 eval if RAG is pursued further.

## Limits and what would change the picture

- **Short profiles.** With 2–3 chunks per CV, top-3 per criterion shows almost everything. The synthetic set (step 10) should include longer CVs and richer GitHub data, where RAG actually filters.
- **Chunk size.** The diagnosed miss came from a 1,000-character chunk mixing the header, summary and a role. Smaller CV chunks would sharpen retrieval, at the cost of re-tuning the step 7/8 similarity floors.
- **One set, two runs, hand-set rules.** Same caveats as Checkpoint B; prices are third-party figures for `gpt-5.4-mini`, unverified against OpenAI's pricing page.
