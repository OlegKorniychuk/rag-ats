# General Plan: Stage 1 Frontend (`apps/web`)

## Context

Stage 1 API is done (15 operations, `docs/sdd.md` §6; contract in `packages/shared/src/api.ts`). Next: recruiter + applicant UI so SPEC's success criterion "Vacancy CRUD + single pipeline works end-to-end via UI" holds. Deliverable = working app (no separate mockups), desktop-only, MUI default theme. This is a **high-level roadmap** — each step gets its own subplan (`/agent-skills:planning-and-task-breakdown`) before execution.

## Decisions (from interview)

- **Stack:** React + Vite + TS, MUI, Zustand (auth/session + UI state), **TanStack Query** (server data — deviation from SPEC, which said "no cache layer"; SPEC updated in Step 1), React Router, React Hook Form + Zod.
- **Contract:** all request/response typing via `import type` from `@rag-ats/shared`; Zod schemas typed against the `*Request` types.
- **API access:** direct calls from Vite origin (`:5173`) to API (`:3000`) with `credentials: 'include'`; API gets `enableCors({ origin: <env WEB_ORIGIN>, credentials: true })`. Base URL via `VITE_API_URL`.
- **Layout:** top AppBar (Vacancies, Candidates, Logout) for recruiter routes; bare layout for public `/apply/:token`.
- **Pipeline:** Kanban, one column per `ApplicationStage`, drag-and-drop (dnd-kit) → `PATCH /applications/:id`, optimistic update with rollback on error.
- **Apply form:** skills/projects as chip inputs (MUI Autocomplete `freeSolo multiple`).
- **Candidate pool:** table + client-side text filter (Stage 2 replaces with semantic search).
- **Tests:** Vitest + RTL + MSW (handlers typed with shared response types). No browser e2e.

## Steps (each = one PR, own subplan)

### Step 1 — Scaffold `apps/web` + API CORS

Vite React-TS app in workspaces; MUI/Router/Query/Zustand wired; typed `apiClient` (fetch wrapper: base URL, credentials, JSON, typed errors incl. 401/404/409); Vitest + RTL + MSW setup; ESLint/Prettier; root scripts (`dev:web`, test/lint/build across workspaces); CI runs web lint/build/test. API: CORS with credentials + `WEB_ORIGIN` env (+ e2e check). SPEC.md tech-stack line updated (TanStack Query, RHF+Zod, dnd-kit).
**Done when:** `npm run dev:web` shows placeholder page; sample MSW-backed test passes; CI green.

### Step 2 — Auth: login, register, session, route guard

Login + register pages (RHF+Zod), `GET /auth/me` bootstrap into Zustand session store, protected-route wrapper redirecting to `/login`, logout in AppBar, global 401 → redirect. App shell (AppBar layout).
**Done when:** register → login → land on dashboard → reload keeps session → logout works; 409/401 shown inline.

### Step 3 — Vacancies: list, create, edit/close

List page (title, status chip, created date, copy public apply link `${origin}/apply/${applyToken}`), create/edit form (dialog or page), close/reopen via `status`. Query invalidation after mutations.
**Done when:** CRUD + close works against real API; apply link copies.

### Step 4 — Public apply page

`/apply/:token` (no auth, no AppBar): vacancy details from `GET /apply/:token`, form with chip inputs → `POST /apply/:token`, success screen; closed vacancy / 404 / already-applied (409) states.
**Done when:** unauthenticated submit creates application visible via API; error states render.

### Step 5 — Pipeline board

Vacancy detail route with Kanban of `GET /vacancies/:id/applications` grouped by stage; dnd-kit drag between columns → optimistic `PATCH /applications/:id`; card click opens candidate profile (drawer or link to Step 6 page).
**Done when:** dragging a card persists stage after reload; failed PATCH rolls back with error toast.

### Step 6 — Candidate pool

`/candidates` table + client-side filter (name/email/skills); `/candidates/:id` profile view (skills chips, experience, projects, summary, links).
**Done when:** both recruiters see same pool; filter narrows rows.

### Step 7 — Polish + docs

Consistent loading/empty/error states, 404 route, README run instructions for web, `docs/sdd.md` frontend section (routes → endpoints map).
**Done when:** manual walkthrough of full recruiter + applicant flow clean; docs updated.

## Checkpoints

- After Step 2: auth + CORS proven end-to-end in real browser (highest-risk integration).
- After Step 5: SPEC success criterion "Vacancy CRUD + pipeline end-to-end via UI" met.
- After Step 7: Stage 1 complete.

## Risks

| Risk                                                                     | Impact | Mitigation                                                                                                                                          |
| ------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-origin cookie not sent/stored (`sameSite: 'lax'`, localhost ports) | High   | Step 1 verifies in real browser: localhost:5173 → localhost:3000 is same-site, so lax cookie works with `credentials: 'include'` + CORS credentials |
| `@rag-ats/shared` TS source consumed by Vite                             | Low    | types-only `import type`; Vite erases them                                                                                                          |
| dnd-kit hard to test in RTL                                              | Medium | keep stage-change logic in a pure handler/hook tested directly; DnD interaction verified manually                                                   |
| Scope creep into Stage 2 (search, scoring)                               | Medium | UI slots only where cheap; no Stage 2 calls                                                                                                         |

## Execution

Per step: subplan → approval → Sonnet subagents execute → I review, re-run tests, verify in browser → ask commit approval → push → PR (no test plan, no attribution) → CI.
