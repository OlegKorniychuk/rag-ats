# apps/web

React 19 + Vite SPA for both personas: the recruiter UI (behind login) and the public apply page (`/apply/:token`, no auth). It calls the API straight from the browser (`VITE_API_URL`, default `http://localhost:3000`, `credentials: 'include'` for the JWT cookie). Stack: MUI, TanStack Query (server state), Zustand (session/UI state), React Router, React Hook Form + Zod, dnd-kit. Design details: `docs/sdd.md` §10.

## Commands (from this folder, or `-w apps/web` from the root)

```
npm run dev                    # http://localhost:5173 (needs the API running)
npm test                       # vitest run (jsdom + RTL + MSW)
npx vitest run src/pipeline    # one folder
npm run lint
npm run build                  # tsc -b && vite build
```

## Structure (`src/`)

```
router.tsx       routes: /login, /register, /vacancies, /vacancies/:id (pipeline), /candidates, /candidates/:id, /apply/:token (public)
pages/           one component per route (*Page.tsx)
api/             apiFetch client (ApiError) + one file per resource, typed with @rag-ats/shared
auth/            Zustand session store, bootstrapSession, RequireAuth / PublicOnly guards, Zod schemas
vacancies/       queries, create/edit dialog, list row, rescore helpers
pipeline/        kanban board (dnd-kit), score badge/drawer, rescore banner, Find matches drawer, polling
candidates/      pool + semantic search results, parse-status chip/polling, GitHub section
apply/           public application form (PDF upload) + schema
components/      shared UI (loaders, error alert, QuoteBlock, …)
layout/          AppLayout (app bar, nav, logout)
lib/             small helpers (errors, format, safeUrl)
test/            Vitest setup, MSW server, render helper with providers
```

Tests sit next to the code as `*.test.ts(x)`.

## Conventions

- Server data only through TanStack Query hooks in each feature's `queries.ts`; invalidate on mutation. Client-only state goes in Zustand.
- Types come from `@rag-ats/shared`; a contract change starts in `packages/shared/src/api.ts`.
- Forms: React Hook Form + a Zod schema next to the form.
- Polling, not push: `refetchInterval` while a parse or score is in flight (sdd §10).
- Model and applicant text renders as plain React text (no `dangerouslySetInnerHTML`); external links go through `safeUrl`.
- File names: PascalCase for components, camelCase for modules (React convention, unlike the API's kebab-case).
- Tests mock HTTP with MSW (`src/test/server.ts`); no real API calls.
