# Seed report: full

- Date: 2026-11-17T19:51:48.276Z
- Database: rag_ats_seed on localhost:5432
- Scoring mode: full_text
- Model: gpt-5.4-mini (embeddings: text-embedding-3-small)
- Duration: 689s
- Stopped: no (ran to completion)
- Cap: $3.0000

## Result

| Metric                | Count |
| --------------------- | ----: |
| Personas (candidates) |   100 |
| Parsed                |   100 |
| Parse failed          |     0 |
| Parse not finished    |     0 |
| Embedded              |   100 |
| Applications          |   232 |
| Scored                |   221 |
| Score failed          |    11 |
| Score pending         |     0 |

Parse success: 100.0% against the SPEC criterion of at least 90% (met).

## Tokens and cost

- Chat: 374 calls, 626605 input / 282552 output tokens, $1.7414
- Embeddings: 97 calls, 74455 tokens, $0.0015
- Total: $1.7429
- Pricing: 0.75 / 4.5 USD per 1M input / output tokens. Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.

| Call (schema)     | Calls | Input tokens | Output tokens |
| ----------------- | ----: | -----------: | ------------: |
| vacancy_criteria  |     5 |         3254 |           851 |
| cv_profile        |    97 |       130679 |         28624 |
| application_score |   272 |       492672 |        253077 |

## Failed scores

| Application                          | Candidate                            | Vacancy                   | Error                                |
| ------------------------------------ | ------------------------------------ | ------------------------- | ------------------------------------ |
| e4571132-bf1f-4429-b2d4-85c3a3fe24f3 | 3a91b115-4101-4a43-8c4d-3ac47e6a7b50 | Backend Engineer          | Could not ground the score in the CV |
| 08f0bc2a-0bfb-4191-9853-04fd7a915f20 | 8801d1b8-2876-406b-ae2c-66ad066d780a | Backend Engineer          | Could not ground the score in the CV |
| b6a9d5fe-8304-4a72-afc4-288f71d32f82 | 87486a2c-5698-4239-bec1-689b15ed02ca | Mobile Engineer           | Could not ground the score in the CV |
| 6a6e56d1-3581-4a9f-b7b4-106c2c15ffaf | ba98ae86-929f-4709-ad9e-8cd21cc2e620 | QA Automation Engineer    | Could not ground the score in the CV |
| 86fa8a40-8c85-4a9f-83c2-fb09d6ed7805 | 07405175-935c-40fc-810f-fc7904e3bd85 | Machine Learning Engineer | Could not ground the score in the CV |
| 0f2ba257-0a6a-4e27-9f98-04499f087617 | 3bf6b5ef-e5e5-4349-a911-d7c66f83b5c0 | Data Engineer             | Could not ground the score in the CV |
| 485345d1-7595-4e0f-94ea-913663376741 | 3bf6b5ef-e5e5-4349-a911-d7c66f83b5c0 | QA Automation Engineer    | Could not ground the score in the CV |
| d65f00a7-9e8a-4c58-a908-1c462f222960 | ba5463fe-c6ef-4df8-b81f-f6571e168d19 | Backend Engineer          | Could not ground the score in the CV |
| 1ddcd3be-02b0-4377-89a1-c3cb90630d95 | 6c05f7fe-8de9-4f70-a5a7-e4af6d43e660 | Frontend Engineer         | Could not ground the score in the CV |
| 5eac4fea-69fa-4ab8-a642-25caad44e3a6 | 6f3e6eec-861d-4803-abde-a4aba8f8faee | Mobile Engineer           | Could not ground the score in the CV |
| be2257c6-f094-481c-b4d7-ff5369d3ed0e | 239456dc-9470-4fbd-98d4-3b7cec43c9cf | Mobile Engineer           | Could not ground the score in the CV |
