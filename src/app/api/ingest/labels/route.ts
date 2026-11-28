import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase/admin";
import { bearer, sha256 } from "@/lib/server/security";

export const runtime = "nodejs";

/**
 * For the Apps Script's one-off labelPast(): Gmail thread ids of emails the app
 * identified as transactions, a page at a time.
 */
export async function POST(req: Request) {
  const key = bearer(req);
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = adminClient();
  const k = await db.from("ingest_keys").select("user_id").eq("key_hash", sha256(key)).is("revoked_at", null).maybeSingle();
  if (!k.data) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let offset = 0;
  try {
    const body = (await req.json()) as { offset?: number };
    offset = Math.max(0, Math.min(1_000_000, Math.floor(Number(body.offset) || 0)));
  } catch {
    // empty body = first page
  }
  const PAGE = 500;
  const { data, error } = await db.from("source_emails")
    .select("gmail_thread_id")
    .eq("user_id", k.data.user_id).eq("status", "transaction").not("gmail_thread_id", "is", null)
    .order("received_at").range(offset, offset + PAGE - 1);
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  const threads = [...new Set((data ?? []).map((r) => r.gmail_thread_id as string))];
  return NextResponse.json({ threads, next: (data ?? []).length === PAGE ? offset + PAGE : null });
}
