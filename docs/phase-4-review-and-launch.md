# Phase 4 — Review-and-sync + Launch

> **Goal.** Build the trust layer: after a call, the user reviews every captured
> note/task as a *suggested* CRM update, edits anything, and approves — only then
> does it sync to HubSpot. Then polish and open-source the project.
>
> **Done when.** A full call → review screen → edit a suggestion → approve →
> the note/task lands in the user's real HubSpot. The repo is public (MIT) with
> self-host instructions a stranger can follow.

---

## 1. Research notes

### Read first
- `node_modules/next/dist/docs/` — **metadata / SEO** APIs for the landing page.
- `README.md` "Demo edge case" — the divergence chip and the **"trust the
  literal word"** philosophy. Review-before-sync is the direct extension of it:
  the agent drafts, the human approves.
- `app/lib/types.ts` — `ToolCall` already carries `sourceItemId` and
  `sourceItemText` (the transcript line that triggered a tool). The review
  screen reuses these to show provenance per suggestion.
- `components/earshot/post-call-summary-card.tsx` — the MEDDIC summary that
  becomes collapsible.
- The Phase 3 `app/lib/server/hubspot.ts` client — Phase 4 adds write methods.

### HubSpot write facts (validated 2026-05)
- Create a note: `POST https://api.hubapi.com/crm/v3/objects/notes` with
  `{ properties: { hs_timestamp, hs_note_body, hubspot_owner_id } }`
  (`hs_timestamp` required — ms epoch or ISO).
- Create a task: `POST https://api.hubapi.com/crm/v3/objects/tasks` with
  properties `hs_timestamp` (due date), `hs_task_subject`, `hs_task_body`,
  `hs_task_status` (`NOT_STARTED`/`COMPLETED`), `hs_task_priority`,
  `hs_task_type` (`TODO`/`CALL`/`EMAIL`).
- **Associate** an engagement with a contact/company/deal — either inline in
  the create call via an `associations` array, or via the associations API.
  HubSpot-defined association type IDs: note→contact **202**, note→company
  **190**, note→deal **214**; task→contact **204**, task→company **192**,
  task→deal **216**. **Verify these live** with
  `GET /crm/v4/associations/{from}/{to}/labels` — the IDs occasionally shift.
- Writes are gated by the `crm.objects.contacts.write` scope (requested in
  Phase 3).

---

## 2. Design decisions

### Postgres is the staging area; HubSpot is downstream
During a call, the Phase 2 tool routes write notes/tasks to **Postgres only** —
they never touch HubSpot. HubSpot is written **only** on explicit approval after
the call. This is the non-negotiable trust rule: *no auto-mutation of a user's
CRM.*

### Schema changes
Add to `notes` and `tasks`:
- `hubspot_id text` (nullable — set once synced),
- `synced_at timestamptz` (nullable),
- `sync_status text` — `unsynced` (default) / `synced` / `error`.

### The review screen
When a call ends, the user sees the post-call summary **and** a **Review &
Sync** panel. The panel lists every note/task captured *in that call* as a card:
- editable fields (note body/tags; task body/due/channel),
- the **source transcript line** that triggered it (`sourceItemText`) — the
  same provenance the divergence chip established,
- a per-item **Approve & Sync** button,
- a **Sync all** action.

On approval, `POST /api/hubspot/push` writes the item to HubSpot (note/task
engagement + association to the matched company/contact) and stamps
`hubspot_id` + `synced_at` + `sync_status = 'synced'` on the Postgres row.
The push is **idempotent** — an item with a `hubspot_id` is skipped (no
double-create).

### Unsynced items persist; sync-from-history
Declining or ignoring a suggestion leaves it in Postgres as `unsynced` — it is
not lost and not pushed. The Call Log lets the user reopen a past call and
review/sync its still-unsynced items later.

### MEDDIC summary becomes collapsible
Per the vision doc: "most users want the headline + next steps, not a full
sales-methodology audit." The `post-call-summary-card` renders headline + next
steps expanded; the MEDDIC block collapses behind a toggle.

### Deal updates are out of scope for v1
The seven tools capture notes and tasks — none updates a deal stage. Phase 4's
review-and-sync therefore covers **notes and tasks only**. Deal write-back is a
post-launch item (the `crm.objects.deals.write` scope is already requested, so
no re-authorization is needed if it is added later).

### Launch is mostly non-code
The code deliverables are the review screen and the landing page. The demo
video and the launch posts (Medium, LinkedIn, Show HN, r/sales) are the
maintainer's to produce — listed here for completeness, not built by this phase.

---

## 3. Task breakdown

### Review-and-sync
1. Research pass; **verify HubSpot association type IDs live** against the test
   account.
2. Schema: add `hubspot_id`, `synced_at`, `sync_status` to `notes` + `tasks`;
   `drizzle-kit generate` + `migrate`.
3. Extend `app/lib/server/hubspot.ts` with `createNote`, `createTask`, and
   association helpers.
4. `POST /api/hubspot/push` — takes a note/task id, writes to HubSpot,
   associates it, stamps the Postgres row. Idempotent. Per-item error handling.
5. **Review & Sync panel** — a new component listing the just-ended call's
   captured items, each editable, each showing its source transcript line, with
   per-item approve + "Sync all."
6. Wire the post-call flow: call ends → summary **and** the review panel.
7. Make the MEDDIC summary collapsible in `post-call-summary-card.tsx`.
8. Sync-from-history: from the Call Log, reopen a past call and review/sync its
   `unsynced` items.
9. Per-item sync status UI — `unsynced` / `syncing` / `synced` / `error` with a
   retry on error.

### Launch polish
10. **Landing page** — a public route that explains the wedge (voice-first
    capture between/after calls, BYOK, HubSpot, open-source). Clear enough that
    a stranger gets it in 10 seconds.
11. **README rewrite** — self-host instructions: creating Clerk + Supabase +
    HubSpot accounts, every env var, running migrations, the
    `EARSHOT_ENCRYPTION_KEY` warning, the architecture, and the BYOK explainer.
12. **`.env.example`** — complete and accurate for a fresh clone.
13. **Open-source checklist** — scrub for committed secrets, confirm the MIT
    `LICENSE`, add a short contributing note, tidy the repo.
14. *(Maintainer, non-code)* — 60-second demo video; Medium post; LinkedIn
    post; Show HN / r/sales / Product Hunt submissions.

---

## 4. Testing instructions

Run after implementation. This is the final gate.

**Capture → review**
1. `drizzle-kit migrate`; confirm `notes`/`tasks` have the three new columns.
2. Start a call (HubSpot connected, from Phase 3). Capture **two notes and one
   task** by voice for a real company.
3. End the call. The post-call view shows the summary **and** a Review & Sync
   panel listing all three items, each with its **source transcript line**.

**Edit → approve → sync**
4. Edit one note's body in the review panel. Click **Approve & Sync**.
5. In your HubSpot test account, open that company → the note exists, with the
   **edited** text, associated to the right record.
6. Click **Sync all** for the rest → all land in HubSpot; each Postgres row gets
   `hubspot_id` + `synced_at` + `sync_status = 'synced'`.

**No auto-write / idempotency**
7. Confirm that *before* you approved, **nothing** had been written to HubSpot —
   the call alone never mutates the CRM.
8. Reopen the same call from the Call Log → synced items show "Synced" and
   cannot be synced again (no duplicates created in HubSpot).
9. Capture an item and **decline** it → it stays in Postgres as `unsynced` and
   never appears in HubSpot.

**Summary**
10. The MEDDIC block is collapsed by default; headline + next steps are visible.

**Launch readiness**
11. Visit the landing page — it explains the product clearly.
12. On a clean machine: `git clone`, follow the README only, plug in fresh
    Clerk/Supabase/HubSpot/OpenAI credentials → the app runs and a call works.
13. `git grep` for secrets — nothing sensitive is committed.

**Pass criteria:** nothing reaches HubSpot without explicit per-item approval;
the full call → review → sync loop works with real CRM data; a stranger can
self-host from the README alone.

---

## 5. Risks & open questions

- **Association type IDs drift.** Verify them live against the test account
  before relying on the constants — note→contact 202 etc. are defaults, not
  guarantees.
- **Idempotency.** A re-sync, a double-click, or a retry must not create a
  duplicate engagement in HubSpot. Gate every push on `hubspot_id` being null.
- **Partial sync failure.** "Sync all" across several items must be per-item —
  one failure should not roll back the successes. Track `sync_status` per row
  and offer a retry.
- **Source-line provenance.** `sourceItemText` is a *snapshot* taken at
  tool-start; if the user edited the transcript line afterward, the review
  screen should show the snapshot the tool actually saw (this matches the
  divergence-chip semantics — do not silently "fix" it).
- **Launch readiness is subjective.** The objective gate is step 12 — a clean
  clone runs from the README. Treat demo video and posts as done-when-the-
  maintainer-is-satisfied, not blockers for "code complete."
- **Post-launch backlog** (explicitly *not* now): deal-stage write-back,
  Salesforce, Gmail drafts, Recall.ai bot mode. Revisit only if the vision
  doc's "great outcome" traction bar is hit.
