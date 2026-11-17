# Seed report: full-retry-2

- Date: 2026-11-17T20:10:14.600Z
- Database: rag_ats_seed on localhost:5432
- Scoring mode: full_text
- Model: gpt-5.4-mini (embeddings: text-embedding-3-small)
- Duration: 25s
- Stopped: no (ran to completion)
- Failed scores retried: 4
- Cap: $0.2000

## Result

| Metric                | Count |
| --------------------- | ----: |
| Personas (candidates) |   100 |
| Parsed                |   100 |
| Parse failed          |     0 |
| Parse not finished    |     0 |
| Embedded              |   100 |
| Applications          |   232 |
| Scored                |   230 |
| Score failed          |     2 |
| Score pending         |     0 |

Parse success: 100.0% against the SPEC criterion of at least 90% (met).

## Tokens and cost

- Chat: 6 calls, 10085 input / 4332 output tokens, $0.0271
- Embeddings: 0 calls, 0 tokens, $0.0000
- Total: $0.0271
- Pricing: 0.75 / 4.5 USD per 1M input / output tokens. Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

| Call (schema)     | Calls | Input tokens | Output tokens |
| ----------------- | ----: | -----------: | ------------: |
| application_score |     6 |        10085 |          4332 |

## Failed scores

| Application                          | Candidate                            | Vacancy                | Error                                |
| ------------------------------------ | ------------------------------------ | ---------------------- | ------------------------------------ |
| 485345d1-7595-4e0f-94ea-913663376741 | 3bf6b5ef-e5e5-4349-a911-d7c66f83b5c0 | QA Automation Engineer | Could not ground the score in the CV |
| be2257c6-f094-481c-b4d7-ff5369d3ed0e | 239456dc-9470-4fbd-98d4-3b7cec43c9cf | Mobile Engineer        | Could not ground the score in the CV |
