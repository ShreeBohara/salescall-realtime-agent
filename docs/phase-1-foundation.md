# Phase 1 — Foundation: Auth + Persistence

> **Goal.** Make Earshot multi-tenant. Add Clerk authentication and a Supabase
> Postgres database with Row-Level Security. Replace the in-memory / localStorage
> stores with real, per-user persistence.
>
> **Done when.** You can sign in on two browsers as the same user, save a note
> by voice in one, refresh the other, and the note is there. A *different* user
> who signs in sees none of it.

---

## 1. Research notes

Do this research pass before writing code.

### Read first
- `node_modules/next/dist/docs/` — **after** `npm install`. `AGENTS.md` mandates
  it: Next.js 16 has breaking changes vs. training data. Focus on **middleware**,
  **route handlers**, **layouts**, and **environment variables**.
- The current stores you're replacing: `app/lib/store/{noteStore,taskStore,callHistoryStore,repStore,customerStore}.ts`.
- `app/page.tsx` lines 159–201 — how stores bind to React via `useSyncExternalStore`.

### Key facts (validated 2026-05)
- **`node_modules` is not installed in this worktree.** First command is
  `npm install`.
- **Clerk ↔ Supabase: use native Third-Party Auth.** The old "JWT template"
  approach was deprecated April 2025. The current flow:
  - Clerk dashboard → activate the Supabase integration → it yields a **Clerk
    domain** (your Frontend API URL). Clerk auto-adds a `role: "authenticated"`
    claim to session tokens.
  - Supabase dashboard → *Authentication → Sign In / Providers → Third-Party
    Auth → add Clerk* → paste the Clerk domain.
  - The browser Supabase client passes the Clerk token via the **`accessToken`**
    option (not an `Authorization` header).
- **RLS reads the Clerk user id as `auth.jwt() ->> 'sub'`** — that's the Clerk
  user id string (e.g. `user_2abc...`). Wrap it as `(select auth.jwt() ->> 'sub')`
  in policies so Postgres caches it per statement.
- **Supabase gives two connection URLs.** Runtime queries → **transaction
  pooler, port 6543**, with `postgres(url, { prepare: false })` (PgBouncer
  transaction mode rejects prepared statements). Migrations → **direct
  connection, port 5432**. `drizzle.config.ts` points at the **direct** URL.
- **Drizzle supports RLS in-schema** via `.enableRLS()` and `pgPolicy()`, with
  predefined roles imported from `drizzle-orm/supabase` (`authenticatedRole`).
  Set `entities: { roles: { provider: 'supabase' } }` in `drizzle.config.ts` so
  Drizzle doesn't try to recreate Supabase-managed roles. Use
  `drizzle-kit generate` + `migrate` (not `push` — `push` has historically
  skipped policies).

### External setup (do before coding)
1. Create a **Clerk application** (free tier; enable Email + Google).
2. Create a **Supabase project** (free tier).
3. Wire the Clerk ↔ Supabase third-party auth integration in both dashboards.

---

## 2. Design decisions

### Persistence access pattern: browser `supabase-js` for Phase 1
The seven tools still execute **client-side** in this phase. To persist without
building any API routes yet, the rewritten stores talk to Postgres through the
browser `@supabase/supabase-js` client, authenticated with the Clerk session
token. RLS makes this safe — the browser can only ever read/write its own rows.

Phase 2 moves the **tool logic** server-side into `/api/tools/*` routes. The
`supabase-js` *read* path built here survives into later phases for the
reactive ledger/history UI (optionally upgraded to Supabase Realtime for live
cross-tab updates). So this is not throwaway work — only the *write* path for
tool actions gets relocated in Phase 2.

> **Why not build the server routes now?** That is Phase 2's whole job, and
> bundling it here would make Phase 1 untestable as a discrete increment. The
> Phase 1 test gate ("cross-browser persistence") only needs persistence to be
> real — `supabase-js` delivers that with the least code.

### `repStore` is retired
Rep identity becomes the **Clerk user**. `currentRep` is derived from Clerk's
`useUser()`. The first-visit `RepOnboarding` name-capture modal and
`PreAuthShell` splash are replaced by Clerk's sign-in. `createdBy` on notes/tasks
becomes the Clerk user id (display name resolved for UI).

### The sync/async impedance mismatch — important
In-memory stores are **synchronous**; Supabase is **async**. `addNote`,
`updateNote`, etc. become Promises. The tool `execute` handlers are already
`async`, so that side is fine. But `useSyncExternalStore` requires a
**synchronous snapshot**.

Resolution: each store keeps an **in-memory cache** that:
- hydrates from Supabase once on mount (a new `init*` function, like the
  existing `initClientCallHistory` pattern),
- updates **optimistically** on every write, then reconciles with the row
  Supabase returns,
- is what `getSnapshot()` returns synchronously.

So the store evolves from "the source of truth" into a "cache + sync layer."
Its **public API stays the same** (`subscribeToNotes`, `getNotesSnapshot`,
`addNote`, …) so `page.tsx` barely changes.

### Schema for Phase 1
Four tables. `agent_actions` is deferred to Phase 2; HubSpot/BYOK tables to
Phase 3.

- `users` — `id text` (Clerk user id, PK), `display_name text`, `created_at`,
  `updated_at`. A thin profile mirror, populated by **lazy upsert** on first
  authenticated load (no Clerk webhook infra needed).
- `notes` — `id uuid`, `user_id text`, `customer text`, `body text`,
  `tags text[]`, `status text` (`active`/`deleted`), `created_by text`,
  `created_at`, `updated_at`.
- `tasks` — `id uuid`, `user_id text`, `customer text`, `due_at text`,
  `channel text`, `body text`, `status text` (`active`/`cancelled`),
  `created_by text`, `created_at`, `updated_at`.
- `calls` — `id uuid`, `user_id text`, `customer_name text`,
  `started_at timestamptz`, `ended_at timestamptz`, `summary jsonb`,
  `created_at`.

Decisions:
- **No hard foreign keys** from `notes`/`tasks`/`calls` to `users`. RLS is the
  guard; FKs would force user-row ordering and complicate the lazy upsert. Just
  carry `user_id text` everywhere.
- `calls.summary` is **one jsonb column**, not a separate `call_summaries`
  table. It is strictly 1:1 with a call — a split adds a join for zero benefit
  (vision doc: "keep the architecture boring").
- `due_at` stays **text** (e.g. "Friday", "next Tuesday"). The agent captures
  natural-language dates; the MVP never parsed them and we are not changing
  that contract here.
- Every table: `default (auth.jwt() ->> 'sub')` on `user_id`, `enableRLS()`,
  and an owner policy (`for: 'all', to: authenticatedRole`,
  `using`/`withCheck`: `(select auth.jwt() ->> 'sub') = user_id`).

### What stays unchanged in Phase 1
- The mock CRM (`app/lib/data/customers.ts`) and `customerStore` (selected-
  customer UI state). Real CRM is Phase 3.
- `/api/session` keeps using the owner's `OPENAI_API_KEY`. BYOK is Phase 3.
- The agent, tools' Zod schemas, voice-orb, transcript/divergence UI.
- The `useConsent` mic-disclosure dialog (it is about mic access, not auth).

---

## 3. Task breakdown

1. **`npm install`**, then read the Next.js 16 docs noted above.
2. **External setup** — create the Clerk app and Supabase project; wire the
   third-party auth integration in both dashboards (see Research notes).
3. **Env vars** — add to `.env.local` and `.env.example`:
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `DATABASE_URL` (pooled `:6543`), `DIRECT_URL` (direct `:5432`).
4. **Install deps** — `@clerk/nextjs`, `@supabase/supabase-js`, `drizzle-orm`,
   `postgres`, and `drizzle-kit` (dev).
5. **`middleware.ts`** — `clerkMiddleware()`; protect all routes except the
   sign-in/sign-up pages and `/api/session` health needs review.
6. **`app/layout.tsx`** — wrap the tree in `<ClerkProvider>`.
7. **Sign-in/sign-up** — add Clerk's pages/components; route unauthenticated
   users there. Delete or repurpose `RepOnboarding` + `PreAuthShell`.
8. **Drizzle setup** — `drizzle.config.ts` (direct URL, `entities.roles.provider
   = 'supabase'`), `app/lib/db/schema.ts` (the four tables + RLS policies),
   `app/lib/db/client.ts` (pooled connection, `prepare: false`). Run
   `drizzle-kit generate` then `drizzle-kit migrate`.
9. **Supabase browser client** — `app/lib/db/supabase-browser.ts`: a factory
   that builds the client with the Clerk session `accessToken` hook.
10. **Rewrite `noteStore.ts`** — keep every export; swap the `Map` for the
    cache+sync layer over `supabase-js`. Writes become async + optimistic.
11. **Rewrite `taskStore.ts`** — same treatment.
12. **Rewrite `callHistoryStore.ts`** — back it with the `calls` table; keep
    `addCallToHistory`/`getCallHistorySnapshot`.
13. **Retire `repStore.ts`** — replace `currentRep` in `page.tsx` with Clerk
    `useUser()`. Update `agent.ts` `buildRepContextBlock` to take the
    Clerk-derived name.
14. **`createdBy` stamping** — `saveNote.ts` / `createFollowUpTask.ts` stamp the
    Clerk user id instead of reading `repStore`.
15. **`users` lazy upsert** — on first authenticated app load, upsert the
    Clerk user into `users`.
16. **Async UI states** — the ledger panels need brief loading/empty states
    while the stores hydrate from Supabase.
17. **Verify all 7 tools** still fire end-to-end with the async stores.

---

## 4. Testing instructions

After implementation, run this exact sequence. All steps must pass before
Phase 2.

**Setup**
1. Confirm `.env.local` has all six new keys.
2. Run the migration: `npx drizzle-kit migrate`. Confirm in the Supabase
   dashboard that `users`, `notes`, `tasks`, `calls` exist and each has RLS
   **enabled**.
3. `npm run dev`, open `http://localhost:3000`.

**Auth gate**
4. You should be redirected to a Clerk sign-in page. Sign up as **User A**.
5. After sign-in you land on the Earshot dashboard.

**Persistence survives refresh**
6. Start a call. Say: *"Save a note that Acme wants annual prepay at 12% off."*
   The note appears in the Saved Notes panel.
7. Hard-refresh the page. **The note is still there** (it came from Postgres,
   not memory).
8. In the Supabase dashboard → Table Editor → `notes`: one row, `user_id` =
   User A's Clerk id.

**Cross-browser, same user**
9. Open a second browser (or incognito). Sign in as **User A** again.
10. The note from step 6 is visible here too.

**Tenant isolation (the critical test)**
11. Sign out. Sign up as a **different** User B.
12. User B sees **zero** notes/tasks/calls — none of User A's data.
13. As User B, save a note. Sign back in as User A — A still does **not** see
    B's note. (If either user can see the other's data, the RLS policy is
    wrong — fix before proceeding.)

**Tasks + history**
14. Repeat steps 6–10 for a follow-up task ("remind me to call Acme Friday")
    and for call history (end a call, confirm the summary persists and shows
    in the Call Log after refresh).

**Pass criteria:** persistence survives refresh, syncs across same-user
browsers, and is fully isolated between users.

---

## 5. Risks & open questions

- **RLS mistakes cut both ways** — too loose leaks data, too strict locks the
  user out. The two-user isolation test (steps 11–13) is the gate; do not skip
  it.
- **`useSyncExternalStore` + async DB** — the cache+sync layer is the trickiest
  code in this phase. Optimistic write, then reconcile; make sure a failed
  write rolls the cache back.
- **Clerk token refresh mid-call** — a long call may outlive a token. The
  `supabase-js` `accessToken` hook re-fetches per request, so this should be
  transparent; verify with a long session.
- **Next.js 16 middleware API** may differ from training data — read the local
  docs (this is exactly what `AGENTS.md` warns about).
- **Pooled vs direct URL** — using the pooled URL for migrations, or forgetting
  `prepare: false` on the runtime connection, produces confusing PgBouncer
  errors. Double-check the two URLs.
