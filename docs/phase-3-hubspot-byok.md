# Phase 3 — HubSpot + BYOK

> **Goal.** Make Earshot real for strangers. Connect a real CRM (HubSpot OAuth +
> sync) and let each user bring their own OpenAI key (BYOK). After this phase,
> the maintainer's costs stay near zero and a new user is fully self-serve.
>
> **Done when.** A friend signs up, pastes their own OpenAI key, connects their
> own HubSpot, picks a real company, and gets a real pre-call briefing — with the
> maintainer touching nothing.

This is the largest phase. It has two independent workstreams — **BYOK** and
**HubSpot**. Do BYOK first: it is smaller and it unblocks every call.

---

## 1. Research notes

### Read first
- `node_modules/next/dist/docs/` — route handlers again, plus anything on
  redirects (the OAuth callback).
- `app/api/session/route.ts` — currently mints the ephemeral token from the
  owner's `OPENAI_API_KEY`. BYOK rewrites this.
- `app/api/summarize/route.ts` — also uses the owner's key. It must switch to
  the user's key too (consistency: "your key, your bill").
- `app/lib/tools/getCustomerContext.ts` and `app/lib/data/customers.ts` — the
  mock CRM that HubSpot replaces.
- `components/earshot/{customer-picker-card,pre-call-briefing,top-rail}.tsx` —
  the UI that reads customers.

### HubSpot facts (validated 2026-05)
- **Public app** in a HubSpot **developer account**. The OAuth flow:
  - Authorize: redirect the user to
    `https://app.hubspot.com/oauth/authorize?client_id=...&redirect_uri=...&scope=...&state=...`
    (`scope` is space-separated, URL-encoded; `state` is a CSRF token).
  - Token exchange: `POST https://api.hubapi.com/oauth/v1/token`,
    `Content-Type: application/x-www-form-urlencoded`,
    `grant_type=authorization_code&client_id=...&client_secret=...&redirect_uri=...&code=...`.
- **Scopes** (granular — avoid the legacy `contacts` scope):
  `crm.objects.contacts.read`, `crm.objects.contacts.write`,
  `crm.objects.companies.read`, `crm.objects.deals.read`,
  `crm.objects.deals.write`, `crm.objects.owners.read`.
  **Gotcha:** there is no `crm.objects.notes.write` / `tasks.write` scope —
  creating notes and tasks is gated by **`crm.objects.contacts.write`**.
- **Tokens:** access token TTL **30 minutes** (`expires_in: 1800`). The refresh
  call (`grant_type=refresh_token` at the same `/oauth/v1/token` endpoint)
  returns a **new refresh token each time** — persist whatever comes back.
  Refresh proactively (~5 min before expiry).
- **CRM v3 reads:** `GET https://api.hubapi.com/crm/v3/objects/{contacts|companies|deals}?limit=100&after={cursor}`;
  owners at `/crm/v3/owners`. Paginate via `paging.next.after` until absent.
  Batch read available at `POST /crm/v3/objects/{type}/batch/read` (100/call).
- **Rate limit (public app):** ~**110 requests / 10 seconds** per installed
  account, no daily cap. `429` → back off; honor `X-HubSpot-RateLimit-*`
  headers.
- **Test account:** a HubSpot developer account can create a free **developer
  test account** (Development → Test Accounts, or `hs test-account create`).
  Sample CRM data is not pre-seeded — import HubSpot's example contact/company
  CSVs (`hs test-account import-data`) so the app can be demoed without a paid
  subscription.

### Encryption facts
- Store HubSpot tokens and the user's OpenAI key **encrypted at rest**.
- Recommendation: **app-level AES-256-GCM** with a 32-byte master key in
  `EARSHOT_ENCRYPTION_KEY` (Vercel env / local `.env.local`). Reason: the app
  already decrypts in Node to call HubSpot/OpenAI, and app-level encryption
  keeps RLS as the *only* tenant boundary. (Supabase Vault is fine too, but its
  `decrypted_secrets` view is easy to over-expose — only worth it if you need to
  decrypt inside SQL.)

### External setup (do before coding the HubSpot half)
1. Create a **HubSpot developer account**.
2. Create a **public app**; on the Auth tab grab `client_id` / `client_secret`,
   set the redirect URL (e.g. `http://localhost:3000/api/hubspot/callback` for
   dev), and select the six scopes above.
3. Create a **developer test account** and import sample CRM data into it.

---

## 2. Design decisions

### New tables
- `hubspot_connections` — `id uuid`, `user_id text` (unique), `hub_id text`
  (HubSpot portal id), `access_token_encrypted text`,
  `refresh_token_encrypted text`, `expires_at timestamptz`, `scopes text`,
  `status text` (`active`/`stale`), `connected_at`, `updated_at`.
- `openai_keys` — `id uuid`, `user_id text` (unique), `key_encrypted text`,
  `key_last4 text` (so Settings can show "…sk-…ab12" without decrypting),
  `added_at timestamptz`.
- `crm_objects` — `id uuid`, `user_id text`, `hubspot_id text`,
  `object_type text` (`contact`/`company`/`deal`/`owner`),
  `properties jsonb`, `synced_at timestamptz`. A generic mirror — boring and
  flexible; the customer picker reads `company` rows, the briefing joins
  associated contacts/deals.

All three get RLS owner policies, same pattern as Phase 1.

### Encryption module
`app/lib/server/crypto.ts` — `encrypt(plaintext)` / `decrypt(ciphertext)` using
AES-256-GCM and `EARSHOT_ENCRYPTION_KEY`. Encrypted values never leave the
server; the browser never sees a token or a raw key. Settings UI shows only
`key_last4` and connection status.

### BYOK
- **Settings page** (`/settings`): paste an OpenAI key → `POST
  /api/settings/openai-key`. The route makes one cheap **validation call** to
  OpenAI, then encrypts and stores the key + `key_last4`. Show the clear
  warning: *"Your key, your usage, your bill."*
- **`/api/session` rewrite:** look up the signed-in user's `openai_keys` row,
  decrypt, and mint the ephemeral token with **their** key. No key → return a
  structured "no key" response; the UI shows an "add your key" gate instead of
  starting a call.
- **`/api/summarize` rewrite:** same — use the user's key. (If a user has no
  key they cannot start a call anyway, so summarize always has one.)
- **Never** a hosted-key fallback. That is the cost trap (vision doc, hard no).

### HubSpot OAuth
- `GET /api/hubspot/connect` — generate a `state` token, redirect to HubSpot's
  authorize URL.
- `GET /api/hubspot/callback` — verify `state`, exchange `code` for tokens,
  encrypt and store in `hubspot_connections`, then kick off the initial sync.
- `POST /api/hubspot/disconnect` — delete the connection row (and optionally the
  user's `crm_objects`); the picker falls back to demo mode.

### HubSpot API client
`app/lib/server/hubspot.ts` — wraps `fetch` with a user's access token, and:
- **auto-refreshes** when the token is within ~5 min of `expires_at`, persisting
  the rotated refresh token;
- applies a **token-bucket limiter** (~10 req/s) and **exponential backoff** on
  `429`;
- on a refresh failure, marks the connection `status = 'stale'` so the UI can
  prompt a reconnect.

### Initial sync
`POST /api/hubspot/sync` — paginate contacts, companies, deals, and owners into
`crm_objects` (upsert by `hubspot_id`). The UI shows a "Syncing your CRM…"
state. For large accounts, page at `limit=100` and use batch reads; this is the
only place rate limits realistically bite.

### `get_customer_context` reads HubSpot
The Phase 2 `/api/tools/get-customer-context` route now queries `crm_objects`
instead of the mock `customers.ts`. The customer picker (`top-rail`,
`customer-picker-card`) lists `company` rows; `pre-call-briefing` composes its
dossier from the company + associated contacts/deals.

### Demo mode (keep the mock CRM)
A user who has **not** connected HubSpot still sees the four mock customers from
`customers.ts`, clearly labeled **"Demo data."** This is the vision doc's
open-question answer ("probably yes — lowers trial friction a lot"). So
`customers.ts` stays; a `demoMode` flag (true when no active
`hubspot_connections` row) selects the data source. The customer-validation
logic in the update tools (Phase 2) also follows this flag.

### Onboarding flow
After Clerk sign-up, a guided 3-step stepper:
1. **Add your OpenAI key** (required — gates calls).
2. **Connect HubSpot** (skippable → demo mode).
3. **Start your first call.**
The main UI is gated until at least step 1 is done.

---

## 3. Task breakdown

Two workstreams. **A (BYOK) ships first**, then **B (HubSpot)**.

### Workstream A — BYOK
1. Research pass; confirm the OpenAI key-validation call shape.
2. Schema: add `openai_keys`; RLS; `drizzle-kit generate` + `migrate`.
3. `app/lib/server/crypto.ts` — AES-256-GCM; add `EARSHOT_ENCRYPTION_KEY` to
   `.env.local` / `.env.example`.
4. `/api/settings/openai-key` — validate, encrypt, store; and a route to
   read status (`key_last4`) / delete the key.
5. `/settings` page — paste key, show status, "your key your bill" warning.
6. Rewrite `/api/session` to use the user's decrypted key; structured "no key"
   response.
7. Rewrite `/api/summarize` likewise.
8. "No key" gate in the call UI (replace the disabled-button state with a
   prompt linking to Settings).

### Workstream B — HubSpot
9. Research pass; create the HubSpot developer account, public app, and test
   account with sample data.
10. Env: `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI`.
11. Schema: add `hubspot_connections` + `crm_objects`; RLS; migrate.
12. OAuth routes: `/api/hubspot/connect`, `/api/hubspot/callback`,
    `/api/hubspot/disconnect`.
13. `app/lib/server/hubspot.ts` — API client with refresh, rate limiting,
    backoff, stale-on-refresh-failure.
14. `/api/hubspot/sync` — paginate contacts/companies/deals/owners into
    `crm_objects`; "Syncing…" UI state.
15. Rewire `/api/tools/get-customer-context` to read `crm_objects`.
16. Customer picker + pre-call briefing read `crm_objects` companies.
17. Demo-mode flag + "Demo data" labeling; mock-CRM fallback when not connected.
18. Update-tool customer validation follows the demo/HubSpot flag.

### Tie-together
19. Onboarding stepper (sign-up → key → HubSpot/skip → first call).
20. Settings page: HubSpot connection status, reconnect-when-stale prompt,
    disconnect; OpenAI key status.

---

## 4. Testing instructions

Run after implementation. All steps must pass before Phase 4.

**BYOK**
1. `drizzle-kit migrate`; confirm `openai_keys` exists with RLS.
2. Sign up as a fresh user. Try to start a call → you are **blocked** with a
   clear "add your OpenAI key" prompt, not a cryptic error.
3. Go to `/settings`, paste an **invalid** key → rejected with a clear message.
4. Paste a **valid** key → accepted; Settings shows "key ending …XXXX".
5. Supabase → `openai_keys`: the row's `key_encrypted` is **ciphertext**, not a
   readable `sk-...`.
6. Start a call → it connects (minted with the user's key). End it → the
   summary generates (also the user's key).

**HubSpot**
7. `drizzle-kit migrate`; confirm `hubspot_connections` + `crm_objects` exist.
8. In Settings, click **Connect HubSpot** → redirected to HubSpot → approve in
   your **test account** → redirected back showing "Connected."
9. The sync runs; a "Syncing…" state shows, then `crm_objects` fills (check the
   Supabase table).
10. The customer picker now lists **real companies** from the test account
    (no longer the four mocks).
11. Pick a real company → the pre-call briefing shows real data. Start a call,
    ask *"what's the deal stage?"* → `get_customer_context` answers from HubSpot.
12. Supabase → `hubspot_connections`: tokens are **encrypted**.

**Demo mode**
13. Sign up as another fresh user, **skip** the HubSpot step → the four mock
    customers appear, labeled "Demo data." Calls still work (BYOK key added).
14. Disconnect HubSpot for the first user → the picker falls back to demo mode;
    the connection row is gone.

**Self-serve proof**
15. Hand the running app to someone else. They sign up, add **their** key,
    connect **their** HubSpot, and complete a call — you do nothing.

**Pass criteria:** a new user is fully self-serve; secrets are encrypted at
rest; HubSpot data drives the briefing; demo mode works for the un-connected.

---

## 5. Risks & open questions

- **OAuth redirect URI must match exactly** between the HubSpot app config and
  `HUBSPOT_REDIRECT_URI` — including `http`/`https` and trailing slash. Mismatch
  = opaque OAuth error. You will need separate dev and prod redirect URIs.
- **Refresh-token rotation.** HubSpot returns a *new* refresh token on every
  refresh. Failing to persist it = the connection silently dies in ~30 min.
- **`EARSHOT_ENCRYPTION_KEY` is load-bearing.** Lose it or rotate it carelessly
  and every stored token/key becomes undecryptable. Document this in the README;
  treat it like a database credential.
- **Notes/tasks write scope.** Remember writes are gated by
  `crm.objects.contacts.write`, not a notes/tasks scope — request it now even
  though the write-back lands in Phase 4, so users don't have to re-authorize.
- **Big-account sync time.** Thousands of contacts at 100/page is fine for
  reads, but per-object association fetches can hit the 110/10s ceiling — page,
  batch, and rate-limit. A "syncing" state is mandatory UX.
- **Token-refresh-failure UX.** Decide the reconnect flow now: mark `status =
  'stale'`, surface a banner, route to Settings.
- **Demo-mode boundary.** Be explicit in the UI which data is real vs demo, so a
  user never thinks a demo note synced to a real CRM.
