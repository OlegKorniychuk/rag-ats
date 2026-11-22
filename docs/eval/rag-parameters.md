# RAG parameters: embedding model, chunk size and k

Three retrieval parameters were measured on the synthetic set:

- **A:** the embedding model, `text-embedding-3-small` against `text-embedding-3-large`.
- **B:** the CV chunk size, 500, 1000 or 2000 characters.
- **C:** k, the number of chunks per criterion in `rag` scoring.

**Outcome: production stays as it is** (`text-embedding-3-small`, 1000-character CV chunks, k 3).

- Large gives no consistent gain and costs 6.5× more.
- 500-character chunks rank search results better and get more of the cited evidence into the same amount of context. They also cost Find matches precision, and re-tuning Find matches does not win it back (floor sweep below).
- With CVs this short, every k that reaches the plateau of the decision rule sends most of the CV.

The rules for B and C call for changes. B's proposal was tested further and rejected (Find matches floor sweep); C's is listed as a proposal and was not applied. Run files: `rag-params/<variant>.{json,md}` (evidence recall) and `baseline/rag-<variant>.{json,md}` (retrieval).

## Setup

- **Variants:** a 2 × 3 grid of the two embedding models and three CV chunk sizes.
  - `small-1000` is production: the seeded `rag_ats_seed` database itself.
  - Each other variant is a copy of it (`createdb -T rag_ats_seed rag_ats_exp_<model>_<size>`) whose `candidate_chunks` were rebuilt by the `reindex` CLI (sdd §11).
  - GitHub chunks (a profile chunk plus one per repository, at most 1500 chars) and the overlap rule (the previous chunk's last line is repeated if it is ≤ 200 chars) are the same in every variant.
- **Index sizes** (100 candidates):

  | CV chunk size | CV chunks | Mean / max CV chunk chars | GitHub chunks | Chunks per candidate |
  | ------------- | --------: | ------------------------: | ------------: | -------------------: |
  | 500           |       602 |                 431 / 500 |           160 |                 7.62 |
  | 1000          |       303 |                810 / 1000 |           160 |                 4.63 |
  | 2000          |       177 |               1354 / 1999 |           160 |                 3.37 |

- **Large at 1536 dimensions.** `text-embedding-3-large` was called with `dimensions: 1536` (OpenAI shortens the vector on its side), so it fits the existing `vector(1536)` column without a migration. `LlmClient.embed` now sends `dimensions` for `text-embedding-3-*` models; it is small's native size, and the production retrieval metrics reproduced exactly (below). Native 3072 dimensions would need a schema change, and pgvector's HNSW index on `vector` stops at 2000 dimensions.
- **Search and Find matches:** the existing retrieval eval (`eval --part retrieval`) on each variant: 20 queries and 10 vacancies, the same ground truth as `eval-baseline.md`.
  - The similarity floors (`MIN_SIMILARITY` 0.3 for search, 0.35 for Find matches by criteria) were tuned on small with 1000-char chunks.
  - Search is therefore shown at the production floor and at the best floor of the eval's sweep (0.2–0.35). Find matches is shown at production floors only.
  - The production variant reproduced `baseline-units` exactly: search nDCG@10 0.810, Find matches P@10 1.00.
- **Evidence recall@k** (new, `evidence-eval`, sdd §11): measures how much of the evidence a criterion needs reaches the `rag` scorer at a given k.
  - Labels: the 2081 criteria of the `baseline-units` `full_text` run 1 scores that cite evidence, with 5250 quotes (4848 CV, 402 GitHub).
  - For each criterion, its text is embedded with the variant's model, and the candidate's chunks are ranked as `rag` scoring ranks them (`findNearest(…, { candidateId })`).
  - A quote is covered at k when one of the top k chunks of the same source contains it, whitespace ignored.
  - These are **silver labels**: what the `full_text` scorer cited, not human-judged evidence.
  - At k = all, recall was 100.0 % in every variant, so chunk boundaries cut practically no cited unit; every loss below is ranking.
- **Decision rules**, written down before the runs (task plan):
  - **A:** recommend large only if, at its best floor, search nDCG@10 ≥ small + 0.03 **and** quote recall@3 ≥ small + 3 pp.
  - **B:** recommend a size other than 1000 only if its quote recall at an equal context budget beats 1000 @ k 3 by ≥ 3 pp **and** its search nDCG@10 is no worse by more than 0.02.
  - **C:** the smallest k with quote recall ≥ 90 % where the next reported k adds < 2 pp.
  - Any change is a separate decision: it means re-embedding the pool and re-running the baseline.

## A: embedding model

| Variant    | Search nDCG@10 (floor 0.3 / best) | P@5  | R@20  | MRR   | Find matches P@10 (criteria / whole text) | Quote recall@3 |
| ---------- | --------------------------------- | ---- | ----- | ----- | ----------------------------------------- | -------------- |
| small-500  | 0.837 / 0.837                     | 0.78 | 0.888 | 0.938 | 0.93 / 0.93                               | 74.2 %         |
| large-500  | 0.846 / 0.846                     | 0.80 | 0.890 | 0.967 | 0.97 / 0.96                               | 76.2 %         |
| small-1000 | **0.810 / 0.810**                 | 0.81 | 0.857 | 0.917 | **1.00 / 0.98**                           | **86.2 %**     |
| large-1000 | 0.784 / 0.787                     | 0.73 | 0.844 | 0.950 | 1.00 / 0.97                               | 88.0 %         |
| small-2000 | 0.755 / 0.755                     | 0.73 | 0.809 | 0.933 | 0.91 / 0.97                               | 91.1 %         |
| large-2000 | 0.738 / 0.745                     | 0.72 | 0.789 | 0.950 | 0.92 / 0.98                               | 92.1 %         |

Bold: production.

How large compares with small:

- **Evidence recall@3:** 1–2 pp higher at every chunk size.
- **Search:** better at 500 (+0.009 nDCG@10) and worse at 1000 and 2000 (−0.023 and −0.010 at the best floor).
- **MRR:** higher everywhere; it finds a fully relevant candidate first more often.
- **Precision:** P@5 is lower at 1000.

**Verdict A:** the rule is not met at the production size (search −0.023, recall +1.8 pp), nor at any other size. Keep `text-embedding-3-small`. Large's embedding cost was 6.5× small's for the same chunks ($0.0105 against $0.0016 to re-index the 500-character variant).

## B and C: chunk size and k

Quote recall at each k (small, then large); context is the mean characters of the top k chunks:

| k   | 500 small | 500 large | context | 1000 small | 1000 large | context | 2000 small | 2000 large | context |
| --- | --------- | --------- | ------: | ---------- | ---------- | ------: | ---------- | ---------- | ------: |
| 1   | 39.1 %    | 40.6 %    |     461 | 42.9 %     | 43.2 %     |     801 | 55.6 %     | 53.7 %     |    1266 |
| 2   | 60.2 %    | 61.7 %    |     918 | 69.4 %     | 71.8 %     |    1607 | 84.0 %     | 86.1 %     |    2272 |
| 3   | 74.2 %    | 76.2 %    |    1375 | **86.2 %** | 88.0 %     |    2296 | 91.1 %     | 92.1 %     |    2606 |
| 4   | 83.7 %    | 85.6 %    |    1823 | 93.6 %     | 94.4 %     |    2698 | 96.1 %     | 96.7 %     |    2967 |
| 5   | 90.6 %    | 91.0 %    |    2250 | 97.0 %     | 97.5 %     |    3001 | 99.0 %     | 99.2 %     |    3332 |
| 6   | 94.5 %    | 94.5 %    |    2613 | 99.2 %     | 99.3 %     |    3330 | 100.0 %    | 100.0 %    |    3613 |
| 8   | 98.6 %    | 98.5 %    |    3219 | 100.0 %    | 100.0 %    |    3672 | 100.0 %    | 100.0 %    |    3613 |
| 10  | 99.9 %    | 99.8 %    |    3711 | 100.0 %    | 100.0 %    |    3672 | 100.0 %    | 100.0 %    |    3613 |

The share of a candidate's chunks that the top 3 covers is 42 % at 500, 72 % at 1000 and 80 % at 2000. The context column is from the small runs; large differs by < 2 %.

**Equal context budget.** Compared at about 2,300 characters sent per criterion, small chunks win:

| Index (small) | Context chars | Quote recall | Criteria with all quotes | Search nDCG@10 | Find matches P@10 (criteria) |
| ------------- | ------------: | ------------ | ------------------------ | -------------- | ---------------------------- |
| 500 @ k 5     |          2250 | **90.6 %**   | 80.2 %                   | **0.837**      | 0.93                         |
| 1000 @ k 3    |          2296 | 86.2 %       | 73.9 %                   | 0.810          | **1.00**                     |
| 2000 @ k 2    |          2272 | 84.0 %       | 77.4 %                   | 0.755          | 0.91                         |

Smaller chunks are more specific, so the nearest ones hold the cited lines more often. The same holds for search, which ranks candidates by their best chunk. 2000-character chunks mix whole CV sections and are worst for search.

**GitHub evidence is retrieved poorly at every size.** At 1000 @ k 3, 53 % of cited GitHub quotes are in the top 3, against 89 % of CV quotes. A per-repository chunk is less similar to a skill criterion than the CV line that names the skill, so GitHub evidence is ranked below the CV chunks. In `rag` mode a criterion backed mainly by a repository is more likely to be scored from the CV alone.

**Verdict B:** the rule is met by 500 characters: +4.4 pp recall at equal context and +0.027 search nDCG@10. But Find matches by criteria drops from P@10 1.00 to 0.93 (0.98 to 0.93 in whole-text mode), which the rule did not cover. Its 0.35 floor was tuned on 1000-character chunks and was not re-tuned here.

**Proposal rejected:** 500-character CV chunks with k 5, together with a re-tuned Find matches floor. The floor sweep below shows that re-tuning does not recover Find matches precision, so 1000 stays.

**Verdict C:** on the production index the rule gives **k 6**: 99.2 % recall, and k 8 adds 0.8 pp. But k 6 sends 94 % of a candidate's chunks, so `rag` would become `full_text` in all but name. At k 3, production already gets 86 % of the cited evidence, and `rag` and `full_text` scores agree to within noise (`eval-baseline.md`: MAE 7.7 against 7.6, ρ 0.940 against 0.936). So the missing 14 % of quotes cost little score accuracy on this set: they are mostly second and third quotes of a criterion that is already supported (any quote covered for 97.1 % of criteria at k 3).

**Proposal, not run:** before changing k, a paid `rag` scoring check at the new k (`eval --modes rag`, about 100 pairs, about $0.5). Until then, k stays 3. On CVs this short, k matters much less than chunk size; the parameter would matter for long profiles, which the synthetic set does not have (sdd §12).

## Find matches floor sweep (follow-up)

Verdict B left one question open: does a re-tuned Find matches floor recover the P@10 that 500-character chunks lose? It does not.

- **Setup:** an ad-hoc script (not kept in the repo) ran the eval's `evaluateMatches` (the production rankers, whole pool, the same 10 vacancies and ground truth) on `rag_ats_seed` (1000) and on a fresh `rag_ats_exp_small_500` (re-indexed, dropped afterwards).
  - `criteria` mode: floor 0.30–0.45 × nearest chunks per criterion 30 (production), 60, 100.
  - `whole_text` mode: floor 0.25–0.40 × nearest chunks 50 (production), 100, 200.
  - Search was not re-swept: its best floor at 500 is already the production 0.3 (verdict A table).
- **Run files:** `rag-params/find-matches-sweep-small-{1000,500}.json`.

| Index | Mode         | Floor, chunks             | P@5  | P@10     | nDCG@10 | R@20        | Weak in top 10 |
| ----- | ------------ | ------------------------- | ---- | -------- | ------- | ----------- | -------------- |
| 1000  | `criteria`   | 0.35, 30 (production)     | 1.00 | **1.00** | 0.874   | 0.733       | 0 %            |
| 500   | `criteria`   | 0.35, 30 (production)     | 0.98 | 0.92     | 0.839   | 0.704       | 8 %            |
| 500   | `criteria`   | 0.40, 30 (best floor)     | 0.98 | 0.93     | 0.843   | 0.689       | 7 %            |
| 500   | `criteria`   | 0.40, 100 (best of grid)  | 0.98 | 0.98     | 0.871   | 0.708       | 2 %            |
| 1000  | `criteria`   | 0.40, 100 (same setting)  | 1.00 | 0.99     | 0.896   | 0.710       | 1 %            |
| 1000  | `whole_text` | 0.30, 50 (production)     | 1.00 | **0.98** | 0.878   | 0.714       | 2 %            |
| 500   | `whole_text` | any floor and chunk limit | 0.96 | 0.93     | 0.844   | 0.695–0.715 | 7 %            |

- **The floor alone does not help:** at the production chunk limit the best 500 floor gives P@10 0.93.
- **The chunk limit is most of the loss:** the 500 index has 762 chunks against 463, so the 30 nearest chunks per criterion reach fewer candidates. Floor 0.40 with 100 chunks reaches P@10 0.98, still below production, and it is two constants fitted on 10 vacancies (the gap is 2 of 100 top-10 slots).
- **`whole_text` cannot be tuned back:** the nearest 50–100 chunks are all above 0.40, so the floor changes nothing, and it ranks a candidate by their best chunk; a short chunk that names one skill lifts a weak candidate.
- The production 500 setting reads P@10 0.92 here against 0.93 in the verdict A table: the index was re-embedded, one top-10 slot.

**Verdict:** 500-character chunks with k 5 are a trade, not a gain. They raise search nDCG@10 by 0.027 and `rag` evidence recall by 4.4 pp, in a mode that is not the default and already scores as well as `full_text`, and they lower Find matches P@10 by 0.02–0.07. The proposal is dropped; the paid `rag` check at k 5 and a production re-index path are not needed. Production stays at 1000 characters, k 3.

## The small-model check of retrieved chunks

Ch. 2 of the thesis listed an optional step: a small model checks each retrieved chunk for relevance before scoring. It was not built, because these results and the earlier ones show no problem it would solve:

1. **The `rag` scorer already handles irrelevant chunks.** Its prompt says retrieved chunks may be irrelevant and that a criterion with no supporting chunk scores 0.
2. **The one retrieval failure observed was a missed relevant chunk** (a mentoring chunk ranked 4th, `rag-scoring.md`). A filter removes chunks; it cannot add a missed one. Here too, recall at k = all is 100 % at 1000 and 2000 characters (2 of 5250 quotes are cut by a chunk boundary at 500), so the losses are cited evidence ranked below k.
3. **`rag` scores as well as `full_text`, which retrieves nothing**: MAE 7.7 against 7.6, and irrelevant citations 4/40 against 3/40 in the citation review.
4. **There is little to filter:** about 4.6 chunks per candidate, so the top 3 is most of the CV.

## Cost

| Step                                                | Spend      |
| --------------------------------------------------- | ---------- |
| Re-index, small × 2 (500, 2000)                     | $0.0031    |
| Re-index, large × 3 (500, 1000, 2000)               | $0.0305    |
| Retrieval eval × 6 (query and vacancy embeddings)   | $0.0011    |
| Floor sweep: re-index small 500, vacancy embeddings | $0.0017    |
| Evidence eval × 6 (99 criterion texts each)         | $0.0004    |
| **Total**                                           | **$0.037** |

Prices: small $0.02, large $0.13 per 1M tokens (listed, unverified). No chat model was called.
