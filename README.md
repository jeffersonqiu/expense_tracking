# Expense Tracker

Captures spending from Gmail (bank alerts, ride and shopping receipts), lets you
review every item, and tracks personal, work-claim, shared and household
spending. Runs entirely on free tiers: Vercel + Supabase + Google Apps Script,
with optional AI via OpenRouter under a hard monthly cap.

- **Setup:** [SETUP.md](SETUP.md)
- **Architecture and decisions:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Gmail connector:** [apps-script/README.md](apps-script/README.md)

```
src/lib/pipeline/   email parsers, filters, dedupe, categorisation (pure, tested)
src/lib/ai/         OpenRouter decider + budget guard (Jev adapter pending)
src/lib/server/     ingestion, FX, security helpers
src/app/            Next.js pages and API routes
supabase/migrations numbered SQL migrations with row-level security
apps-script/        Gmail connector that runs in each user's Google account
tests/              vitest suites + database tests
```
