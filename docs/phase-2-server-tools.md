# Phase 2 — Server-side tools

> **Goal.** Move all seven tool `execute` handlers out of the browser into
> `/api/tools/*` route handlers. The duplicate-detection and customer-validation
> logic moves server-side. Add an `agent_actions` audit log. The Zod schemas —
> the agent contract — do not change.
>
> **Done when.** The agent behaves exactly as before, but every tool call is a
> POST to a server route that writes to Postgres via Drizzle with RLS enforced,
> and every call leaves an `agent_actions` row. Nothing trusts the browser.

---

## 1. Research notes

### Read first
- Re-read `node_modules/next/dist/docs/` on **route handlers** — request
  parsing, `NextResponse`, runtime selection.
- The seven tool files: `app/lib/tools/*.ts`. Note the **exact JSON string
  shape** each `execute` returns today — the agent's system prompt
  (`app/lib/agent.ts`) depends on those keys (`ok`, `error: "duplicate_likely"`,
  `existingNoteId`, `noteId`, `taskId`, etc.). This shape **must not drift**.
- `app/lib/store/{noteStore,taskStore}.ts` — the logic being relocated:
  `findNearDuplicateNote`, `findNearDuplicateTask`, `findLatestActive*`, the
  normalize/Jaccard helpers.
- `app/lib/agent.ts` `showToolCompletionToast` — the Undo toast calls
  `updateNoteStore` / `updateTask` **directly**; that path also needs rerouting.

### Key facts (validated 2026-05)
- **Drizzle + RLS from a server route requires a transaction wrapper.** A plain
  service-role connection *bypasses* RLS silently. The recommended pattern (the
  `rphlmr/drizzle-supabase-rls` model the Drizzle docs point to): keep **two
  connections** —
  - an `admin` connection (service role, RLS bypassed) for system jobs only,
  - an `rls` connection whose `.rls(callback)` wrapper opens a transaction and
    runs, per request:
    ```sql
    select set_config('request.jwt.claims', <clerk-token-json>, true);
    select set_config('request.jwt.claim.sub', <clerk-user-id>, true);
    set local role authenticated;
    ```
  Inside that transaction, `auth.jwt()` behaves exactly as in the Supabase SQL
  editor, so the same RLS policies from Phase 1 apply.
- **Clerk in a route handler:** `auth()` from `@clerk/nextjs/server` returns the
  `userId` and a `getToken()` for the session. A browser `fetch()` to a
  same-origin route **carries the Clerk session cookie automatically** — no
  manual token plumbing from the client.
- **`@openai/agents-realtime` tool `execute` is already `async`** — putting a
  `fetch()` inside it is fully supported. The realtime SDK runs `execute` in
  the browser; the route is reached as a normal same-origin request.

---

## 2. Design decisions

### One route per tool
```
/api/tools/get-customer-context
/api/tools/save-note
/api/tools/update-note
/api/tools/delete-note
/api/tools/create-follow-up-task
/api/tools/update-follow-up-task
/api/tools/cancel-follow-up-task
```
Each route handler:
1. Calls Clerk `auth()` → `401` if there is no session.
2. Parses the JSON body and **validates it with the same Zod schema** the tool
   already declares (extract the schema into a shared module so the tool file
   and the route import the *one* definition — single source of truth).
3. Runs the logic (duplicate detection, customer validation, fallback lookup).
4. Persists via the Drizzle **RLS transaction wrapper**.
5. Inserts an `agent_actions` audit row.
6. Returns the **exact same JSON shape** the tool returned before.

### Tool files become thin clients
Each `app/lib/tools/*.ts` keeps its `tool({...})` definition and Zod schema
unchanged. Only the `execute` body changes — from store mutation to:
```ts
execute: async (input) => {
  const res = await fetch("/api/tools/save-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return await res.text(); // route returns the agent-shaped JSON string
}
```
The agent construction in `page.tsx` (the `tools: [...]` array) does not change.

### Logic moves to a server data layer
Create `app/lib/server/notes.ts` and `app/lib/server/tasks.ts`. Port the
duplicate-detection and lookup logic from the stores, rewritten to operate on
Drizzle queries instead of an in-memory `Map`. The normalize/Jaccard helpers
move verbatim (they are pure functions).

> The MVP did duplicate detection in the browser, where a determined user could
> bypass it. Server-side, it is real. Same for the account-vs-person
> `new_customer` validation in the update tools.

### `agent_actions` audit log (new table this phase)
`id uuid`, `user_id text`, `call_id uuid` (nullable), `tool_name text`,
`args jsonb`, `result jsonb`, `status text` (`ok`/`error`),
`created_at timestamptz`. Every tool route writes one row. This is the durable
audit trail; it also makes tool-call **timing realistic** (README known
limitation #7 — client stubs returned in ~0 ms).

`call_id` is nullable because a call row may not exist at the instant a tool
fires. Simplest: keep it null in Phase 2; Phase 4 can associate actions with a
call when the post-call review needs it.

### The live "Agent actions" feed stays on React state
`page.tsx` already builds the live feed from the in-React `toolCalls[]` array
via `agent_tool_start` / `agent_tool_end` events. Keep that for the live view —
it is instant and needs no DB round trip. `agent_actions` is the **durable
audit** read later (history, Phase 4 review). Two views, clear roles; do not
over-engineer a live DB subscription for the feed.

### Reads stay on the Phase 1 `supabase-js` layer
The ledger/history panels keep reading through the Phase 1 browser
`supabase-js` stores. Phase 2 only relocates **writes that the agent triggers**.
This keeps the phase tight and the UI reactive.

### Customer validation still uses the mock CRM
The `update-note` / `update-follow-up-task` routes validate `new_customer`
against `app/lib/data/customers.ts` — same as today. Phase 3 swaps that lookup
to HubSpot / `crm_objects`. Do **not** pull that forward.

---

## 3. Task breakdown

1. **Research pass** — re-read Next.js 16 route-handler docs; re-confirm the
   exact return shape of all 7 current tools.
2. **Drizzle RLS wrapper** — `app/lib/db/rls.ts`: the `admin` + `rls`
   connections and the `.rls()` transaction wrapper described above.
3. **`agent_actions` table** — add to `app/lib/db/schema.ts` with RLS policy;
   `drizzle-kit generate` + `migrate`.
4. **Shared schemas** — extract each tool's Zod params into a module both the
   tool file and its route import (e.g. `app/lib/tools/schemas.ts`).
5. **Server data layer** — `app/lib/server/notes.ts`, `app/lib/server/tasks.ts`:
   port duplicate detection, fallback lookup, and CRUD onto Drizzle.
6. **Seven route handlers** — `app/api/tools/<name>/route.ts`. Each: auth → Zod
   validate → logic → persist (RLS wrapper) → `agent_actions` row → return the
   agent-shaped JSON.
7. **Rewrite the 7 tool `execute` handlers** to `fetch()` their route. Keep the
   `tool()` definitions and Zod schemas otherwise untouched.
8. **Reroute the Undo toast** — `showToolCompletionToast` in `agent.ts` should
   call the `update-note` / `cancel-follow-up-task` route (or a small client
   helper) instead of mutating a store directly.
9. **Delete dead code** — the client-side write paths in `noteStore` /
   `taskStore` that the tools no longer use. Keep the read/subscribe path.
10. **Verify timing** — tool-call cards now show real elapsed ms.

---

## 4. Testing instructions

Run after implementation. All steps must pass before Phase 3.

**Setup**
1. `npx drizzle-kit migrate` — confirm `agent_actions` exists with RLS enabled.
2. `npm run dev`; sign in.

**Behavior parity (open DevTools → Network)**
3. Start a call. Save a note by voice. In the Network tab, confirm a `POST`
   to `/api/tools/save-note` returning `200`. The note appears in the ledger
   exactly as before.
4. Create a follow-up task → `POST /api/tools/create-follow-up-task`, 200.
5. Update it ("change that to Thursday") → `POST /api/tools/update-follow-up-task`.
6. Cancel it; delete a note — confirm their routes fire.
7. Ask a customer question → `POST /api/tools/get-customer-context`.

**Logic is genuinely server-side**
8. Save the *same* note twice. The second attempt returns
   `error: "duplicate_likely"` and the agent asks what to do — and the
   `duplicate_likely` decision now comes from the **route response**, not the
   browser.
9. Account-vs-person: with a task "call Michael", say *"that was Sri, not
   Michael."* The agent updates the body, not the account — the server route
   rejects `new_customer: "Sri"` as an unknown CRM account.

**Audit log**
10. Supabase dashboard → `agent_actions`: a row per tool call from this session,
    with `args`, `result`, and `status` populated.

**Auth gate**
11. Sign out (or hit a tool route with no session via curl) → the route
    responds `401`.

**Pass criteria:** the agent's observable behavior is **identical** to Phase 1,
every tool call is a server route hit, `agent_actions` is populated, and the
duplicate / customer-validation logic runs server-side.

---

## 5. Risks & open questions

- **Return-shape drift is the #1 risk.** The agent's prompt depends on exact
  keys (`ok`, `error`, `existingNoteId`, `existing.{customer,body,tags}`,
  `noteId`, `taskId`, `matchedBy`, …). Diff each route's output against the old
  tool's output key-by-key. A renamed key silently breaks duplicate handling.
- **Added latency.** Client → route → DB adds a round trip. The prompt's "speed
  contract" governs agent *narration*, not tool latency, so this is acceptable —
  but keep routes lean (no needless queries).
- **RLS wrapper correctness.** If the transaction does not set the JWT claims
  correctly, writes either fail or — worse — a misconfigured service-role
  fallback bypasses isolation. Re-run the Phase 1 two-user isolation test after
  this phase.
- **Undo toast path.** The 10-second Undo currently mutates a store directly;
  once that store is read-only-ish, Undo must go through a route. Verify Undo
  still works and still records to `agent_actions`.
- **Same-origin cookie assumption.** Tool `fetch()`es rely on the Clerk cookie
  riding along on a same-origin request. Confirm this holds in the realtime
  SDK's browser execution context.
