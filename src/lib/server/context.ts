import "server-only";
import { redirect } from "next/navigation";
import { userClient } from "../supabase/server";

export interface Category { id: string; name: string }
export interface Household { id: string; name: string; owner_id: string; monthly_budget: number; currency: string }

/** Everything most pages need about the signed-in user. Redirects to /login when signed out. */
export async function getContext() {
  const db = await userClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect("/login");
  const uid = auth.user.id;

  const [profile, categories, households, pending] = await Promise.all([
    db.from("profiles").select("id, email, display_name, base_currency, is_owner").eq("id", uid).single(),
    db.from("categories").select("id, name").eq("user_id", uid).order("sort_order"),
    db.from("households").select("id, name, owner_id, monthly_budget, currency"),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("status", "pending").is("duplicate_of", null),
  ]);

  return {
    db,
    uid,
    profile: profile.data as { id: string; email: string; display_name: string | null; base_currency: string; is_owner: boolean } | null,
    categories: (categories.data ?? []) as Category[],
    households: ((households.data ?? []) as Household[]).map((h) => ({ ...h, monthly_budget: Number(h.monthly_budget) })),
    pendingCount: pending.count ?? 0,
  };
}

/** [start, end) of a month in Singapore time, as ISO strings. `ym` = "2026-11". */
export function monthRange(ym?: string): { ym: string; start: string; end: string } {
  const now = new Date(Date.now() + 8 * 3600e3);
  const [y, m] = (ym && /^\d{4}-\d{2}$/.test(ym) ? ym : now.toISOString().slice(0, 7)).split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1, -8)).toISOString();
  const end = new Date(Date.UTC(y, m, 1, -8)).toISOString();
  return { ym: `${y}-${String(m).padStart(2, "0")}`, start, end };
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
