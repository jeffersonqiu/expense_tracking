import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runParsers } from "../pipeline/parsers";
import { displayMerchant, merchantKey } from "../pipeline/categorize";
import { findDuplicate, type ExistingTxn } from "../pipeline/dedupe";
import { fxRate, toBase } from "./fx";

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
    }).eq("id", row.id).eq("user_id", userId);
    if (error) {
      console.error("reparsePending", row.id, error);
      continue;
    }
    await db.from("source_emails").update({ parser: r.parser, status: "transaction", reason: null }).eq("id", e.id).eq("user_id", userId);
    fixed++;

    // The bank alert for the same money (e.g. UOB PayNow to Wise) is now a duplicate of this receipt.
    if (t.role === "receipt") {
      const at = new Date(t.occurredAt).getTime();
      const near = await db.from("transactions")
        .select("id, occurred_at, amount, currency, source_role, merchant_key, status, payment_method")
        .eq("user_id", userId).is("duplicate_of", null).neq("id", row.id)
        .gte("occurred_at", new Date(at - 3 * 3600e3).toISOString()).lte("occurred_at", new Date(at + 3 * 3600e3).toISOString());
      const cands: ExistingTxn[] = (near.data ?? []).map((x) => ({
        id: x.id, occurredAt: x.occurred_at, amount: Number(x.amount), currency: x.currency,
        role: x.source_role === "receipt" ? "receipt" : "rail", merchantKey: x.merchant_key ?? "", status: x.status,
      }));
      const dup = findDuplicate({ occurredAt: t.occurredAt, amount: t.amount, currency: t.currency, role: "receipt", merchantKey: key }, cands);
      if (dup.action === "existing_is_duplicate") {
        await db.from("transactions").update({ status: "rejected", duplicate_of: row.id }).eq("id", dup.id).eq("user_id", userId);
      } else if (dup.action === "candidate_is_duplicate") {
        // You already accepted the bank leg: keep yours, drop this copy.
        await db.from("transactions").update({ status: "rejected", duplicate_of: dup.of }).eq("id", row.id).eq("user_id", userId);
      }
    }
  }
  return fixed;
}
