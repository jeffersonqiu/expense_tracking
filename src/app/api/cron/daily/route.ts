import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { bearer, constantTimeEqual } from "@/lib/server/security";
import { env } from "@/lib/env";
import { fxRate, toBase } from "@/lib/server/fx";
import { learnDue } from "@/lib/server/learn";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Daily job (Vercel cron): keeps the free Supabase project active and fills in
 * exchange rates that were unavailable when a transaction arrived.
 */
export async function GET(req: Request) {
  const token = bearer(req);
  if (!token || !constantTimeEqual(token, env.cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = adminClient();
  const missing = await db.from("transactions")
    .select("id, amount, currency, base_currency, occurred_at")
    .is("base_amount", null).neq("status", "rejected").limit(200);
  let filled = 0;
  for (const t of missing.data ?? []) {
    const rate = await fxRate(db, t.currency, t.base_currency, t.occurred_at);
    if (rate == null) continue;
    await db.from("transactions").update({ fx_rate: rate, base_amount: toBase(Number(t.amount), rate) }).eq("id", t.id);
    filled++;
  }
  // Weekly learning: one due user per day (each user ends up learning about once a week).
  let learned = "skipped";
  try {
    learned = await learnDue(db);
  } catch (err) {
    console.error("learnDue", err);
  }
  return NextResponse.json({ ok: true, fxFilled: filled, learned });
}
