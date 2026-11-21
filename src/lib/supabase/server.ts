import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "../env";

/** Per-request client acting as the signed-in user (RLS applies). */
export async function userClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.publishableKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by middleware instead.
        }
      },
    },
  });
}

/** Returns the signed-in user or null. */
export async function currentUser() {
  const sb = await userClient();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
