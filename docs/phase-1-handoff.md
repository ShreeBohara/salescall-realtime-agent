# Phase 1 Handoff — Earshot 2.0

Welcome aboard. You're picking up **Phase 1** of Earshot 2.0. Read this top to
bottom, then work from the detailed spec it points you to. This is your starting
point — you should not need anything outside this repo to begin.

---

## TL;DR

- **Earshot** is a voice-first sales-call capture agent (Next.js 16 + the OpenAI
  Realtime API). The MVP works, but it's single-player and stores everything in
  browser memory / `localStorage` that dies on refresh.
- **Your job — Phase 1 only:** give it real auth (**Clerk**) and real per-user
  persistence (**Supabase Postgres + Row-Level Security**). That's the whole
  scope. Don't touch Phase 2+.
- **Done when:** sign in as the same user in two browsers, save a note by voice
  in one, refresh the other, and the note is there — and a *different* user who
  signs in sees **none** of it.
- **Workflow:** branch off `main` → build Phase 1 → open a PR against `main` →
  Shree reviews and merges. One phase = one PR. Do **not** start Phase 2.

---

## The project in 60 seconds

Earshot lets a sales rep talk to an agent to capture notes, follow-up tasks, and
post-call summaries hands-free — voice-first capture between and after calls. The
MVP already has a lot of polish: a voice orb, an editable transcript, a
"divergence chip" that refuses to silently rewrite what the rep literally said,
live tool-call cards, a pre-call briefing, and a post-call summary.

**Today (the MVP you're inheriting):**
- Single-player. No accounts.
- Seven voice tools execute **in the browser** and write to in-memory `Map`
  stores (`noteStore`, `taskStore`) + `localStorage` stores (`repStore`,
  `callHistoryStore`, `customerStore`). **All of it dies on refresh.**
- The CRM is four **mock** customers hard-coded in `app/lib/data/customers.ts`.
- Two API routes: `/api/session` (mints an OpenAI ephemeral token) and
  `/api/summarize` (post-call summary).

**Where the whole project is going (for context — NOT your job yet):**
multi-tenant, bring-your-own-OpenAI-key, connect-your-own-HubSpot, review-before-
sync, open-source. That's Phases 2–4. See `docs/roadmap.md` for the full arc.

---

## Your scope: Phase 1 ONLY

You are building the **persistence backbone**: auth + database. Concretely:

- Add **Clerk** authentication (email + Google), protected routes, sign-in/up.
- Add a **Supabase Postgres** database with **Row-Level Security** as the tenant
  boundary (a user can only ever touch their own rows).
- Rewrite the four browser stores (`noteStore`, `taskStore`, `callHistoryStore`,
  and retire `repStore`) to read/write Postgres instead of memory —
  **keeping their public API the same** so `page.tsx` barely changes.

**Explicitly NOT in Phase 1** (later phases own these — leave them alone):
- Server-side `/api/tools/*` routes — that's **Phase 2**. In Phase 1 the tools
  still execute client-side; they just persist through the browser Supabase
  client (RLS makes that safe).
- HubSpot, OAuth, real CRM — **Phase 3**. Keep the mock `customers.ts`.
- BYOK (bring-your-own-key) — **Phase 3**. `/api/session` keeps using the
  owner's `OPENAI_API_KEY`.
- Review-before-sync — **Phase 4**.

If you find yourself editing a tool's Zod schema, building an API route, or
touching HubSpot, stop — you've left Phase 1.

---

## Your definition of done (the test gate)

This exact sequence must pass before the phase is considered complete. The full
version with every step is in **`docs/phase-1-foundation.md` § 4**; the spine:

1. **Auth gate** — visiting the app redirects you to a Clerk sign-in. Sign up as
   User A, land on the dashboard.
2. **Persistence survives refresh** — save a note by voice, hard-refresh, the
   note is still there (it came from Postgres). Confirm the row in the Supabase
   Table Editor with `user_id` = User A's Clerk id.
3. **Cross-browser, same user** — open a second browser, sign in as User A, the
   note is there too.
4. **Tenant isolation (the critical test)** — sign up as a *different* User B.
   User B sees **zero** of User A's notes/tasks/calls, and vice versa. *If either
   user can see the other's data, the RLS policy is wrong — fix before opening
   the PR.*
5. Repeat for a follow-up **task** and for **call history**.

The two-user isolation test is the one that matters most. Don't skip it.

---

## Required reading (in this order)

1. **`earshot-2.0.md`** (repo root) — the vision: what we're building and why.
   Read the "What to skip" no-list and the "Cross-cutting non-negotiables."
2. **`docs/roadmap.md`** — the four-phase plan, the schema overview, the rules
   that hold across every phase.
3. **`docs/phase-1-foundation.md`** — **your actual spec.** Research notes,
   design decisions, a 17-step task breakdown, and the full testing script.
   This is the doc you execute from.
4. **`README.md`** — the MVP architecture (and the WebRTC-vs-WebSocket write-up).
5. **`AGENTS.md`** — short but important (see the next section).

---

## Gotchas that will bite you

These are distilled from the Phase 1 research notes — read the full versions in
`docs/phase-1-foundation.md`, but internalize these now:

- **This is not the Next.js you know.** `AGENTS.md` mandates it: Next.js 16 has
  breaking changes vs. what you (and your AI tools) remember. **Read
  `node_modules/next/dist/docs/` after `npm install`**, focusing on middleware,
  route handlers, layouts, and env vars — *before* writing any of that code.
- **`node_modules` isn't installed.** First command is `npm install`.
- **Clerk ↔ Supabase = native Third-Party Auth, NOT the old JWT-template flow**
  (that was deprecated April 2025). Activate the Supabase integration in the
  Clerk dashboard, add Clerk as a third-party auth provider in Supabase, and the
  browser Supabase client passes the Clerk token via the **`accessToken`** option
  (not an `Authorization` header).
- **RLS keys on the Clerk user id** read as `auth.jwt() ->> 'sub'`. Wrap it as
  `(select auth.jwt() ->> 'sub')` in policies so Postgres caches it per
  statement.
- **Supabase gives you two connection URLs.** Runtime queries → **pooled, port
  6543**, with `prepare: false` (PgBouncer transaction mode rejects prepared
  statements). Migrations → **direct, port 5432**. Mixing these up produces
  confusing PgBouncer errors.
- **Use Drizzle `generate` + `migrate`, not `push`** — `push` has historically
  skipped RLS policies. Set `entities: { roles: { provider: 'supabase' } }` so
  Drizzle doesn't fight Supabase-managed roles.
- **The sync/async trap.** In-memory stores are synchronous; Supabase is async,
  but `useSyncExternalStore` needs a *synchronous* snapshot. The fix (detailed
  in the spec): each store keeps an in-memory cache that hydrates once on mount,
  writes optimistically, then reconciles with the row Supabase returns — and
  rolls back on a failed write. This is the trickiest code in the phase.

---

## Stack you'll add

Everything in the MVP stack stays (Next.js 16, React 19, TypeScript strict,
Tailwind v4, shadcn, `@openai/agents-realtime`). New for Phase 1:

| Concern | Choice |
|---|---|
| Auth | `@clerk/nextjs` (native Supabase third-party auth) |
| Database | Supabase Postgres + Row-Level Security |
| ORM / migrations | `drizzle-orm` + `drizzle-kit` (RLS policies live in the schema) |
| Browser DB client | `@supabase/supabase-js` (RLS-scoped reads/writes) |
| Postgres driver | `postgres` (`prepare: false` on the pooled URL) |

**Schema (four tables, all with RLS):** `users`, `notes`, `tasks`, `calls`.
Exact columns are in `docs/phase-1-foundation.md` § 2. `agent_actions` is
deferred to Phase 2; HubSpot/BYOK tables to Phase 3.

---

## External accounts (set up before coding)

Both are free tier:

1. **Clerk application** — enable Email + Google sign-in.
2. **Supabase project** — Postgres + RLS.
3. Wire the **Clerk ↔ Supabase third-party auth** integration in *both*
   dashboards (the spec walks through it).

Then add these to `.env.local` (and document them in `.env.example`):
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`DATABASE_URL` (pooled `:6543`), `DIRECT_URL` (direct `:5432`).

> You'll need your own `OPENAI_API_KEY` too (it's already in `.env.example`) to
> run the agent locally and test voice capture.

---

## Guardrails — do not violate

These come straight from the vision doc's non-negotiables:

- **Don't change the tool Zod schemas.** They are the agent's contract. Refactor
  *around* them.
- **Refactor, don't rewrite.** The codebase is already good. Keep each store's
  public API (`subscribeToNotes`, `getNotesSnapshot`, `addNote`, …) identical so
  `page.tsx` barely changes.
- **RLS is the tenant boundary** — not application code. Every user-owned row
  carries `user_id`, every table has an owner policy. The two-user isolation
  test is the gate.
- **Keep `/api/session` on the owner key** and **keep the mock CRM.** BYOK and
  HubSpot are Phase 3. Don't pull them forward.
- **Trust the rep's literal words** — the divergence chip stays. Never silently
  normalize a customer name.

---

## Collaboration workflow

1. **Get access** — Shree adds you as a collaborator on
   `github.com/ShreeBohara/salescall-realtime-agent` (or fork it).
2. **Branch off `main`:** `git checkout main && git pull && git checkout -b phase-1-foundation`.
3. **Build Phase 1** following `docs/phase-1-foundation.md`. Commit in logical
   chunks with clear messages.
4. **Run the full test gate** (the isolation test especially). It must pass.
5. **Open a PR against `main`.** In the description, walk through the test gate
   results — ideally a short screen recording of the two-user isolation test.
6. **Shree reviews and merges.** Address review comments on the same branch.
7. **Stop there.** Phase 2 starts only after Phase 1 is merged. One phase = one
   shippable PR.

---

## Getting started

```bash
git clone https://github.com/ShreeBohara/salescall-realtime-agent.git
cd salescall-realtime-agent
git checkout -b phase-1-foundation
npm install
# now read node_modules/next/dist/docs/ (middleware, route handlers, layouts, env)
# set up Clerk + Supabase, fill in .env.local, then work docs/phase-1-foundation.md
npm run dev
```

Questions or anything ambiguous in the spec → ping Shree before guessing. Welcome
to the project.
