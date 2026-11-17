# Seed report: smoke

- Date: 2026-11-17T19:34:51.046Z
- Database: rag_ats_seed on localhost:5432
- Scoring mode: full_text
- Model: gpt-5.4-mini (embeddings: text-embedding-3-small)
- Duration: 39s
- Stopped: no (ran to completion)
- Cap: $0.5000

## Result

| Metric                | Count |
| --------------------- | ----: |
| Personas (candidates) |     3 |
| Parsed                |     3 |
| Parse failed          |     0 |
| Parse not finished    |     0 |
| Embedded              |     3 |
| Applications          |     7 |
| Scored                |     6 |
| Score failed          |     1 |
| Score pending         |     0 |

Parse success: 100.0% against the SPEC criterion of at least 90% (met).

## Tokens and cost

- Chat: 16 calls, 22604 input / 8835 output tokens, $0.0567
- Embeddings: 3 calls, 3156 tokens, $0.0001
- Total: $0.0568
- Pricing: 0.75 / 4.5 USD per 1M input / output tokens. Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

| Call (schema)     | Calls | Input tokens | Output tokens |
| ----------------- | ----: | -----------: | ------------: |
| vacancy_criteria  |     5 |         3277 |           851 |
| cv_profile        |     3 |         4357 |          1063 |
| application_score |     8 |        14970 |          6921 |

## Failed scores

| Application                          | Candidate                            | Vacancy          | Error                                |
| ------------------------------------ | ------------------------------------ | ---------------- | ------------------------------------ |
| d65f00a7-9e8a-4c58-a908-1c462f222960 | ba5463fe-c6ef-4df8-b81f-f6571e168d19 | Backend Engineer | Could not ground the score in the CV |
