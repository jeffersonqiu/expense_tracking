import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/server/security";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = await userClient();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
