# Evidence recall@k: small-500

Index: database `rag_ats_exp_small_500`, chunks embedded with `text-embedding-3-small`; 100 candidates, 602 CV chunks (mean 431, max 500 chars) and 160 GitHub chunks. Criterion texts (99) embedded with `text-embedding-3-small`.

Labels: the quotes of the `full_text` run 1 scores of `baseline-units`: 2081 criteria with evidence, 5250 quotes (4848 CV, 402 GitHub). These are silver labels: what the `full_text` scorer cited, not human-judged evidence.

A quote is covered at k when one of the candidate's k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.

| k   | Quote recall | CV      | GitHub  | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |
| --- | ------------ | ------- | ------- | -------------------- | ------------------- | ------------- | --------------- |
| 1   | 39.1 %       | 41.0 %  | 16.4 %  | 16.1 %               | 71.0 %              | 461           | 14.0 %          |
| 2   | 60.2 %       | 62.7 %  | 29.6 %  | 34.4 %               | 89.1 %              | 918           | 28.0 %          |
| 3   | 74.2 %       | 77.3 %  | 37.1 %  | 52.8 %               | 94.9 %              | 1375          | 42.0 %          |
| 4   | 83.7 %       | 86.7 %  | 48.3 %  | 67.9 %               | 97.5 %              | 1823          | 55.5 %          |
| 5   | 90.6 %       | 93.2 %  | 59.5 %  | 80.2 %               | 99.0 %              | 2250          | 68.3 %          |
| 6   | 94.5 %       | 96.6 %  | 69.2 %  | 87.9 %               | 99.5 %              | 2613          | 78.2 %          |
| 8   | 98.6 %       | 99.4 %  | 89.1 %  | 96.6 %               | 99.9 %              | 3219          | 91.4 %          |
| 10  | 99.9 %       | 100.0 % | 99.3 %  | 99.8 %               | 100.0 %             | 3711          | 98.6 %          |
| all | 100.0 %      | 100.0 % | 100.0 % | 99.9 %               | 100.0 %             | 3817          | 100.0 %         |

Run 2026-11-22T15:16:25.495Z; embedding spend $0.0000.
