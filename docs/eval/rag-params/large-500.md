# Evidence recall@k: large-500

Index: database `rag_ats_exp_large_500`, chunks embedded with `text-embedding-3-large`; 100 candidates, 602 CV chunks (mean 431, max 500 chars) and 160 GitHub chunks. Criterion texts (99) embedded with `text-embedding-3-large`.

Labels: the quotes of the `full_text` run 1 scores of `baseline-units`: 2081 criteria with evidence, 5250 quotes (4848 CV, 402 GitHub). These are silver labels: what the `full_text` scorer cited, not human-judged evidence.

A quote is covered at k when one of the candidate's k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.

| k   | Quote recall | CV      | GitHub  | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |
| --- | ------------ | ------- | ------- | -------------------- | ------------------- | ------------- | --------------- |
| 1   | 40.6 %       | 42.6 %  | 15.4 %  | 16.0 %               | 72.5 %              | 460           | 14.0 %          |
| 2   | 61.7 %       | 65.0 %  | 21.9 %  | 35.1 %               | 90.0 %              | 909           | 28.0 %          |
| 3   | 76.2 %       | 79.9 %  | 30.8 %  | 54.8 %               | 95.4 %              | 1361          | 42.0 %          |
| 4   | 85.6 %       | 89.4 %  | 40.0 %  | 71.0 %               | 97.6 %              | 1813          | 55.5 %          |
| 5   | 91.0 %       | 94.6 %  | 48.0 %  | 80.8 %               | 98.5 %              | 2236          | 68.3 %          |
| 6   | 94.5 %       | 97.4 %  | 59.0 %  | 88.2 %               | 99.4 %              | 2591          | 78.2 %          |
| 8   | 98.5 %       | 99.7 %  | 83.6 %  | 96.8 %               | 99.9 %              | 3190          | 91.4 %          |
| 10  | 99.8 %       | 100.0 % | 97.8 %  | 99.6 %               | 100.0 %             | 3703          | 98.6 %          |
| all | 100.0 %      | 100.0 % | 100.0 % | 99.9 %               | 100.0 %             | 3817          | 100.0 %         |

Run 2026-11-22T15:16:47.596Z; embedding spend $0.0001.
