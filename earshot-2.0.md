# Earshot 2.0 — build plan

Reference doc for the next phase of Earshot. Written for me, future me, and anyone I share this with.

---

## What this is and isn't

Earshot 2.0 is a polished, open-source, BYOK voice-first capture tool for sales reps using HubSpot. Real people can sign in, connect their CRM, talk to it, and get clean notes/tasks/follow-ups synced back.

**Goal:** ship something solid that strangers find and use. Not a startup. No billing, no enterprise sales motion, no roadmap to compete with Gong.

**Non-goal:** SOC 2, multi-CRM, manager dashboards, live coaching during calls, mobile apps, custom field mapping, Slack alerts, MEDDIC scoring, forecasting, anything that smells like a 12-month SaaS build.

If a feature needs me to be on-call for support, it doesn't go in v1.

---

## The reframe

Real sales calls happen on Zoom, Meet, Teams, or phone. Nobody talks to an orb instead of their prospect. The current Earshot UX where the rep talks to a copilot doesn't work *during* a live call.

But it's perfect for the gap nobody fills well: **voice-first capture between and after calls.**

> "Just got off a call with Acme, save these notes, create a follow-up task for Friday, draft an email to Sarah about pricing."
>
> 30 seconds, hands-free, done. Synced to HubSpot.

This is the wedge. It's underserved. It plays to what's already built: the orb, the divergence chip, the live tool-call cards, the editable transcript, the post-call summary. Those are great for focused capture and awkward for live coaching, so just lean into capture.

Target users: solo founders selling, recruiters, real estate agents, CS reps, consultants, SDRs. Anyone with a CRM who hates data entry.

---

## Why BYOK + open source

Two things that kill side-project B2B tools:

1. **Hosting costs.** OpenAI Realtime is roughly $7/rep/day of active use. A free hosted tool with even modest traction bankrupts me.
2. **Trust.** People are about to put CRM credentials into a stranger's app.

BYOK (bring your own OpenAI key) solves #1 — users pay OpenAI directly with their own key, my hosting cost stays near zero forever. Open-sourcing on GitHub solves #2 — anyone who wants to verify or self-host can.

This is the only structure that lets "many people use it" without me running a company.

---

## Architecture (what changes from MVP)

### Multi-tenant, persistent

Currently: in-browser `Map`s, refresh kills state, single-player.

Becomes:
- **Auth:** Clerk free tier. Email + Google sign-in.
- **DB:** Supabase Postgres with Row-Level Security (RLS) so user A literally cannot read user B's data.
- **Schema:** users, hubspot_connections, openai_keys, notes, tasks, calls, call_summaries, agent_actions.

### Server-side tools

The 7 tool `execute` handlers move from browser to `/api/tools/*` routes. Zod schemas stay identical — this is mechanical refactoring, not redesign.

```
/api/tools/get-customer-context
/api/tools/save-note
/api/tools/update-note
/api/tools/delete-note
/api/tools/create-follow-up-task
/api/tools/update-follow-up-task
/api/tools/cancel-follow-up-task
```

Each route:
- verifies Clerk session
- looks up the user's row
- writes to Postgres (or HubSpot, or both)
- returns the same shape the agent already expects

### HubSpot OAuth

One CRM. Not Salesforce, not Pipedrive. HubSpot only.

- "Connect HubSpot" button → OAuth flow
- Encrypted access/refresh tokens stored per-user
- Initial sync: contacts, companies, deals, owners
- `get_customer_context` queries HubSpot directly instead of the mock `customers.ts`
- Write-back on approval (notes, tasks, deal updates)

Why HubSpot first: friendlier API, larger SMB share, OAuth is straightforward, free tier exists for users to try. Salesforce can come later if traction demands.

### BYOK key management

Settings page:
- User pastes their OpenAI API key
- Encrypted at rest (Supabase Vault or app-level AES with a server-side key)
- The `/api/session` route uses the user's key to mint the ephemeral token instead of mine
- Clear warning: "your key, your usage, your bill"

### Review-before-sync

This is the trust layer. The divergence-chip philosophy extended.

After a call ends, instead of auto-writing to HubSpot:
- Show a list of suggested CRM updates
- Each one is editable
- Each one shows the source transcript line
- User clicks "sync all" or approves individually
- Then and only then does the tool route hit HubSpot's API

People will not adopt a voice tool that auto-mutates their CRM. They will adopt one that drafts changes and lets them approve.

---

## What stays from MVP (and works well)

These are the features that show real product taste — keep them, polish them:

- The orb visualizer
- The divergence chip and "trust the literal word" philosophy
- Editable user transcript lines with undo
- Live agent action feed with shiki-highlighted JSON
- Pre-call briefing card
- Post-call MEDDIC summary (but reframe — see below)
- Pause/resume with mic mute
- Duplicate-task detection
- Account vs. person-name safety in updates
- The 7 existing tools and their Zod schemas
- The system prompt's "speed contract"

The MEDDIC summary is good but heavy. Make it optional / collapsible — most users want the headline + next steps, not a full sales-methodology audit.

---

## What to skip (explicit no-list)

Cut these now, save them for "if it gets traction" later:

- Salesforce, Pipedrive, Zoho, anything not HubSpot
- Recall.ai bot mode (joining Zoom/Meet calls)
- Gmail / Outlook draft integration
- Calendar integration
- Slack / Teams notifications
- Manager dashboard, team features, deal-risk analytics
- MEDDIC/BANT field auto-extraction beyond what's already there
- Forecasting, pipeline scoring
- Custom field mapping UI
- SSO, SAML, audit logs (enterprise gates)
- Mobile native app (PWA is fine if I want mobile-friendly)
- Billing, plans, Stripe
- Workflow builder, automation rules
- SOC 2, HIPAA, anything compliance-flavored

If the launch lands and 50+ people are actively using it, revisit this list. Until then, every one of these is a tar pit.

---

## Build sequence

Linear, no parallelism. Don't start step N+1 until N is shipped.

### Step 1 — Persistence backbone
- Supabase project, schema, RLS policies
- Clerk auth, sign-in flow, protected routes
- Move `repStore` to a real users table
- Move `noteStore` and `taskStore` to Postgres tables

Done when: I can sign in on two browsers, save a note in one, see it in the other after refresh.

### Step 2 — Server-side tools
- `/api/tools/*` routes for all 7 tools
- Each route auth-gated, scoped to user's data
- Replace browser-side `execute` with `fetch()` to the route
- Keep Zod schemas identical so the agent integration doesn't change

Done when: the agent works exactly as before, but every tool call hits a server route and writes to Postgres.

### Step 3 — HubSpot OAuth + sync
- "Connect HubSpot" button
- OAuth flow, encrypted token storage
- Initial pull of contacts/companies/deals
- `get_customer_context` queries HubSpot
- Customer picker shows real CRM data, not mocks

Done when: I can connect my own HubSpot dev account, pick a real deal, and the briefing card shows real data.

### Step 4 — BYOK
- Settings page
- Encrypted key storage
- `/api/session` uses the user's key
- Onboarding flow that walks a new user through: sign up → add OpenAI key → connect HubSpot → first call

Done when: a friend can sign up, paste their own key, connect their HubSpot, and use it without me touching anything.

### Step 5 — Review-and-sync
- Post-call screen lists suggested CRM updates
- Each update is editable, each shows source transcript line
- Approve individually or all-at-once
- On approval, the relevant tool routes write to HubSpot

Done when: a full call → review → sync flow works end-to-end with real HubSpot data.

### Step 6 — Polish, README, launch
- Landing page that explains the wedge clearly
- Demo video (60 seconds, no narration needed if the UX is good)
- README with self-host instructions
- Open-source the repo, MIT license
- Medium post: "I built a voice-first capture tool for HubSpot"
- LinkedIn post
- Submit to Hacker News (Show HN), r/sales, r/sidehustle, Product Hunt

Done when: it's live, public, and I've stopped touching it for a week to see what happens.

---

## Stack

Same as MVP unless noted:

- **Framework:** Next.js 16, App Router, TypeScript strict
- **Auth:** Clerk
- **DB:** Supabase Postgres + RLS
- **ORM:** Drizzle (lighter than Prisma, plays well with Supabase)
- **Realtime:** `@openai/agents-realtime`, WebRTC, `gpt-realtime`, `marin` voice
- **CRM:** HubSpot API directly (not Merge.dev — overkill for one CRM)
- **Encryption:** Supabase Vault for tokens and OpenAI keys, or app-level AES-256-GCM with a server-side master key
- **Styling:** Tailwind v4, shadcn (Radix Nova), Vercel AI Elements
- **Hosting:** Vercel (already there)
- **Repo:** GitHub, public, MIT

No Redis, no queue, no background jobs in v1. If sync is slow, it's slow — keep the architecture boring.

---

## What success looks like

Calibrated, not hopeful.

**Good outcome:** 200-500 GitHub stars over 3 months. 30-50 people actually connect HubSpot and use it more than once. 5-10 people use it weekly. A handful of issues and PRs from strangers. The Medium post hits 2-3K reads. It becomes a real portfolio piece that demonstrates real-time voice + production architecture + good UX taste.

**Great outcome:** Above + someone in the HubSpot ecosystem (a partner agency, a YouTuber, a community admin) finds it and shares it. 100+ active users. People asking for Salesforce / Gmail / mobile.

**If great happens:** revisit the no-list. Add Salesforce. Maybe add Gmail draft. Stay open-source, stay BYOK, do not become a startup unless I actually want to.

**If good happens:** that's the win. Side-project B2B workflow tools rarely go viral. People don't change CRM habits easily. Frame the project as "shipped something polished and real, and a meaningful number of strangers found it useful" and that's a complete success.

---

## Things to remember while building

- The codebase is already good. Don't rewrite it. Refactor surgically.
- The Zod schemas are the contract. Don't break them.
- The divergence chip is the soul of the project. Every new feature should respect "trust the literal word."
- Review-before-sync is non-negotiable. Auto-writing to CRM kills trust.
- BYOK is non-negotiable. Hosted-with-my-key is the trap that turns this into a startup.
- One CRM. One. HubSpot.
- If a feature requires me to support customers, it doesn't go in v1.
- Ship boring, polished, narrow. Resist scope creep from imagined users.

---

## Open questions to figure out as I build

- Encrypt OpenAI keys with Supabase Vault or roll my own AES? (Probably Vault — less rope to hang myself with.)
- HubSpot rate limits — do I need any caching/queueing for the initial sync of a big account? (Probably yes for accounts with thousands of contacts. Pagination + a "syncing..." state.)
- How to handle HubSpot disconnection / token refresh failure gracefully?
- Do I want a "demo mode" that uses the existing mock CRM so people can try without connecting HubSpot? (Probably yes — lowers the trial friction a lot.)
- Should the OpenAI key be optional with a free-tier-of-mine fallback? (No. That's the cost trap. Hard no.)

---

## Reference: what the three earlier analyses got right and wrong

For my own memory, since I read all three.

**Got right:**
- Move tools server-side (all three)
- Postgres + auth foundation (all three)
- HubSpot first, not Salesforce (#2 and #3)
- Review-before-sync trust layer (#2)
- The divergence chip is a real moat (#1 and #3)
- The current "talk to the orb" UX doesn't fit live calls (#1)

**Got wrong:**
- All three pitched 12-month SaaS roadmaps. I don't want a SaaS.
- All three assumed I'd run hosted infra and pay OpenAI costs. BYOK eliminates that whole problem.
- Manager dashboards, MEDDIC enforcement, custom field mapping, Salesforce — all of these are startup-scope features that don't belong in a "many people use it" side project.
- All three underweighted the Recall.ai / Zoom-bot reframe but also overweighted it as a v1 requirement. Right reframe, wrong timing — that's a v2+ if traction demands.

The plan above is what's left after cutting everything that exists to support a business motion I don't want.
