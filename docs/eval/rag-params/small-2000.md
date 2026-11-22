# Evidence recall@k: small-2000

Index: database `rag_ats_exp_small_2000`, chunks embedded with `text-embedding-3-small`; 100 candidates, 177 CV chunks (mean 1354, max 1999 chars) and 160 GitHub chunks. Criterion texts (99) embedded with `text-embedding-3-small`.

Labels: the quotes of the `full_text` run 1 scores of `baseline-units`: 2081 criteria with evidence, 5250 quotes (4848 CV, 402 GitHub). These are silver labels: what the `full_text` scorer cited, not human-judged evidence.

A quote is covered at k when one of the candidate's k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.

| k   | Quote recall | CV      | GitHub  | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |
| --- | ------------ | ------- | ------- | -------------------- | ------------------- | ------------- | --------------- |
| 1   | 55.6 %       | 57.9 %  | 28.1 %  | 42.4 %               | 72.9 %              | 1266          | 41.8 %          |
| 2   | 84.0 %       | 87.3 %  | 44.5 %  | 77.4 %               | 92.3 %              | 2272          | 73.4 %          |
| 3   | 91.1 %       | 93.4 %  | 64.2 %  | 85.8 %               | 96.2 %              | 2606          | 80.3 %          |
| 4   | 96.1 %       | 97.1 %  | 84.3 %  | 93.5 %               | 98.5 %              | 2967          | 87.3 %          |
| 5   | 99.0 %       | 99.4 %  | 94.0 %  | 98.2 %               | 99.6 %              | 3332          | 94.2 %          |
| 6   | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |
| 8   | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |
| 10  | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |
| all | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3613          | 100.0 %         |

Run 2026-11-22T15:16:36.796Z; embedding spend $0.0000.
