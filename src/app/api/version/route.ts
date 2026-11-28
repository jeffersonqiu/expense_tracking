import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Which commit is live (short hash only), to confirm a deploy finished. */
export function GET() {
  return NextResponse.json({ commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7) });
}
