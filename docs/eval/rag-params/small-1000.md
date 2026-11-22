# Evidence recall@k: small-1000

Index: database `rag_ats_seed`, chunks embedded with `text-embedding-3-small`; 100 candidates, 303 CV chunks (mean 810, max 1000 chars) and 160 GitHub chunks. Criterion texts (99) embedded with `text-embedding-3-small`.

Labels: the quotes of the `full_text` run 1 scores of `baseline-units`: 2081 criteria with evidence, 5250 quotes (4848 CV, 402 GitHub). These are silver labels: what the `full_text` scorer cited, not human-judged evidence.

A quote is covered at k when one of the candidate's k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.

| k   | Quote recall | CV      | GitHub  | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |
| --- | ------------ | ------- | ------- | -------------------- | ------------------- | ------------- | --------------- |
| 1   | 42.9 %       | 44.5 %  | 23.9 %  | 18.0 %               | 72.7 %              | 801           | 25.5 %          |
| 2   | 69.4 %       | 71.9 %  | 38.6 %  | 47.4 %               | 90.9 %              | 1607          | 51.0 %          |
| 3   | 86.2 %       | 88.9 %  | 53.2 %  | 73.9 %               | 97.1 %              | 2296          | 72.0 %          |
| 4   | 93.6 %       | 95.8 %  | 67.4 %  | 87.2 %               | 98.8 %              | 2698          | 82.4 %          |
| 5   | 97.0 %       | 98.1 %  | 83.6 %  | 93.7 %               | 99.5 %              | 3001          | 88.1 %          |
| 6   | 99.2 %       | 99.5 %  | 94.8 %  | 98.2 %               | 99.9 %              | 3330          | 93.9 %          |
| 8   | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3672          | 100.0 %         |
| 10  | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3672          | 100.0 %         |
| all | 100.0 %      | 100.0 % | 100.0 % | 100.0 %              | 100.0 %             | 3672          | 100.0 %         |

Run 2026-11-22T15:16:14.691Z; embedding spend $0.0000.
