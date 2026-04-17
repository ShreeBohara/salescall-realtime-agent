# Earshot — voice-first sales copilot

A voice agent for a sales rep: press one button, talk to it, and watch real tool
calls (notes, follow-ups) show up as structured **Agent Actions** the moment
they fire.

Built as a 4-day case study for [Instalily](https://www.instalily.ai). Voice is
the interface; the UI is deliberately minimal.

> **Live demo:** [salescall-realtime-agent.vercel.app](https://salescall-realtime-agent.vercel.app)
> **Voice:** OpenAI Realtime API (`gpt-realtime`, `marin` voice), over WebRTC.

---

## 30-second demo

1. Open the live URL in Chrome or Safari.
2. Click **Start talking**, allow mic access. You'll hear Earshot greet you.
3. Try one of:
   - _"Save a note that Acme is interested in annual prepay at a 12% discount."_
   - _"Remind me to email Acme's CFO on Friday about the pricing doc."_
4. Watch the **Agent actions** card below the transcript — the tool call renders
   with its arguments (shiki-highlighted JSON), a "Completed" pill, and the
   returned `noteId` / `taskId`.

[Architecture](#architecture) · [Design decisions](#design-decisions) · [Run locally](#run-locally) · [Demo edge case](#demo-edge-case)

---

## What it does

| Capability | How it's surfaced |
|---|---|
| Ask questions about the call / customer | Free-form voice turn, Earshot replies in `marin` voice |
| Capture a structured note + **revise / delete it later by voice** | `save_note` / `update_note` / `delete_note` — written to a shared in-browser `noteStore`, shown in the **Saved notes** panel with live status badges |
| Create a follow-up task + **update / cancel it later by voice** | `create_follow_up_task` / `update_follow_up_task` / `cancel_follow_up_task` — written to `taskStore`, shown in the **Follow-up tasks** panel with strikethrough on cancel |
| **Prevent duplicate tasks** | `create_follow_up_task` is schema-checked for near-duplicates (same customer + due + channel + body) — returns `duplicate_likely` to the agent, which asks the rep before taking action |
| **Edit what the rep said** | Inline pencil icon on user transcript lines. Edits are local UI truth; tool args stay as the model captured them. "edited" badge + one-click undo |
| **Surface transcript ↔ tool-arg divergence** | When a tool's `customer` arg doesn't match the transcript line it came from, an amber `→ <name>` chip appears inline. Editable in either direction (see [Demo edge case](#demo-edge-case)) |
| See what was said | Live transcript strip, streams dim-to-solid as turns complete |
| See what was _done_ | Agent actions feed — collapsible tool-call cards with args, result, elapsed ms |

All six tool `execute` handlers run client-side and write to in-browser
stores. Swapping each one for a real `/api/tools/*` route + database is a
single-file change per tool — the Zod schemas stay the same. See
[Known limitations](#known-limitations--future-work).

---

## Architecture

```text
┌─────────────────┐      1. POST /api/session       ┌───────────────────┐
│     Browser     │ ──────────────────────────────► │   Next.js API     │
│   (page.tsx)    │                                 │  /api/session     │
│                 │ ◄──── ek_... ephemeral token ── │                   │
└────────┬────────┘                                 └─────────┬─────────┘
         │                                                    │
         │ 2. WebRTC handshake + audio                        │ server-only:
         │    (via @openai/agents-realtime)                   │ OPENAI_API_KEY
         ▼                                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   OpenAI Realtime API                                │
│   model: gpt-realtime   ·   voice: marin   ·   transport: WebRTC     │
│                                                                      │
│   tool calls ──► 6 tools across 2 lifecycles:                        │
│                    notes:  save / update / delete                    │
│                    tasks:  create / update / cancel                  │
│                  (executed in the browser against in-memory stores;  │
│                   result sent back to the model)                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Three moving parts, no more:**

1. `app/api/session/route.ts` — tiny Next.js route. Trades the long-lived
   `OPENAI_API_KEY` for a short-lived `ek_...` ephemeral token. That's the only
   thing our server ever sees.
2. `app/page.tsx` — the browser client. Fetches the ephemeral token, spins up a
   `RealtimeAgent` + `RealtimeSession`, attaches the mic, plays audio back,
   subscribes to `agent_tool_start` / `agent_tool_end` / `history_updated`.
3. `app/lib/tools/*.ts` — each tool is a `tool()` from
   `@openai/agents-realtime` with a Zod schema and an `execute` handler.

Audio bytes never touch our server. The only thing crossing our boundary is the
ephemeral-token request.

---

## Design decisions

### 1. WebRTC over WebSocket

**Chose WebRTC** (via `@openai/agents-realtime`), not raw WebSocket frames.

**Why it fits this product:**

- **Lower perceived latency.** Browser-native RTP + Opus round-trips in the
  200–400 ms range; WS with base64 PCM chunks typically lands in 500–900 ms.
  For a sales rep mid-conversation, that gap is the difference between "feels
  alive" and "feels like a walkie-talkie."
- **Browser-native audio stack.** The SDK wires `getUserMedia` → peer connection
  → `<audio>` element automatically. No manual PCM encode/decode, no
  `AudioContext` plumbing, no resampling surprises.
- **Packet-loss tolerance.** RTP/DTLS absorbs jitter gracefully. A rep on a
  train or hotel Wi-Fi degrades instead of dropping the turn.
- **Audio bytes never hit our server.** Only the ephemeral-token mint does.
  Simpler deploy story, lower serverless cost, no streaming-proxy edge-case
  handling.

**Trade-offs accepted:**

- WS is easier to debug (plain JSON frames you can `console.log`). Mitigated
  with disciplined client-side logging on `agent_tool_start` / `agent_tool_end`.
- WS is the only option for purely text-based real-time. Not a factor — voice
  is the point.

### 2. Ephemeral tokens (the client-server-AI triangle)

The root `OPENAI_API_KEY` lives in `.env.local` (dev) and Vercel's encrypted
env store (prod). It never leaves the Next.js server. `/api/session` exchanges
it for an `ek_...` token that:

- is scoped to a single realtime session,
- expires in ~20 min,
- is one-time-use for the WebRTC handshake,
- and costs nothing meaningful if leaked.

This is the pattern OpenAI's own `openai-realtime-agents` reference repo uses,
and it's the right default for any browser-originated API call.

### 3. Client-side tool execute (for now)

`@openai/agents-realtime` runs tool `execute` handlers in the browser. For a
demo that's fine — the tool call is visible in DevTools, the round-trip is
zero network hops, and the "does a tool call even fire" question gets answered
in one keystroke.

For production, each tool's `execute` would become a thin `fetch()` to a
server route (e.g. `/api/tools/save-note`) where real persistence, auth, and
audit logging live. The shape of the Zod schemas would not change.

### 4. shadcn (Radix Nova) + Vercel AI Elements

- **shadcn/Radix Nova preset** for the shell: Lucide icons, Geist font,
  forced dark mode. Chose Nova over the default stone preset for its serif
  heading — gives the page a distinct voice without a custom design system.
- **Vercel AI Elements `<Tool>` primitive** for each tool-call card:
  collapsible, status-badged (`Running` / `Completed` / `Error`),
  shiki-highlighted JSON input and output panes. Maps 1:1 onto
  `agent_tool_start` + `agent_tool_end` events. A generic shadcn `Card` would
  have worked; the AI Elements version is more distinctly "agentic" at a
  glance.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.4 (App Router, Turbopack) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/postcss`) |
| Component kit | shadcn (Radix Nova preset) |
| AI UI kit | [Vercel AI Elements](https://ai-sdk.dev/elements) (`<Tool>`, `<CodeBlock>`) |
| Realtime SDK | `@openai/agents-realtime` — WebRTC transport |
| AI backend | OpenAI Realtime API, `gpt-realtime` model, `marin` voice |
| Schema | Zod (tool params) |
| Icons / fonts | Lucide · Geist sans + mono |
| Deploy | Vercel (Node runtime, default preset) |

Node 20.19.0 · npm 10.8.2 · React 19 · no `src/` directory (matches OpenAI's
reference realtime-agents repo).

---

## Run locally

```bash
# 1. Install
npm install

# 2. Env — needs a real OpenAI key with Realtime access
cp .env.example .env.local
# then edit .env.local and paste your sk-proj-... key

# 3. Dev server
npm run dev

# 4. Open http://localhost:3000 in Chrome, click "Start talking"
```

That's it. No database, no Redis, no migrations.

---

## Demo edge case

### Trust, transcription, and the "Atmas / Acme" phenomenon

In seven independent test sessions the live transcript rendered a customer
name differently than what the tool call captured:

| What the transcript showed | What the tool arg stored |
|---|---|
| "Atmas CFO" | `customer: "Acme CFO"` |
| "Akne" / "Agnes" | `customer: "Acme"` |
| "Globelex" / "Gloplex" / "Globepex" | `customer: "Gloplex"` |
| "Admin Campaign" | `customer: "Acme CFO"` |
| "TechNicorp" | `customer: "TechNicorp"` _(no divergence)_ |

That's not a bug — it's two different systems doing two different jobs:

- **Transcription** is phoneme → text. It picks the statistically-likely
  English spelling of what it heard, with no knowledge of whom you're
  talking about.
- **`gpt-realtime`** has both the audio _and_ the running conversation.
  When the rep says something that sounds like "Atmas" right after five
  tool calls to "Acme", the reasoning model can decide they meant Acme.
  When they say something that sounds like "Atmos" at the start of a
  clean session, the reasoning model takes them at their word.

### The design principle: agent trusts the rep's literal words by default

Building this, the obvious failure mode would be to have the agent always
consolidate similar-sounding names to a recently-mentioned customer. That
breaks real-world sales, where accounts with near-identical names are
common (Atmos Energy, Acme Corp, and Atlas Inc can all be live
simultaneously). The system prompt explicitly instructs the model to
trust what the rep said unless the rep says otherwise. In testing, this
holds: seven of seven sessions captured the rep's literal word as the
customer; the divergences above only occurred when the conversation
context _already_ anchored to a prior customer.

### The divergence chip — a symmetric trust affordance

When a tool call's `customer` arg doesn't substring-match the transcript
line that triggered it, a small amber `→ <name>` chip appears inline on
the transcript line. This happens in both failure modes:

- **Transcription mis-heard.** ASR wrote "Atmas", the agent (correctly)
  captured "Acme". Chip surfaces the disagreement. Rep clicks the pencil
  icon on the transcript line, edits to match. Chip disappears.
- **Agent over-normalized.** The rep meant Atmos-the-separate-company,
  but the agent consolidated to Acme. Chip surfaces the disagreement.
  Rep says out loud: _"that was actually Atmos, not Acme."_ The agent
  calls `update_note` / `update_follow_up_task` with the new `new_customer`
  field, fixing the record. Chip recomputes against the updated tool arg
  and disappears.

Same chip, bi-directional correction. Both the transcript and the tool
args are editable by the right side of the system. The chip is neutral —
it doesn't take a side on which is correct.

> In production, add a `resolve_entity` fuzzy-match against a real CRM
> before the mutation lands. The divergence chip becomes a click-to-
> disambiguate affordance against actual customer records.

---

## Brief scoreboard

Against the Instalily case-study brief (the source brief is a local doc, not in
this repo):

### Requirements

- [x] Next.js App Router + shadcn + Tailwind
- [x] Real-time voice in/out via OpenAI Realtime API
- [x] Voice flow: ask questions, capture notes, create follow-ups
- [x] UI visualization of agent actions / tool calls (name, args, status, result, duplicate warnings)
- [x] Transport choice explained ([WebRTC, see above](#1-webrtc-over-websocket))
- [x] ≥1 real tool integration — **six wired** across two lifecycles (notes: save / update / delete, tasks: create / update / cancel)

### Additional goals (brief asks for ≥2, we have all four)

- [x] Vercel AI Elements on top of shadcn (`<Tool>` primitive drives the action feed)
- [x] Real-time transcription with full trust & correction UI — streaming dim-to-solid text, **editable user lines with undo**, **transcript ↔ tool-arg divergence chip** that resolves bidirectionally
- [x] Active state panels for both lifecycles — **Saved notes** and **Follow-up tasks** cards render live state with `updated` / `cancelled` / `deleted` badges
- [ ] Full responsive polish — partial; readable on mobile, not yet thumb-tuned

### Deliverables

- [x] Deployed URL — [salescall-realtime-agent.vercel.app](https://salescall-realtime-agent.vercel.app)
- [x] Public GitHub — you're on it
- [ ] 5-min presentation — drafted separately for the interview

---

## Known limitations & future work

1. **Client-side tool execute with in-memory stores.** All six tools run in the
   browser and write to module-level `Map`-backed stores (`taskStore`,
   `noteStore`). Refresh clears state. First production step is a
   `/api/tools/*` route per tool plus a real database — the Zod schemas stay
   the same; `useSyncExternalStore` bindings in `page.tsx` just swap to
   server-source hooks.
2. **No `resolve_entity` / fuzzy customer match against a real CRM.** Today
   the tools accept whatever the model fills in for `customer`. A real
   deployment would look up the customer in the CRM before mutating — the
   divergence chip would become a click-to-disambiguate affordance against
   actual records.
3. **No `list_*` tools.** When the rep asks _"what are my tasks?"_, the agent
   answers from its conversation memory (observed working in testing). Proper
   version: `list_follow_up_tasks` / `list_notes` so the store is the source
   of truth for queries, not the model's window.
4. **Transcript trust/correction is half-built.** We have editable user lines
   (with undo), active-state panels with lifecycle badges, and the divergence
   chip. Deliberate future scope: per-word confidence cues from the ASR, and
   a click-to-jump link from each tool-call card to the triggering transcript
   line.
5. **Duplicate detection is tasks-only.** Notes are intentionally stackable —
   two notes about the same customer are normal. If that turns out to be
   wrong in practice, the same `findNearDuplicate*` pattern drops into
   `noteStore` cleanly.
6. **Language drift mitigation is prompt-level.** `gpt-realtime` occasionally
   greets in Spanish on the first turn. A single _"Always respond in
   English…"_ directive in the system prompt pins it. Cleaner fix would be
   the Realtime API's language param when / if it's exposed.
7. **Elapsed-time in tool cards is ~0 ms** because execute returns
   synchronously from the client-side stubs. Will become realistic on the
   first move to server routes.
8. **Mobile layout is readable but not thumb-optimized.** The big-round
   start-talking button helps; below-the-fold scrolling on tool cards with
   wide JSON could use compact mode on small viewports.

---

## Project layout

```text
app/
├── api/session/route.ts           # mints ek_... ephemeral token
├── layout.tsx                     # forces dark mode, Geist fonts
├── page.tsx                       # the entire voice UI (client component)
└── lib/
    ├── store/
    │   ├── taskStore.ts           # module-level task store + cached snapshot
    │   └── noteStore.ts           # module-level note store + cached snapshot
    └── tools/
        ├── saveNote.ts
        ├── updateNote.ts
        ├── deleteNote.ts
        ├── createFollowUpTask.ts  # with near-duplicate detection
        ├── updateFollowUpTask.ts
        └── cancelFollowUpTask.ts
components/
├── ai-elements/                   # Vercel AI Elements (tool.tsx, code-block.tsx)
└── ui/                            # shadcn primitives
lib/utils.ts                       # shadcn cn() helper
```

No `src/` directory — matches OpenAI's
[openai-realtime-agents](https://github.com/openai/openai-realtime-agents)
reference repo to keep copy-paste cost low when picking up patterns.

---

## Credits

- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) · [openai-realtime-agents](https://github.com/openai/openai-realtime-agents) reference repo
- [shadcn/ui](https://ui.shadcn.com/) (Radix Nova preset) · [Vercel AI Elements](https://ai-sdk.dev/elements)
- [Next.js](https://nextjs.org) · [Tailwind CSS](https://tailwindcss.com)
