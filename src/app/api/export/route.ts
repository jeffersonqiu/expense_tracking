import { userClient } from "@/lib/supabase/server";
import { monthRange } from "@/lib/server/context";

export const runtime = "nodejs";

function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the signed-in user's accepted transactions for one month (?m=YYYY-MM). */
export async function GET(req: Request) {
  const sb = await userClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new Response("Unauthorized", { status: 401 });
  const { ym, start, end } = monthRange(new URL(req.url).searchParams.get("m") ?? undefined);
  const { data } = await sb.from("transactions")
    .select("occurred_at, merchant, amount, currency, base_amount, base_currency, kind, allocation, claim_status, payment_method, description, categories(name)")
    .eq("user_id", auth.user.id).eq("status", "confirmed").gte("occurred_at", start).lt("occurred_at", end).order("occurred_at");
  const header = ["date", "merchant", "category", "kind", "allocation", "claim_status", "amount", "currency", "base_amount", "base_currency", "payment_method", "note"];
  const lines = (data ?? []).map((t) => [
    t.occurred_at, t.merchant, (t.categories as unknown as { name: string } | null)?.name, t.kind, t.allocation, t.claim_status,
    t.amount, t.currency, t.base_amount, t.base_currency, t.payment_method, t.description,
  ].map(csvCell).join(","));
  return new Response([header.join(","), ...lines].join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="expenses-${ym}.csv"` },
  });
}
