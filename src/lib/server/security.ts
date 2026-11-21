import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** New Apps Script key: shown once to the user, only the hash is stored. */
export function newIngestKey(): { key: string; hash: string; prefix: string } {
  const key = "et_" + randomBytes(32).toString("base64url");
  return { key, hash: sha256(key), prefix: key.slice(0, 9) };
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(sha256(a));
  const bb = Buffer.from(sha256(b));
  return timingSafeEqual(ab, bb);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(h);
  return m ? m[1]!.trim() : null;
}

/** Reject cross-site form/fetch posts to cookie-authenticated routes. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin navigations may omit it
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
