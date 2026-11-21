"use client";
import { browserClient } from "@/lib/supabase/browser";

export function LoginButton() {
  async function signIn() {
    await browserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <button className="btn primary" onClick={signIn}>
      Sign in with Google
    </button>
  );
}
