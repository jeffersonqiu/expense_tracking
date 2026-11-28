import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Trip } from "./context";
import { myShare, type SummaryRow } from "./summary";

export interface TripTotals {
  daily: number;
  transport: number;
  hotels: number;
  unsplit: number;
  total: number;
  /** Work spends on the trip: claimable, not counted in what the trip cost you. */
  claimable: number;
  tracked: number; // number of spends tracked in the app
}

const zero = (): TripTotals => ({ daily: 0, transport: 0, hotels: 0, unsplit: 0, total: 0, claimable: 0, tracked: 0 });

/** Per-trip totals: imported baselines + accepted spends tagged with the trip. */
export async function tripTotals(db: SupabaseClient, trips: Trip[]): Promise<Map<string, TripTotals>> {
  const out = new Map<string, TripTotals>();
  for (const t of trips) {
    out.set(t.id, {
      ...zero(),
      daily: t.baseline_daily, transport: t.baseline_transport, hotels: t.baseline_hotels, unsplit: t.baseline_unsplit,
    });
  }
  if (trips.length) {
    const { data } = await db.from("transactions")
      .select("id, user_id, trip_id, trip_bucket, amount, fx_rate, base_amount, kind, allocation, category_id, household_id, reimbursed_at, shared_shares(amount, settled_at)")
      .in("trip_id", trips.map((t) => t.id)).eq("status", "confirmed");
    for (const r of (data ?? []) as (SummaryRow & { trip_id: string; trip_bucket: string })[]) {
      const tt = out.get(r.trip_id);
      if (!tt) continue;
      tt.tracked++;
      if (r.allocation === "work") {
        tt.claimable += Number(r.base_amount ?? 0) * (r.kind === "refund" ? -1 : 1);
        continue;
      }
      const v = myShare(r);
      if (r.trip_bucket === "transport") tt.transport += v;
      else if (r.trip_bucket === "hotels") tt.hotels += v;
      else tt.daily += v;
    }
  }
  for (const tt of out.values()) tt.total = tt.daily + tt.transport + tt.hotels + tt.unsplit;
  return out;
}

export function sumTotals(list: TripTotals[]): TripTotals {
  return list.reduce((a, b) => ({
    daily: a.daily + b.daily, transport: a.transport + b.transport, hotels: a.hotels + b.hotels,
    unsplit: a.unsplit + b.unsplit, total: a.total + b.total, claimable: a.claimable + b.claimable, tracked: a.tracked + b.tracked,
  }), zero());
}

export function tripDates(t: Trip): string {
  const f = (d: string, withYear: boolean) => new Intl.DateTimeFormat("en-SG", {
    day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  }).format(new Date(d + "T00:00:00Z"));
  if (!t.end_date) return new Intl.DateTimeFormat("en-SG", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(t.start_date + "T00:00:00Z"));
  return `${f(t.start_date, false)} – ${f(t.end_date, true)}`;
}

/** Parse pasted rows (from the Travel Collation sheet or the prepared import file). */
export interface ImportRow { name: string; start: string; daily: number; transport: number; hotels: number; unsplit: number; links: string | null; remarks: string | null }

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

export function parseTripRows(text: string): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/\t| \| /).map((c) => c.trim());
    const mi = cells.findIndex((c) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{4}$/i.test(c));
    if (mi < 0) continue;
    const [mon, yr] = cells[mi]!.split(" ");
    const start = `${yr}-${MONTHS[mon!.slice(0, 3).toLowerCase()]}-01`;
    const rest = cells.slice(mi + 1).filter((c) => !/^\d{4}$/.test(c)); // drop the sheet's separate "Year" column
    const name = rest.find((c) => c && !/^(sgd|s\$|\$)?\s?[\d,]+(\.\d+)?$/i.test(c) && !/^https?:/i.test(c) && !/^(sgd|s\$|\$)\s?[\d,.]*$/i.test(c));
    if (!name) continue;
    const money = rest.slice(rest.indexOf(name) + 1)
      .filter((c) => /^(sgd|s\$|\$)?\s?-?[\d,]*(\.\d+)?$/i.test(c) && /\d/.test(c))
      .map((c) => Number(c.replace(/sgd|s\$|\$|,|\s/gi, "")) || 0);
    const [daily = 0, transport = 0, hotels = 0, total] = money;
    const sum = daily + transport + hotels;
    const links = rest.filter((c) => /^https?:\/\//i.test(c)).join("\n") || null;
    rows.push({
      name: name.slice(0, 80), start, daily, transport, hotels,
      unsplit: total != null && total - sum > 0.01 ? Math.round((total - sum) * 100) / 100 : 0,
      links, remarks: null,
    });
  }
  return rows;
}
