# Interview questions eval (step 13)

Interview questions are generated from an application's fit score: one LLM call per application turns the scored criteria, the units the score cited and the candidate's CV/GitHub evidence units into 6–8 questions, each a **fact** question (it cites the units it probes, resolved to verbatim text by the server) or a **gap** question (a criterion the candidate scored low on). This report measures them on the synthetic set. Design: `docs/sdd.md` §8; run files: `docs/eval/questions/q1.{json,md}`, `q1.review.md`, `q1.review.summary.md`.

## Setup

- **Data**: the seeded database (`rag_ats_seed`, step 10) with its `full_text` fit scores. Candidates for the sample are the ground-truth pairs whose application has a `scored`, current score: 43 strong, 58 partial, 129 weak.
- **Sample**: 10 applications per band (30), drawn with seed 42 (`sampleScoredApplications`).
- **Run**: `npm run questions-eval -w apps/api -- --label q1 --max-usd 1`, `gpt-5.4-mini`, 2026-11-22. The script calls the production `QuestionGenerator` directly and writes nothing to the database.
- **Review**: 25 questions sampled round-robin across the bands (9 strong, 8 partial, 8 weak; 15 fact, 10 gap), labelled by Dude with a local labelling tool that also showed each candidate's CV and the score's reasoning for the criterion. Two labels per question: **grounded** (yes / partly / no: does the question follow from its quotes and the criterion score?) and **useful** (yes / no: would you ask it in an interview?).

## Generation

| Metric                                            | Value                    |
| ------------------------------------------------- | ------------------------ |
| Applications                                      | 30                       |
| Ok / retried / failed                             | 30 / 0 / 0               |
| Questions per application (mean / min / max)      | 8.2 / 7 / 10             |
| Gap questions on a criterion scored below 50      | 91.1 % (82 of 90)        |
| Fact questions citing a unit the score also cited | 76.1 % (118 of 155)      |
| Gap questions with a contrary-fact quote          | 9 of 90                  |
| Tokens (input / output)                           | 61.7k / 21.6k            |
| Cost                                              | $0.143 ($0.0048 per app) |

Every answer passed the citation check on the first attempt: no unknown criterion or unit ID, and every fact question cites at least one unit. The prompt asks for 6 to 8 questions; 5 of 30 sets have more (3 with 9, 2 with 10; the server accepts up to 10).

The fact / gap mix follows the band, as it should: the weaker the fit, the more of the set probes gaps.

| Band    | Fact | Gap | Gap share |
| ------- | ---: | --: | --------: |
| strong  |   67 |  15 |      18 % |
| partial |   59 |  24 |      29 % |
| weak    |   29 |  51 |      64 % |

The 8 gap questions on a criterion scored 50 or more (75–100) question credit the score gave on indirect evidence: Kotlin and Scala named for "3+ years of Java", Azure hardening only for "AWS or Azure or GCP", collaboration with product and design for "Agile teams". The rule is measured, not enforced (sdd §8); the 3 of them in the reviewed sample were all labelled grounded and useful. The other 37 fact questions quote units the score did not cite for that criterion (the score cites at most 3 per criterion), which the resolver allows as long as the units exist.

## Human review

| Label    | Yes        | Partly   | No  |
| -------- | ---------- | -------- | --- |
| grounded | 22 (88 %)  | 3 (12 %) | 0   |
| useful   | 25 (100 %) | —        | 0   |

All 10 reviewed gap questions were grounded; the 3 `partly` are fact questions:

- **#1** (strong, platform-devops, "infrastructure as code", 70): the quotes are GitHub units about Ansible playbooks, but the question asks where the candidate used IaC _at two named employers_. The evidence is real; the question moves it to the wrong place.
- **#11** (partial, full-stack, "a server-side language", 100): the question says the CV shows "not a lot of detail" on server-side work while quoting a unit that states Java services and GraphQL endpoints; the framing undersells the cited evidence.
- **#12** (weak, full-stack, "PostgreSQL or MySQL or MongoDB", 90): one of the two quotes is the `SKILLS` section heading. The question itself is fine, but a heading is not evidence (the same rule the scoring prompt states).

**A gap question that asks how the candidate would use a tool they haven't used.** Dude flagged #4 (strong, security, "Working knowledge of Burp Suite", 0): "Have you used Burp Suite…? If not, how would you use it to test a login or session flow?" The first half is a good gap question; the second asks someone without the tool to describe using it, which tests interview preparation more than experience. The prompt invites this: a gap question "asks the candidate to show the missing experience or explain how they would handle it". It is not rare: about 27 of the 90 gap questions (a keyword match on "how would you" / "if not") end with a hypothetical of this kind. A better pattern asks for the closest experience instead ("what have you used for intercepting and replaying web traffic?"). It is listed under limits; changing the prompt needs another (cheap) run to check it.

## Examples

A good fact question (#14, partial, mobile, "Experience working in Agile teams", 100), grounded and useful:

> In your Agile work at Tessera Works and in the frontend reviews you mention, what was your role in planning, review, and coordination, and how did that affect delivery?
>
> Quotes: "Delivered new customer-facing features in Vue and JavaScript under Agile planning…", "Partnered with product peers in Agile reviews to tighten scope…", "Coached teammates on frontend patterns and review habits…"

A good gap question (#2, partial, qa-automation, "Experience building test automation frameworks", 25), grounded and useful:

> Your CV does not show building a test automation framework. If you joined this team, how would you design or extend a framework for UI and API tests so it stays maintainable as coverage grows?

Here the hypothetical works: framework design can be reasoned about from related test work, unlike a named tool.

A weaker one, the #4 Burp Suite question above.

## Live smoke

Through the API on the same database (3 applications, one per band): each set was `ready` 5–6 s after the request, 8 questions each, every fact question with quotes and no gap question with more than one. A second request while generating got 409, a request while the score was being rescored got 409 "Score the application first", and the set showed as outdated once the rescore landed. 6 LLM calls (3 sets, 1 regeneration, 2 rescores), about $0.03. Notes: `_workspace` task notes (not in the repo).

## Limits

- **Synthetic data, one reviewer, 25 questions.** The CVs are cleaner than real ones; the labels are one person's judgement on a small sample, so 88 % grounded is a rough figure (with 25 items, one label moves it by 4 points).
- **Hypothetical gap questions** (above): about 30 % of gap questions end with "if not, how would you…", which is weak for a named tool the candidate has not used.
- **Fact questions can misplace or undersell evidence** (#1, #11) and can quote a section heading (#12): the server checks that a cited unit exists, not that it supports the question.
- **`full_text` scores only.** All seeded scores are `full_text`; with `rag` scores the cited units may not map back to the full CV (sdd §12), which this run does not measure.
- **Set size**: 5 of 30 sets exceed the requested 8 questions.
