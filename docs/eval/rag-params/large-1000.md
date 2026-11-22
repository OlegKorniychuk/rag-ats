# Evidence recall@k: large-1000

Index: database `rag_ats_exp_large_1000`, chunks embedded with `text-embedding-3-large`; 100 candidates, 303 CV chunks (mean 810, max 1000 chars) and 160 GitHub chunks. Criterion texts (99) embedded with `text-embedding-3-large`.

Labels: the quotes of the `full_text` run 1 scores of `baseline-units`: 2081 criteria with evidence, 5250 quotes (4848 CV, 402 GitHub). These are silver labels: what the `full_text` scorer cited, not human-judged evidence.

A quote is covered at k when one of the candidate's k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.

| k   | Quote recall | CV      | GitHub  | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |
| --- | ------------ | ------- | ------- | -------------------- | ------------------- | ------------- | --------------- |
| 1   | 43.2 %       | 45.2 %  | 19.4 %  | 17.6 %               | 72.4 %              | 799           | 25.5 %          |
| 2   | 71.8 %       | 75.2 %  | 30.8 %  | 49.7 %               | 92.7 %              | 1620          | 51.0 %          |
| 3   | 88.0 %       | 91.7 %  | 43.3 %  | 76.2 %               | 97.7 %              | 2315          | 72.0 %          |
| 4   | 94.4 %       | 97.2 %  | 60.7 %  | 88.7 %               | 98.9 %              | 2697          | 82.4 %          |
| 5   | 97.5 %       | 98.9 %  | 80.6 %  | 94.8 %               | 99.7 %              | 2992          | 88.1 %          |
| 6   | 99.3 %       | 99.8 %  | 93.8 %  | 98.5 %               | 100.0 %             | 3322          | 93.9 %          |
| 8   | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3672          | 100.0 %         |
| 10  | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3672          | 100.0 %         |
| all | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3672          | 100.0 %         |

Run 2026-11-22T15:16:58.643Z; embedding spend $0.0001.
