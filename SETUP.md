# Setup guide

Everything here stays on free plans. Never paste keys into chat or commit them;
they go only into the Supabase, Vercel, OpenRouter and Apps Script dashboards.

## 1. Supabase (database + login)
1. Create a project in **Southeast Asia (Singapore)**. Save the database password
   in a password manager.
2. **Settings → API Keys** (main tab, not "Legacy"): note the **publishable key**
   (`sb_publishable_…`) and **secret key** (`sb_secret_…`, server only).
3. **SQL Editor → New query**: paste the whole of
   `supabase/migrations/0001_init.sql`, click **Run**. It should say "Success".
   Repeat for every later file in `supabase/migrations/` in number order
   (`0002_…`, `0003_…`), each in its own query.
4. New query, run (with your own Gmail address):
   ```sql
   insert into public.allowed_emails (email) values ('you@gmail.com');
   ```
   The first person to sign in becomes the owner.

## 2. Google sign-in
1. <https://console.cloud.google.com> → project `expense-tracker` →
   **Google Auth Platform**.
2. Branding: app name `Expense Tracker`, your support email. Audience:
   **External**, then **Publish app** (status "In production").
3. **Clients → Create client** → *Web application* → Authorized redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback` → Create. Save the Client
   ID and secret.
4. Supabase → **Authentication → Sign In / Providers → Google**: enable, paste
   the Client ID and secret, Save.

## 3. OpenRouter (AI, single cost-control layer)
1. Add **US$5** credits, **auto top-up off**.
2. Privacy settings: turn off prompt/output logging and provider training.
3. Create key `expense-prod` with credit limit **$1, monthly reset**.

## 4. Vercel (web app)
1. **Add New → Project** → import `jeffersonqiu/expense_tracking` (Hobby plan,
   no card). Framework: Next.js (auto-detected).
2. **Environment Variables** (all environments):
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
   | `SUPABASE_SECRET_KEY` | `sb_secret_…` |
   | `OPENROUTER_API_KEY` | the `expense-prod` key |
   | `CRON_SECRET` | a long random string (password-manager generator, 32+ chars) |
3. **Deploy**. Note the URL, e.g. `https://expense-tracking-xyz.vercel.app`.
4. If the deploy happened before the variables were added: **Deployments → … →
   Redeploy**.

## 5. Connect Supabase to the deployed URL
Supabase → **Authentication → URL Configuration**:
- **Site URL**: your Vercel URL
- **Redirect URLs**: add `https://<your-vercel-url>/auth/callback`

## 6. First sign-in
Open the Vercel URL → **Sign in with Google**. You land on the dashboard.
Then **Settings**:
- **Household**: create it (budget 800).
- **Gmail connector → Create key**: copy the `et_…` key for the next step.

## 7. Gmail connector
Follow [`apps-script/README.md`](apps-script/README.md). Afterwards Settings shows
"Last seen: just now". Optionally run the 12-month history import.

## 8. Invite your spouse
1. Settings → **Who can sign in** → enter their Gmail, keep **Add to household**
   ticked → **Invite**.
2. They sign in with Google and join the household automatically.
3. They create their own connector key and install the Apps Script in their
   own Google account.

## Day to day
- **Review**: accept/edit/reject each captured spend; choose allocation
  (Personal, Work claim, Shared, Household).
- **Household**: budget vs spend; tick spends your spouse paid and "Mark
  reimbursed" once you've paid them back.
- **Balances**: open work claims and who owes you.
- **Settings → Merchant rules**: switch on auto-accept per merchant when you're
  ready.

## Developing locally
```bash
npm install
cp .env.example .env.local   # fill in secret values
npm run dev
npm test          # parser/pipeline tests
npm run test:db   # migrations + row-level security on a local Postgres 16
```
