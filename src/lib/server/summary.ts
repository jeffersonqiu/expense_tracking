import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spendValue } from "../format";

export interface SummaryRow {
  id: string;
  user_id: string;
  amount: number | string;
  fx_rate: number | string | null;
  base_amount: number | string | null;
  kind: string;
  allocation: string;
  category_id: string | null;
  household_id: string | null;
  reimbursed_at: string | null;
  shared_shares?: { amount: number | string; settled_at: string | null }[];
}

/** Your share of a row in base currency (shared: total minus what others owe you). */
export function myShare(r: SummaryRow): number {
  const total = spendValue(r.kind, r.base_amount == null ? null : Number(r.base_amount));
  if (r.allocation !== "shared" || !r.shared_shares?.length) return total;
  const rate = r.fx_rate == null ? 0 : Number(r.fx_rate);
  const others = r.shared_shares.reduce((s, x) => s + Number(x.amount), 0) * rate;
  return Math.max(0, total - others);
}

export async function personalMonth(db: SupabaseClient, uid: string, start: string, end: string) {
  const { data } = await db.from("transactions")
    .select("id, user_id, amount, fx_rate, base_amount, kind, allocation, category_id, household_id, reimbursed_at, shared_shares(amount, settled_at)")
    .eq("user_id", uid).eq("status", "confirmed").in("allocation", ["personal", "shared"])
    .gte("occurred_at", start).lt("occurred_at", end);
  const rows = (data ?? []) as SummaryRow[];
  const byCategory = new Map<string | null, number>();
  let total = 0;
  let investments = 0;
  for (const r of rows) {
    if (r.kind === "investment") investments += Number(r.base_amount ?? 0);
    const v = myShare(r);
    total += v;
    if (v !== 0) byCategory.set(r.category_id, (byCategory.get(r.category_id) ?? 0) + v);
  }
  return { total, investments, byCategory, count: rows.length };
}

export async function householdMonth(db: SupabaseClient, householdId: string, start: string, end: string) {
  const { data } = await db.from("transactions")
    .select("id, user_id, amount, fx_rate, base_amount, kind, allocation, category_id, household_id, reimbursed_at")
    .eq("household_id", householdId).eq("status", "confirmed").eq("allocation", "household")
    .gte("occurred_at", start).lt("occurred_at", end);
  const rows = (data ?? []) as SummaryRow[];
  return { spent: rows.reduce((s, r) => s + spendValue(r.kind, r.base_amount == null ? null : Number(r.base_amount)), 0), rows };
}
