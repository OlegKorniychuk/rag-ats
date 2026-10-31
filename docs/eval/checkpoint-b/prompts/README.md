# Checkpoint B prompt versions

Snapshots of the scoring prompts, schemas and the criteria cap for each eval run in `docs/eval/checkpoint-b/`. They are copies for the report and the thesis, not imported by the app. The live versions are in `apps/api/src/llm/`.

| Folder      | Used by run | What changed                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseline/` | `baseline`  | The step 4–6 prompts as merged in PR #32.                                                                                                                                                                                                                                                                                                                                                                                      |
| `tuned-1/`  | `tuned-1`   | **Criteria**: one criterion per stated requirement, examples and alternatives stay inside their parent, split only genuinely separate skills, cap 10 → 15 (prompt, schema and `MAX_CRITERIA`). **Scoring**: quotes must be evidence for that criterion (no headings, bare titles or reused summaries), score must follow from the quotes, a 0 gets a quote only for a concrete contrary fact; stale schema descriptions fixed. |
| `tuned-2/`  | `tuned-2`   | **Scoring only**: when every criterion scores 0, quote the candidate's actual role or main stack once as contrary evidence and keep the score at 0; never raise a score to have a quote (rules and retry feedback). This is the version now in `apps/api/src/llm/`.                                                                                                                                                            |

Diffs between consecutive versions: `baseline-to-tuned-1.diff`, `tuned-1-to-tuned-2.diff`.

Files in each folder:

- `vacancy-criteria.prompt.ts` and `vacancy-criteria.schema.ts`: criteria extraction.
- `criteria-extractor.ts`: holds `MAX_CRITERIA`, the hard cap applied after extraction.
- `application-score.prompt.ts` and `application-score.schema.ts`: per-application scoring, including the retry feedback text.

`baseline/` was taken from git (`HEAD` before tuning), `tuned-2/` from the working tree after round 2, and `tuned-1/` is `tuned-2/` with the round 2 sentences removed (the only difference between the two runs).
