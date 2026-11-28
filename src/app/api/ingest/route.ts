import { NextResponse } from "next/server";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";
import { bearer, sha256 } from "@/lib/server/security";
import { ingestEmail, makeDecider, type IngestResult } from "@/lib/server/ingest";
import { knowledgeFor } from "@/lib/server/knowledge";

export const runtime = "nodejs";
export const maxDuration = 60;

const Email = z.object({
  messageId: z.string().min(1).max(100),
  threadId: z.string().max(100).optional(),
  from: z.string().max(500),
  subject: z.string().max(1000),
  date: z.string().datetime({ offset: true }),
  labels: z.array(z.string().max(100)).max(50).default([]),
  text: z.string().max(60_000),
});

const Body = z.object({
  scriptVersion: z.string().max(40).optional(),
  scanned: z.number().int().min(0).max(100_000).optional(),
  error: z.string().max(500).optional(),
  emails: z.array(Email).max(15).default([]),
});

/** Called by the Apps Script in each user's Google account. */
export async function POST(req: Request) {
  const key = bearer(req);
  if (!key) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = adminClient();
  const k = await db.from("ingest_keys").select("id, user_id").eq("key_hash", sha256(key)).is("revoked_at", null).maybeSingle();
  if (!k.data) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = k.data.user_id as string;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  await Promise.all([
    db.from("ingest_keys").update({ last_used_at: now }).eq("id", k.data.id),
    db.from("script_heartbeats").upsert({
      user_id: userId, last_seen_at: now, scanned: body.scanned ?? 0, sent: body.emails.length,
      script_version: body.scriptVersion ?? null, last_error: body.error ?? null,
    }),
  ]);

  const ai = body.emails.length ? await makeDecider(db, userId) : null;
  const knowledge = ai ? await knowledgeFor(db, userId) : undefined;
  const results: IngestResult[] = [];
  for (const email of body.emails) {
    try {
      results.push(await ingestEmail(db, userId, email, ai, knowledge));
    } catch (err) {
      console.error("ingest failed", email.messageId, err);
      results.push({ messageId: email.messageId, status: "error" });
    }
  }
  // The script labels only messages we accepted, so errors are retried next run.
  return NextResponse.json({
    accepted: results.filter((r) => r.status !== "error").map((r) => r.messageId),
    results,
  });
}
