# Gmail connector (Google Apps Script)

Each person who uses the app installs this once in **their own** Google account.
It runs every 5 minutes, finds emails that might be transactions, and sends them
to the web app. The web app never gets access to your inbox.

## What you need first
- The app deployed on Vercel, e.g. `https://your-app.vercel.app`
- An **Apps Script key** from the app: sign in → **Settings → Gmail connector →
  Create key**. The key is shown once; copy it straight into step 3.

## Install (about 5 minutes)
1. Go to <https://script.google.com> → **New project**. Rename it
   "Expense Tracker connector" (click "Untitled project").
2. Delete the sample code in `Code.gs`, paste the whole of
   [`Code.gs`](./Code.gs) from this folder, and click **Save** (disk icon).
3. Left sidebar **Project Settings** (gear) → scroll to **Script properties** →
   **Add script property** twice:
   | Property | Value |
   |---|---|
   | `INGEST_URL` | `https://your-app.vercel.app/api/ingest` |
   | `INGEST_KEY` | the key from the app (starts with `et_`) |
   Click **Save script properties**.
4. Back in **Editor** (`< >` icon), pick `install` in the function dropdown at the
   top and click **Run**.
5. Google asks for permission:
   - **Review permissions** → choose your account.
   - "Google hasn't verified this app" → **Advanced** → **Go to Expense Tracker
     connector (unsafe)**. This warning appears because the script is your own,
     unpublished code.
   - Allow: *read your email* (Gmail read-only), *connect to an external
     service* (to send to your app), *run when you're not present* (the timer).
6. The execution log should finish without errors. In the app, **Settings →
   Gmail connector** now shows "Last seen: just now".

## Gmail label
From script v1.1.0, every email the app identifies as spending gets the Gmail
label **Expense Tracker**, so you can open that label in Gmail to see them all.
After updating the script, run **`labelPast`** once to label emails the app
already imported (if it says "Run labelPast again", run it again).

## Update the script
Open the project at script.google.com, replace all of `Code.gs` with the new
version, **Save**. Your script properties and timer stay as they are.

## Import past emails (optional)
In the editor, replace the function dropdown's choice with a one-off call:
open `Code.gs`, add at the bottom

```js
function importLastYear() { startBackfill(12); }
```

save, choose `importLastYear`, **Run**. The 5-minute sync then works through the
history a week at a time (a year takes roughly an hour). Everything imported
lands in your review queue.

## Check it is working
- `dryRun` lists what the script would scan from the last day (sends nothing).
- **Executions** (left sidebar, ▶ list icon) shows each 5-minute run.
- The app shows a warning if it hasn't heard from your script for 24 hours.

## How nothing gets missed
- The search is broad: known bank/merchant senders **plus** any email mentioning
  money or payment words (Promotions and Social tabs excluded).
- A **cursor** remembers the newest email the app has accepted. If a send fails,
  the cursor doesn't move, so the next run retries the same emails.
- Each run re-checks the last 15 minutes; the app ignores emails it already has.
- The app keeps a "possibly missed" list of emails it decided were not spending,
  so you can promote any it got wrong.

## Stop or remove
**Triggers** (clock icon) → delete the `sync` trigger, or delete the project.
Also revoke the key in the app's Settings.
