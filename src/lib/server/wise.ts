import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { awaitingTopUp, isWiseTopUp, isWiseTransfer, pickTopUp, pickTransfer, type Leg } from "../pipeline/wise";

const COLS = "id, occurred_at, amount, currency, fx_rate, base_currency, base_amount, merchant_key, merchant_raw, merchant, payment_method, description, status, duplicate_of";
type Row = { id: string; occurred_at: string; amount: number | string; currency: string; fx_rate: number | string | null; base_currency: string; base_amount: number | string | null; merchant_key: string | null; merchant_raw: string | null; merchant: string | null; payment_method: string | null; description: string | null; status: Leg["status"]; duplicate_of: string | null };
const leg = (r: Row): Leg => ({
  id: r.id, occurredAt: r.occurred_at, amount: Number(r.amount), currency: r.currency, merchantKey: r.merchant_key ?? "",
  merchantRaw: r.merchant_raw ?? r.merchant ?? "", paymentMethod: r.payment_method, status: r.status, duplicateOf: r.duplicate_of,
});

/**
 * Fold the bank top-up and the Wise transfer email into one spend: who received
 * it and what arrived (from Wise), what left your bank (from the bank alert).
 * Your decisions win: if you already accepted one side, the other joins it.
 * Every query is scoped to `userId`.
 */
export async function mergeWiseLegs(db: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const self = (await db.from("transactions").select(COLS).eq("id", id).eq("user_id", userId).maybeSingle()).data as Row | null;
  if (!self || self.duplicate_of || self.status === "rejected") return false;
  const me = leg(self);
  if (!isWiseTransfer(me) && !isWiseTopUp(me)) return false;
  const at = new Date(self.occurred_at).getTime();
  const { data } = await db.from("transactions").select(COLS).eq("user_id", userId).is("duplicate_of", null).neq("status", "rejected")
    .gte("occurred_at", new Date(at - 3600e3).toISOString()).lte("occurred_at", new Date(at + 3600e3).toISOString());
  const rows = (data ?? []) as Row[];
  const legs = rows.map(leg);

  let transfer: Row | undefined;
  let topUp: Row | undefined;
  if (isWiseTransfer(me)) {
    if (!awaitingTopUp(me)) return false;
    const t = pickTopUp(me, legs);
    transfer = self;
    topUp = t ? rows.find((r) => r.id === t.id) : undefined;
  } else {
    const tr = pickTransfer(me, legs);
    topUp = self;
    transfer = tr ? rows.find((r) => r.id === tr.id) : undefined;
  }
  if (!transfer || !topUp) return false;
  if (transfer.status === "confirmed" && topUp.status === "confirmed") return false; // both already reviewed by you

  const paid = {
    amount: topUp.amount, currency: topUp.currency, fx_rate: topUp.fx_rate, base_currency: topUp.base_currency,
    base_amount: topUp.base_amount, needs_manual_amount: false,
  };
  const via = `${topUp.payment_method ?? "Bank"} → Wise`;
  if (topUp.status === "confirmed") {
    // You accepted the bank alert: it stays, and learns who received the money.
    await db.from("transactions").update({
      merchant_raw: transfer.merchant_raw, merchant: transfer.merchant, merchant_key: transfer.merchant_key,
      description: transfer.description, payment_method: via,
    }).eq("id", topUp.id).eq("user_id", userId);
    await db.from("transactions").update({ status: "rejected", duplicate_of: topUp.id }).eq("id", transfer.id).eq("user_id", userId);
  } else {
    await db.from("transactions").update({ ...paid, payment_method: via }).eq("id", transfer.id).eq("user_id", userId);
    await db.from("transactions").update({ status: "rejected", duplicate_of: transfer.id }).eq("id", topUp.id).eq("user_id", userId);
  }
  return true;
}
