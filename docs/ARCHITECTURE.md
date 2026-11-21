# Expense Tracker: Architecture

Personal spending tracker that captures transactions from Gmail, lets each user
review every captured spend, and allocates it (personal, work claim, shared,
household). Built for one owner plus a few invitees (e.g. spouse).

## 1. Decisions (approved)

| # | Topic | Decision |
|---|---|---|
| 1 | Users | Owner + a few invitees. Every row carries `user_id`; sign-in limited to invited emails. |
| 2 | Ingestion | **Google Apps Script** in each user's own Google account. Scans Gmail every ~5 min with a broad search, posts candidates to the app, labels what it sent, sends a heartbeat. Inbox permission never leaves Google. |
| 3 | Hosting | **Vercel (Hobby)** for the Next.js app + API, functions pinned to Singapore (`sin1`). **Supabase (Free, Singapore)** for Postgres, Google sign-in and row-level security. No payment card on either. |
| 4 | AI | Exact rules for known senders → merchant memory → keyword rules → AI. AI = **Jev** (decisions) and **Claude Haiku 5.5** (extraction for unknown senders), both via **OpenRouter**, behind one `Decider` interface; the better scorer on the labelled test set wins. |
| 5 | Review | **Every spend is reviewed.** Auto-accept is off and only switched on by the user, per sender or merchant. |
| 6 | Spend rules | Coinhako buys = investment (not spend). PayNow to individuals suggested as spend. Refunds = negative spend. Card hold reversals and card bill payments ignored. |
| 7 | Scope v1 | Capture, review queue, dashboard, transactions, Quick Add, CSV export, invitees, allocations (personal / work claim / shared-I-paid-first / household). |
| 7c | Household | Separate bucket, excluded from personal spend. S$800 monthly budget (resets). Owner funds 100%; spends paid by the spouse are "owed to spouse" until reimbursed. |
| 8 | Repo | Private. |

## 2. System diagram

```
 Gmail (user A) ──► Apps Script A ─┐  POST /api/ingest  (Bearer ingest key)
 Gmail (user B) ──► Apps Script B ─┤  POST /api/ingest  (heartbeat included)
                                   ▼
                    Vercel (Next.js, region sin1)
                    ├─ pipeline: filter → parse → type rules → dedupe → categorise
                    ├─ AI step (OpenRouter: Jev / Haiku) ── cost guard (monthly cap)
                    ├─ web UI: review queue, allocations, dashboard, settings, costs
                    └─ daily cron: FX rates, heartbeat check, keep-alive query
                                   ▼
                    Supabase Postgres (Singapore) + Auth (Google) + RLS
```

## 3. Processing pipeline (per email)

1. **Receive** – Apps Script sends `{messageId, threadId, from, subject, date, labels, text}`.
   Stored in `source_emails` (unique per user + Gmail message id ⇒ idempotent).
2. **Filter** – Gmail Promotions category, `<ADV>` subjects and known marketing
   senders are rejected with a reason (visible in the "possibly missed" list).
3. **Parse** – sender-specific parsers (UOB, OCBC, TADA, Grab, Shopee, Stripe,
   SIMBA, Coinhako). Amounts come only from regex, never from a model.
   Parsers may also return `ignore` with a reason (e.g. UOB "transfer is
   successful" confirmations, card reversals, statements).
4. **Unknown sender** – if it looks transactional (currency amount + money
   words), the AI step decides "is this a purchase?" and, if so, extracts
   fields. Any extracted amount must appear verbatim in the email or the item
   is flagged `needs_manual_amount`.
5. **Type rules** – spend / refund / investment / transfer / ignore.
6. **Dedupe** – merchant receipts (TADA, Grab, Shopee, Stripe) are merged with
   payment-rail alerts (UOB/OCBC PayNow, card alerts) of the same amount and
   currency within ±3 h; the receipt keeps the merchant, the rail adds the
   payment method.
7. **Categorise** – merchant memory (from the user's own edits) → keyword rules
   → AI pick from the user's category list → blank.
8. **Draft** – a `transactions` row with `status = 'pending'`. The user accepts,
   edits or rejects it. Edits update merchant memory.

## 4. Data model (Postgres)

- `profiles` – user settings (base currency, display name, role).
- `allowed_emails` – who may sign in (owner + invitees).
- `households`, `household_members` – owner (funder) + members, monthly budget.
- `categories` – per user, seeded with defaults.
- `ingest_keys` – hashed per-user keys for Apps Script.
- `script_heartbeats` – last run, counts, script version.
- `source_emails` – trimmed email text + processing status/reason.
- `transactions` – amount (positive), `kind`, currency, `fx_rate`,
  `base_amount` (null when no rate ⇒ shown as "—"), merchant, category,
  `status`, `allocation`, `claim_status`, `household_id`, `reimbursed_at`,
  `duplicate_of`, `client_ref` (idempotency), confidence, classifier.
- `shared_shares` – who owes what for shared spends, `settled_at`.
- `merchant_rules` – learned merchant → category / kind / allocation, `auto_accept`.
- `ai_usage` – every AI call: model, tokens, cost (USD).
- `app_settings` – `ai_enabled`, `ai_monthly_cap_usd`.
- `fx_rates` – cached daily rates.

Column names are currency-neutral (`base_amount`, never `*_sgd`). Migrations are
numbered in `supabase/migrations/`.

## 5. Security

- RLS on every table; users see only their own rows. Household members can read
  the household's transactions; reimbursement changes go through server routes
  that check membership.
- The Supabase **secret key** is used only in server code (ingest, cron,
  reimbursement); the browser uses the **publishable key** + user session.
- Ingest keys are random 32-byte tokens, stored as SHA-256 hashes, revocable.
- Cron routes require `CRON_SECRET`, compared in constant time.
- Server responses carry generic errors; details go to server logs only.
- Sign-in allowed only for emails in `allowed_emails`.

## 6. Cost control (single layer)

1. **OpenRouter prepaid balance**, auto top-up off ⇒ hard ceiling.
2. **Per-key monthly cap** on the production key.
3. **In-app guard**: each AI call is logged to `ai_usage`; when the month's
   total reaches `ai_monthly_cap_usd`, or `ai_enabled` is off, AI is skipped and
   emails go to review untagged. Costs page shows spend by model and user.
4. Vercel, Supabase and Apps Script stay on free plans (no card).

## 7. Known gaps / next

- Jev adapter: waiting for OpenRouter Jev API docs (the build session could not
  reach openrouter.ai). Haiku path works first.
- v2: personal budgets, recurring bills, income, safe-to-spend.
