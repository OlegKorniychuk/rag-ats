# Evidence recall@k: large-2000

Index: database `rag_ats_exp_large_2000`, chunks embedded with `text-embedding-3-large`; 100 candidates, 177 CV chunks (mean 1354, max 1999 chars) and 160 GitHub chunks. Criterion texts (99) embedded with `text-embedding-3-large`.

Labels: the quotes of the `full_text` run 1 scores of `baseline-units`: 2081 criteria with evidence, 5250 quotes (4848 CV, 402 GitHub). These are silver labels: what the `full_text` scorer cited, not human-judged evidence.

A quote is covered at k when one of the candidate's k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.

| k   | Quote recall | CV      | GitHub  | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |
| --- | ------------ | ------- | ------- | -------------------- | ------------------- | ------------- | --------------- |
| 1   | 53.7 %       | 56.1 %  | 24.9 %  | 40.4 %               | 71.8 %              | 1243          | 41.8 %          |
| 2   | 86.1 %       | 89.9 %  | 40.0 %  | 79.1 %               | 93.8 %              | 2315          | 73.4 %          |
| 3   | 92.1 %       | 94.9 %  | 59.2 %  | 87.3 %               | 97.1 %              | 2622          | 80.3 %          |
| 4   | 96.7 %       | 97.9 %  | 82.1 %  | 94.4 %               | 99.1 %              | 2965          | 87.3 %          |
| 5   | 99.2 %       | 99.7 %  | 94.0 %  | 98.5 %               | 99.9 %              | 3328          | 94.2 %          |
| 6   | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |
| 8   | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |
| 10  | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |
| all | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |

Run 2026-11-22T15:17:10.224Z; embedding spend $0.0001.
