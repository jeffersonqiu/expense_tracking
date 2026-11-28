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

/** Personal spending for a period. Trips are excluded, and so is Giving (it has its own budget). */
export async function personalMonth(db: SupabaseClient, uid: string, start: string, end: string, givingCategoryId?: string | null) {
  const { data } = await db.from("transactions")
    .select("id, user_id, amount, fx_rate, base_amount, kind, allocation, category_id, household_id, reimbursed_at, shared_shares(amount, settled_at)")
    .eq("user_id", uid).eq("status", "confirmed").in("allocation", ["personal", "shared"]).is("trip_id", null)
    .gte("occurred_at", start).lt("occurred_at", end);
  const rows = ((data ?? []) as SummaryRow[]).filter((r) => !givingCategoryId || r.category_id !== givingCategoryId);
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
    .or("household_pot.is.null,household_pot.eq.allowance")
    .gte("occurred_at", start).lt("occurred_at", end);
  const rows = (data ?? []) as SummaryRow[];
  return { spent: rows.reduce((s, r) => s + spendValue(r.kind, r.base_amount == null ? null : Number(r.base_amount)), 0), rows };
}

export interface BillLine { merchant: string; amount: number; usual: number | null; unusual: boolean; ids: string[] }

/**
 * Bills pot for a month, grouped by merchant, with each merchant's usual amount
 * (average of the previous 3 months) so unusually high bills can be flagged.
 */
export async function billsMonth(db: SupabaseClient, householdId: string, start: string, end: string, historyStart: string) {
  const { data } = await db.from("transactions")
    .select("id, merchant, merchant_key, base_amount, kind, occurred_at")
    .eq("household_id", householdId).eq("status", "confirmed").eq("allocation", "household").eq("household_pot", "bills")
    .gte("occurred_at", historyStart).lt("occurred_at", end);
  const rows = data ?? [];
  const thisMonth = rows.filter((r) => r.occurred_at >= start);
  const before = rows.filter((r) => r.occurred_at < start);
  const val = (r: { kind: string; base_amount: number | string | null }) => spendValue(r.kind, r.base_amount == null ? null : Number(r.base_amount));

  const lines = new Map<string, BillLine>();
  for (const r of thisMonth) {
    const key = r.merchant_key ?? r.merchant ?? "?";
    const l = lines.get(key) ?? { merchant: r.merchant ?? "—", amount: 0, usual: null, unusual: false, ids: [] as string[] };
    l.amount += val(r);
    l.ids.push(r.id);
    lines.set(key, l);
  }
  for (const [key, l] of lines) {
    const past = before.filter((r) => (r.merchant_key ?? r.merchant ?? "?") === key);
    if (past.length) {
      const months = new Set(past.map((r) => r.occurred_at.slice(0, 7))).size;
      l.usual = past.reduce((s2, r) => s2 + val(r), 0) / Math.max(1, months);
      l.unusual = l.usual > 0 && l.amount > l.usual * 1.3 && l.amount - l.usual > 10;
    }
  }
  const prevMonthStart = new Date(new Date(start).getTime() - 1).toISOString().slice(0, 7);
  const lastMonthTotal = before.filter((r) => toSgtMonth(r.occurred_at) === prevMonthStart).reduce((s2, r) => s2 + val(r), 0);
  const total = [...lines.values()].reduce((s2, l) => s2 + l.amount, 0);
  return { total, lastMonthTotal, lines: [...lines.values()].sort((a, b) => b.amount - a.amount) };
}

function toSgtMonth(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 7);
}

/** All-time spend per project (projects don't reset monthly). */
export async function projectTotals(db: SupabaseClient, householdId: string) {
  const { data } = await db.from("transactions")
    .select("project_id, base_amount, kind")
    .eq("household_id", householdId).eq("status", "confirmed").eq("household_pot", "project").not("project_id", "is", null);
  const totals = new Map<string, number>();
  for (const r of data ?? []) totals.set(r.project_id as string, (totals.get(r.project_id as string) ?? 0) + spendValue(r.kind, r.base_amount == null ? null : Number(r.base_amount)));
  return totals;
}

export interface GivingRow { id: string; occurred_at: string; merchant: string | null; amount: number | string; currency: string; base_amount: number | string | null; kind: string; allocation: string; fx_rate: number | string | null; shared_shares?: { amount: number | string; settled_at: string | null }[] }

/** Giving (allowance to family, gifts, donations) in a period: everyday spends filed under Giving. */
export async function givingPeriod(db: SupabaseClient, uid: string, categoryId: string | null | undefined, start: string, end: string) {
  if (!categoryId) return { total: 0, rows: [] as GivingRow[] };
  const { data } = await db.from("transactions")
    .select("id, user_id, occurred_at, merchant, amount, currency, base_amount, fx_rate, kind, allocation, category_id, household_id, reimbursed_at, shared_shares(amount, settled_at)")
    .eq("user_id", uid).eq("status", "confirmed").eq("category_id", categoryId).in("allocation", ["personal", "shared"]).is("trip_id", null)
    .gte("occurred_at", start).lt("occurred_at", end).order("occurred_at", { ascending: false });
  const rows = (data ?? []) as (GivingRow & SummaryRow)[];
  return { total: rows.reduce((s, r) => s + myShare(r), 0), rows };
}
