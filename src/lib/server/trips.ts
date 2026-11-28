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

export function tripDates(t: Pick<Trip, "start_date" | "end_date">): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-SG", { ...o, timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const s = t.start_date, e = t.end_date;
  if (!e || e === s) return fmt(s, { day: "numeric", month: "short", year: "numeric" });
  if (s.slice(0, 7) === e.slice(0, 7)) return `${fmt(s, { day: "numeric" })} – ${fmt(e, { day: "numeric", month: "short", year: "numeric" })}`;
  if (s.slice(0, 4) === e.slice(0, 4)) return `${fmt(s, { day: "numeric", month: "short" })} – ${fmt(e, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${fmt(s, { day: "numeric", month: "short", year: "numeric" })} – ${fmt(e, { day: "numeric", month: "short", year: "numeric" })}`;
}

export type TripPhase = "now" | "upcoming" | "past";

/** Today's date in Singapore, "YYYY-MM-DD". */
export function sgtToday(): string {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

/** A trip without an end date counts as a single day. */
export function tripPhase(t: Pick<Trip, "start_date" | "end_date">, today = sgtToday()): TripPhase {
  const end = t.end_date ?? t.start_date;
  if (t.start_date > today) return "upcoming";
  return end >= today ? "now" : "past";
}

const DAY = 86400e3;
const day = (d: string) => new Date(d + "T00:00:00Z").getTime();

/** Length in days, counting both ends ("12–24 Dec" = 13 days). */
export function tripDays(t: Pick<Trip, "start_date" | "end_date">): number | null {
  return t.end_date ? Math.round((day(t.end_date) - day(t.start_date)) / DAY) + 1 : null;
}

/** Short status line: "13 days · in 2 weeks", "Day 3 of 8", "5 days". */
export function tripTiming(t: Pick<Trip, "start_date" | "end_date">, today = sgtToday()): string {
  const len = tripDays(t);
  const lenText = len == null ? "end date not set" : `${len} ${len === 1 ? "day" : "days"}`;
  const phase = tripPhase(t, today);
  if (phase === "now" && len) return `Day ${Math.round((day(today) - day(t.start_date)) / DAY) + 1} of ${len}`;
  if (phase === "upcoming") {
    const n = Math.round((day(t.start_date) - day(today)) / DAY);
    const when = n === 1 ? "tomorrow" : n < 14 ? `in ${n} days` : n < 60 ? `in ${Math.round(n / 7)} weeks` : `in ${Math.round(n / 30)} months`;
    return `${lenText} · ${when}`;
  }
  return lenText;
}

/** Now first, then upcoming soonest-first, then past most-recent-first. */
export function sortTrips<T extends Pick<Trip, "start_date" | "end_date">>(trips: T[], today = sgtToday()): Record<TripPhase, T[]> {
  const out: Record<TripPhase, T[]> = { now: [], upcoming: [], past: [] };
  for (const t of trips) out[tripPhase(t, today)].push(t);
  out.now.sort((a, b) => a.start_date.localeCompare(b.start_date));
  out.upcoming.sort((a, b) => a.start_date.localeCompare(b.start_date));
  out.past.sort((a, b) => (b.end_date ?? b.start_date).localeCompare(a.end_date ?? a.start_date));
  return out;
}
