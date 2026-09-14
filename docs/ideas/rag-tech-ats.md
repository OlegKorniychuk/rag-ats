# RAG-Powered ATS for Tech Recruiting

## Problem Statement

How might we help tech recruiters find, evaluate, and track best-fit developer candidates faster — using RAG-grounded semantic search and explainable AI scoring over CVs and GitHub/portfolio data — without the trust gap that comes from black-box AI ratings?

## Recommended Direction

Build a lean ATS scoped specifically to tech/developer recruiting, not a general-purpose ATS. The niche buys two things a general build can't: realistic synthetic data is easy to source (public GitHub profiles, dev CV templates), and the differentiation story is sharp (parsing structured signal like repos/stack/contributions is a genuinely different problem than parsing generic resumes).

The ATS shell stays thin: vacancy CRUD, one pipeline (applied → screened → interview → rejected/hired), single Postgres + pgvector database (no separate vector DB — relational tables and CV-chunk embeddings live side by side). Two personas: **recruiter** (registers/logs in via simple JWT auth; creates/manages _their own_ vacancies, reviews ranked candidates, moves pipeline stages) and **applicant** (no account — submits a CV via a public link generated when the vacancy is created). Vacancies and applications are scoped to the recruiter who created them, but the parsed candidate pool itself is shared/global — any logged-in recruiter can search and view all applicant profiles, since a candidate may be relevant across multiple recruiters' openings. This mirrors how real ATS intake already works (shareable "apply now" links, a shared talent database), but adds AI parsing + grounded scoring on top of that intake instead of leaving submissions as raw, unstructured resumes.

All the research/engineering weight goes into the RAG layer: CV + GitHub/portfolio parsing into a standardized profile, natural-language semantic search over the candidate pool, and — the core differentiator — **grounded scoring**, where every AI-generated fit score cites the specific CV/profile snippet that justifies it. This is what separates the thesis contribution from features Greenhouse/LinkedIn already ship: an auditable, explainable rating instead of an opaque number.

Talent-pool resurfacing (auto-searching old rejected/dormant candidates when a new vacancy opens) is included as a secondary RAG feature — it's a real, underserved ATS pain point and cheap to add once semantic search exists. Skill-gap analysis and auto-generated interview questions are explicitly stretch goals, not MVP.

## Key Assumptions to Validate

- [ ] LLM-based parsing of dev CVs + GitHub profiles into a standardized structured profile is reliable across format variety — test early against a synthetic set spanning several CV templates and GitHub profile shapes.
- [ ] Grounded/cited scoring is materially more trusted by recruiters than an opaque score — validate informally with a handful of mock recruiter users comparing both.
- [ ] Recruiters prefer natural-language semantic query ("find someone like X but stronger on backend") over traditional filter/facet search — worth a quick informal comparison, not just an assumption.

## MVP Scope

**In:**

- Recruiter auth: register/login, simple JWT — protects all recruiter-facing endpoints
- Vacancy CRUD (create/update/close), each vacancy auto-generates a shareable public apply link; vacancies + applications visible only to the recruiter who created them
- Public, unauthenticated apply page (via that link) where an applicant submits a CV (PDF) + optional GitHub/portfolio link — no applicant account
- CV + GitHub/portfolio ingestion → standardized candidate profile (LLM parsing), triggered by applicant submission
- Shared candidate pool: any logged-in recruiter can search/view all applicant profiles, regardless of which vacancy they originally applied to
- Semantic search over candidate pool (natural-language query), recruiter-facing
- Grounded, explainable fit scoring (score + cited snippet justification) per candidate per vacancy
- Single pipeline stage tracking (applied → screened → interview → rejected/hired), recruiter-facing, scoped to owner
- Postgres + pgvector as the only datastore

**Out (see Not Doing):**

- Talent-pool resurfacing — stretch, add after MVP core is proven
- Skill-gap analysis / auto interview-question generation — stretch

## Not Doing (and Why)

- **RBAC / admin roles / permission tiers** — a single flat "recruiter" role is enough; multi-role permission systems are orthogonal to the research contribution and pure CRUD/auth grind.
- **Email verification, password reset, SSO/OAuth login** — self-service email+password register/login only; the extra auth flows add no research value and are easy to bolt on later if ever needed.
- **Interview scheduling / calendar integration** — third-party API dependency with no RAG angle; doesn't strengthen the thesis.
- **Email/notification integration** — same reasoning; adds integration surface, no research value.
- **General (non-tech) resume support** — the niche is the differentiator; broadening it dilutes the demo data story and the parsing quality.
- **Separate vector database (Qdrant/Weaviate etc.)** — pgvector comfortably handles thesis-scale data (thousands, not millions, of candidates); a second DB just adds ops overhead for no benefit at this scale.
- **Full production concerns (multi-tenant billing, SSO, scale-out)** — not relevant to a working-prototype-plus-defense success criterion.
- **Anti-bot/CAPTCHA/production-grade rate limiting on the public apply page** — real risk (unauthenticated endpoint triggers paid LLM parsing) but full anti-abuse tooling is out of scope for a local thesis demo. MVP gets a basic per-vacancy submission cap only, not production hardening.
- **Multi-file / multi-format CV upload (docx, images, multiple files)** — PDF only for MVP; broader format support is pure parsing-robustness grind with no research value.

## Open Questions

None outstanding — resolved in SPEC.md (LLM: gpt-4o-mini + local embeddings; ground truth: self-labeled synthetic set; dataset: 100 candidates x 10 vacancies, fully LLM-generated).
