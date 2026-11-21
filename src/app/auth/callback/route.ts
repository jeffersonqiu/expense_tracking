import { NextResponse } from "next/server";
import { userClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) {
    return NextResponse.redirect(new URL("/login?error=1", url.origin));
  }
  const sb = await userClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=1", url.origin));
  return NextResponse.redirect(new URL("/", url.origin));
}
