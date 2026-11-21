import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily FX from the free Frankfurter API (ECB reference rates, no key).
 * Cached in fx_rates. Returns null when no rate is available: the UI then
 * shows "—" instead of pretending 1:1.
 */
export async function fxRate(db: SupabaseClient, from: string, to: string, isoDate: string): Promise<number | null> {
  if (from === to) return 1;
  const day = isoDate.slice(0, 10);
  const cached = await db.from("fx_rates").select("rate").eq("rate_date", day).eq("base", from).eq("quote", to).maybeSingle();
  if (cached.data) return Number(cached.data.rate);
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${day}?base=${from}&symbols=${to}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { rates?: Record<string, number> };
    const rate = j.rates?.[to];
    if (typeof rate !== "number") return null;
    await db.from("fx_rates").upsert({ rate_date: day, base: from, quote: to, rate });
    return rate;
  } catch {
    return null;
  }
}

export function toBase(amount: number, rate: number | null): number | null {
  return rate == null ? null : Math.round(amount * rate * 100) / 100;
}
