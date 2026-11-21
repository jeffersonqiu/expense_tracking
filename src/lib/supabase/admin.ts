import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/** Server-only client using the secret key. Bypasses RLS: always scope queries by user_id. */
export function adminClient() {
  return createClient(env.supabaseUrl(), env.secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
