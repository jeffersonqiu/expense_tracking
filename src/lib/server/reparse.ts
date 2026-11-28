import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runParsers } from "../pipeline/parsers";
import { displayMerchant, merchantKey } from "../pipeline/categorize";
import { fxRate, toBase } from "./fx";
import { mergeWiseLegs } from "./wise";
import { ingestEmail } from "./ingest";

/**
 * Spends waiting in Review that the AI read (no dedicated reader at the time)
 * are re-read when a reader now exists for that sender, e.g. Wise. Fixes the
 * amount, merchant and kind, and folds in the bank leg of the same money.
 * Your allocation/category choices on the card are kept.
 * Runs with the service client; every query is scoped to `userId`.
 */
export async function reparsePending(db: SupabaseClient, userId: string, base: string): Promise<number> {
  const { data } = await db.from("transactions")
    .select("id, source_email_id, allocation, source_emails!inner(id, from_address, subject, received_at, body_text, parser, gmail_message_id)")
    .eq("user_id", userId).eq("status", "pending").is("duplicate_of", null)
    .is("source_emails.parser", null).limit(30);
  let fixed = 0;
  for (const row of data ?? []) {
    const e = row.source_emails as unknown as { id: string; from_address: string; subject: string; received_at: string; body_text: string; gmail_message_id: string };
    const r = runParsers({ messageId: e.gmail_message_id, from: e.from_address, subject: e.subject, date: e.received_at, labels: [], text: e.body_text });
    if (r.type !== "transaction" || r.txns.length !== 1) continue;
    const t = r.txns[0]!;
    const rate = await fxRate(db, t.currency, base, t.occurredAt);
    const key = merchantKey(t.merchantRaw);
    const { error } = await db.from("transactions").update({
      amount: t.amount, currency: t.currency, fx_rate: rate, base_currency: base, base_amount: toBase(t.amount, rate),
      kind: t.kind, merchant_raw: t.merchantRaw.slice(0, 200), merchant: displayMerchant(t.merchantRaw), merchant_key: key,
      counterparty_type: t.counterpartyType, payment_method: t.paymentMethod ?? null, source_role: t.role,
      description: t.description ?? null, needs_manual_amount: false,
      ...(t.kind === "card_payment" ? { status: "confirmed", reviewed_at: new Date().toISOString() } : {}),
    }).eq("id", row.id).eq("user_id", userId);
    if (error) {
      console.error("reparsePending", row.id, error);
      continue;
    }
    await db.from("source_emails").update({ parser: r.parser, status: "transaction", reason: null }).eq("id", e.id).eq("user_id", userId);
    fixed++;
    if (t.kind === "card_payment") {
      // The bank's "paid" alert and the card's "payment received" are the same payment.
      const at = new Date(t.occurredAt).getTime();
      const twin = await db.from("transactions").select("id")
        .eq("user_id", userId).eq("kind", "card_payment").eq("currency", t.currency).eq("amount", t.amount)
        .is("duplicate_of", null).neq("status", "rejected").neq("id", row.id)
        .gte("occurred_at", new Date(at - 3 * 3600e3).toISOString()).lte("occurred_at", new Date(at + 3 * 3600e3).toISOString())
        .limit(1).maybeSingle();
      if (twin.data) await db.from("transactions").update({ status: "rejected", duplicate_of: twin.data.id }).eq("id", row.id).eq("user_id", userId);
    }
  }

  // Wise emails the first version of the Wise reader wrongly skipped: read them again now.
  const skipped = await db.from("source_emails").select("id, gmail_message_id, gmail_thread_id, from_address, subject, received_at, body_text")
    .eq("user_id", userId).eq("parser", "wise").eq("status", "ignored").eq("reason", "not a transfer receipt")
    .gte("received_at", new Date(Date.now() - 14 * 86400e3).toISOString()).limit(20);
  for (const e of skipped.data ?? []) {
    const email = { messageId: e.gmail_message_id, threadId: e.gmail_thread_id ?? undefined, from: e.from_address, subject: e.subject, date: e.received_at, labels: [], text: e.body_text };
    if (runParsers(email).type !== "transaction") continue;
    await db.from("source_emails").delete().eq("id", e.id).eq("user_id", userId);
    const r = await ingestEmail(db, userId, email, null).catch((err) => { console.error("re-ingest wise", err); return null; });
    if (r?.status === "transaction") fixed++;
  }

  // Fold Wise transfers and their bank top-ups that are both still around (new or just re-read).
  const wiseRows = await db.from("transactions").select("id")
    .eq("user_id", userId).eq("status", "pending").is("duplicate_of", null).ilike("merchant_key", "%wise%").limit(40);
  for (const w of wiseRows.data ?? []) if (await mergeWiseLegs(db, userId, w.id)) fixed++;
  return fixed;
}
