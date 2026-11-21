"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

export function LoginButton() {
  const [busy, setBusy] = useState(false);
  async function signIn() {
    setBusy(true);
    await browserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }
  return (
    <button className="btn primary large" onClick={signIn} disabled={busy}>
      {busy ? "Opening Google…" : "Continue with Google"}
    </button>
  );
}
