/**
 * Expense Tracker – Gmail connector (Google Apps Script).
 *
 * Runs inside YOUR Google account. Every 5 minutes it searches Gmail for emails
 * that might be transactions and sends them to your Expense Tracker web app,
 * which decides what is spending. Your inbox access never leaves Google.
 *
 * Setup: see apps-script/README.md. In short:
 *   1. Paste this file into a new project at script.google.com
 *   2. Project Settings → Script properties: INGEST_URL and INGEST_KEY
 *   3. Run `install` once and approve the permissions
 */

var SCRIPT_VERSION = '1.0.0';
var BATCH_SIZE = 10;               // emails per request (keeps each request well under Vercel's 60 s limit)
var MAX_RUN_MS = 4.5 * 60 * 1000;  // stay under Apps Script's 6-minute limit
var OVERLAP_SEC = 15 * 60;         // re-check the last 15 min each run (server ignores repeats)
var BODY_CHARS = 20000;

// Broad on purpose: missing a transaction is worse than sending an extra email.
// Known senders always match; others must mention money or payment words.
var SEARCH =
  '-in:chats -in:spam -in:trash -category:promotions -category:social ' +
  '{from:uobgroup.com from:ocbc.com from:dbs.com from:posb.com.sg from:citibank.com.sg ' +
  'from:hsbc.com.sg from:sc.com from:maybank.com from:trustbank.sg from:gxs.com.sg ' +
  'from:tada.global from:grab.com from:gojek.com from:shopee.sg from:lazada.sg ' +
  'from:stripe.com from:paypal.com from:simba.sg from:coinhako.com from:apple.com ' +
  'receipt payment paid charged invoice transaction transfer refund refunded order ' +
  'SGD "S$" "US$"}';

/** Run once: creates the 5-minute timer and does a first sync. */
function install() {
  props_();  // fail fast if properties are missing
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(5).create();
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('CURSOR')) {
    p.setProperty('CURSOR', String(Math.floor(Date.now() / 1000) - 2 * 86400)); // start 2 days back
  }
  sync();
}

/**
 * Optional: import history. Example: startBackfill(12) imports the last 12 months,
 * a few weeks at a time, alongside the normal 5-minute sync.
 */
function startBackfill(months) {
  var now = Math.floor(Date.now() / 1000);
  var p = PropertiesService.getScriptProperties();
  p.setProperty('BACKFILL_FROM', String(now - (months || 12) * 31 * 86400));
  p.setProperty('BACKFILL_UNTIL', p.getProperty('CURSOR') || String(now));
}

/** Main job, run by the timer. */
function sync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // previous run still going
  var started = Date.now();
  try {
    var p = PropertiesService.getScriptProperties();
    var cursor = Number(p.getProperty('CURSOR') || 0);
    var res = sendRange_(cursor - OVERLAP_SEC, null, started);
    if (res.ok && res.maxDate) p.setProperty('CURSOR', String(Math.max(cursor, res.maxDate)));

    // Backfill in the remaining time, oldest first, one week per step.
    var from = Number(p.getProperty('BACKFILL_FROM') || 0);
    var until = Number(p.getProperty('BACKFILL_UNTIL') || 0);
    while (from && from < until && Date.now() - started < MAX_RUN_MS) {
      var to = Math.min(from + 7 * 86400, until);
      var b = sendRange_(from, to, started);
      if (!b.ok) break;
      from = to;
      p.setProperty('BACKFILL_FROM', String(from));
    }
    if (from && from >= until) {
      p.deleteProperty('BACKFILL_FROM');
      p.deleteProperty('BACKFILL_UNTIL');
    }
  } catch (e) {
    post_({ scriptVersion: SCRIPT_VERSION, scanned: 0, error: String(e).slice(0, 400), emails: [] });
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Sends every matching message received in [after, before). */
function sendRange_(after, before, started) {
  var q = SEARCH + ' after:' + Math.floor(after) + (before ? ' before:' + Math.floor(before) : '');
  var batch = [];
  var scanned = 0;
  var maxDate = 0;
  var ok = true;
  var start = 0;
  while (Date.now() - started < MAX_RUN_MS) {
    var threads = GmailApp.search(q, start, 50);
    if (!threads.length) break;
    for (var i = 0; i < threads.length; i++) {
      var msgs = threads[i].getMessages();
      for (var j = 0; j < msgs.length; j++) {
        var m = msgs[j];
        var ts = Math.floor(m.getDate().getTime() / 1000);
        if (ts < after || (before && ts >= before)) continue;
        scanned++;
        batch.push(toPayload_(m, threads[i]));
        if (batch.length >= BATCH_SIZE) {
          var r = flush_(batch, scanned);
          if (!r.ok) return { ok: false, maxDate: maxDate };
          maxDate = Math.max(maxDate, r.maxDate);
          batch = [];
        }
      }
    }
    start += threads.length;
  }
  var last = flush_(batch, scanned);
  ok = last.ok;
  maxDate = Math.max(maxDate, last.maxDate);
  return { ok: ok, maxDate: maxDate };
}

function toPayload_(m, thread) {
  var labels = thread.getLabels().map(function (l) { return l.getName(); });
  if (m.isInInbox()) labels.push('INBOX');
  return {
    messageId: m.getId(),
    threadId: thread.getId(),
    from: m.getFrom(),
    subject: m.getSubject() || '',
    date: m.getDate().toISOString(),
    labels: labels,
    text: (m.getPlainBody() || '').slice(0, BODY_CHARS),
  };
}

/** Posts a batch (also acts as the heartbeat). Only accepted messages advance the cursor. */
function flush_(batch, scanned) {
  var res = post_({ scriptVersion: SCRIPT_VERSION, scanned: scanned, emails: batch });
  if (!res) return { ok: false, maxDate: 0 };
  var accepted = {};
  (res.accepted || []).forEach(function (id) { accepted[id] = true; });
  var maxDate = 0;
  for (var i = 0; i < batch.length; i++) {
    if (!accepted[batch[i].messageId]) return { ok: false, maxDate: maxDate }; // retry next run
    maxDate = Math.max(maxDate, Math.floor(new Date(batch[i].date).getTime() / 1000));
  }
  return { ok: true, maxDate: maxDate };
}

function post_(payload) {
  var cfg = props_();
  var resp = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    console.warn('Expense Tracker returned ' + code + ': ' + resp.getContentText().slice(0, 200));
    return null;
  }
  return JSON.parse(resp.getContentText());
}

function props_() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('INGEST_URL');
  var key = p.getProperty('INGEST_KEY');
  if (!url || !key) throw new Error('Set INGEST_URL and INGEST_KEY in Project Settings → Script properties.');
  return { url: url, key: key };
}

/** Manual check: sends nothing, just reports what would be scanned in the last day. */
function dryRun() {
  var q = SEARCH + ' newer_than:1d';
  var threads = GmailApp.search(q, 0, 50);
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) { console.log(m.getDate() + ' | ' + m.getFrom() + ' | ' + m.getSubject()); });
  });
}
