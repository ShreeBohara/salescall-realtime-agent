# Earshot 2.0 — Build Roadmap

The execution plan for taking Earshot from a single-player MVP demo to a
multi-tenant, BYOK, open-source voice capture tool. It turns the vision in
`earshot-2.0.md` into four executable phases.

**Read first:** `earshot-2.0.md` (the vision — what we're building and why) and
`README.md` (the MVP architecture).

---

## How to use this roadmap

- Work the phases **in order**. Do not start phase N+1 until phase N's **test
  gate** passes. This mirrors the vision doc's "linear, no parallelism" rule.
- Each phase has its own doc with four parts: **research notes**, **design
  decisions**, an ordered **task breakdown**, and copy-paste **testing
  instructions**.
- Each phase begins with a research pass (the codebase moves; `AGENTS.md`
  warns Next.js 16 has breaking changes — read `node_modules/next/dist/docs/`
  before writing route/middleware/layout code).
- After a phase passes its test gate, commit it. One phase = one shippable
  increment.

| Phase | Doc | Goal | Test gate |
|---|---|---|---|
| 1 | [`phase-1-foundation.md`](phase-1-foundation.md) | Clerk auth + Supabase + RLS; real persistence | Sign in on two browsers, save a note, see it after refresh; a second user sees nothing |
| 2 | [`phase-2-server-tools.md`](phase-2-server-tools.md) | 7 tools → `/api/tools/*` routes; audit log | Agent behaves identically; every tool call hits a route + DB |
| 3 | [`phase-3-hubspot-byok.md`](phase-3-hubspot-byok.md) | HubSpot OAuth + sync; BYOK key management | A friend self-serves: their key, their HubSpot, a real briefing |
| 4 | [`phase-4-review-and-launch.md`](phase-4-review-and-launch.md) | Review-before-sync to HubSpot; open-source launch | Full call → review → sync to HubSpot; repo public |

---

## Where we are → where we're going

**Today (MVP).** Single-player. Seven voice tools execute **in the browser** and
write to in-memory `Map` stores (`noteStore`, `taskStore`) that die on refresh,
plus `localStorage` stores (`repStore`, `callHistoryStore`, `customerStore`).
Two API routes: `/api/session` (mints an OpenAI ephemeral token from the
owner's key) and `/api/summarize` (post-call summary). The CRM is four mock
customers hard-coded in `app/lib/data/customers.ts`.

**Target (2.0).** Multi-tenant. Anyone signs in (Clerk), brings their own
OpenAI key (BYOK), connects their own HubSpot, and talks to Earshot to capture
notes/tasks that — after they review and approve — sync to HubSpot. Open-source,
self-hostable, near-zero hosting cost for the maintainer.

### Architecture evolution

```
MVP                                  2.0
───                                  ───
browser Map / localStorage     →      Supabase Postgres + Row-Level Security
no auth                        →      Clerk (email + Google)
tools execute in browser       →      tools execute in /api/tools/* routes
owner's OPENAI_API_KEY         →      each user's own key (BYOK), encrypted
mock customers.ts              →      HubSpot CRM (synced) + demo-mode fallback
auto-write on tool call        →      write to Postgres, sync to HubSpot on approval
```

---

## Database schema (introduced incrementally)

Every user-owned table carries a `user_id text` column equal to the Clerk user
id (`auth.jwt() ->> 'sub'`) and an RLS policy so a user can only ever touch
their own rows. RLS is the tenant boundary.

| Table | Phase | Purpose |
|---|---|---|
| `users` | 1 | Thin profile mirror of the Clerk identity (id = Clerk user id, display name, created_at) |
| `notes` | 1 | Captured notes — replaces `noteStore` |
| `tasks` | 1 | Follow-up tasks — replaces `taskStore` |
| `calls` | 1 | Ended calls + post-call summary (jsonb) — replaces `callHistoryStore` |
| `agent_actions` | 2 | Server-side audit log of every tool call (args, result, timing) |
| `hubspot_connections` | 3 | Per-user **encrypted** HubSpot OAuth access/refresh tokens |
| `openai_keys` | 3 | Per-user **encrypted** OpenAI API key (BYOK) |
| `crm_objects` | 3 | Local mirror of synced HubSpot contacts/companies/deals/owners |
| `notes` / `tasks` gain `hubspot_id`, `synced_at`, `sync_status` | 4 | Review-and-sync state |

---

## Cross-cutting non-negotiables

These hold across all four phases (straight from the vision doc):

1. **Trust the rep's literal words.** The divergence chip is the soul of the
   project. Never silently normalize a customer name.
2. **Review-before-sync.** Nothing auto-writes to HubSpot. The agent stages
   changes in Postgres; the user approves; only then does HubSpot get touched.
3. **BYOK, always.** Users pay OpenAI directly with their own key. There is
   never a hosted-key fallback — that is the cost trap that turns this into a
   startup.
4. **One CRM.** HubSpot only. No Salesforce, no Pipedrive.
5. **No support burden.** If a feature requires the maintainer to be on-call,
   it does not ship in v1.
6. **Refactor, don't rewrite.** The codebase is already good. The Zod tool
   schemas are the agent contract — they must not change shape.

See `earshot-2.0.md` → "What to skip" for the full explicit no-list (Salesforce,
Recall.ai bot mode, Gmail/calendar, manager dashboards, billing, SOC 2, etc.).

---

## Stack additions

Everything in the MVP stack stays (Next.js 16, React 19, TypeScript strict,
Tailwind v4, shadcn, `@openai/agents-realtime`). New for 2.0:

| Concern | Choice | Notes |
|---|---|---|
| Auth | `@clerk/nextjs` | Native third-party auth integration with Supabase (not the deprecated JWT-template flow) |
| Database | Supabase Postgres | Two connection URLs: pooled `:6543` for runtime, direct `:5432` for migrations |
| ORM / migrations | Drizzle + `drizzle-kit` | Schema authority + RLS policies (`pgPolicy`, `.enableRLS()`) + server queries |
| Browser DB client | `@supabase/supabase-js` | RLS-scoped reads from the client (Phase 1) |
| Postgres driver | `postgres` | Drizzle's driver; `prepare: false` on the pooled URL |
| CRM | HubSpot REST API (direct fetch) | No SDK needed; one thin client wrapper |
| Encryption | Node `crypto` — AES-256-GCM | App-level encryption of OAuth tokens + OpenAI keys; master key in env |

---

## External accounts you'll need

The phase docs say exactly when each is needed and walk through setup.

- **Clerk application** — Phase 1. Free tier. Email + Google sign-in.
- **Supabase project** — Phase 1. Free tier. Postgres + RLS.
- **HubSpot developer account** + a **public app** + a **test account** with
  sample data — Phase 3.

No Redis, no queue, no background-job infra in v1 (vision doc: "keep the
architecture boring").

---

## Definition of done for 2.0

From the vision doc's success criteria: the repo is public (MIT), a stranger
can clone it, follow the README, plug in their own Clerk/Supabase/HubSpot/OpenAI
credentials, and use it — without the maintainer touching anything. The four
test gates above, passed in order, get us there.
