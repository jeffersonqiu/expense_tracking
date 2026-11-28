"use client";

import { useEffect, useState } from "react";
import { undoReview } from "../actions";

/**
 * Floating message above the tab bar that fades out by itself, so success
 * messages never push content down. Optional Undo for review decisions.
 */
export function Toast({ message, undoId, ms = 6000 }: { message: string; undoId?: string; ms?: number }) {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    // Drop ?ok= / ?done= from the address so a refresh doesn't show it again.
    const url = new URL(window.location.href);
    ["ok", "done"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : ""));
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [ms]);

  return (
    <div className={`toast ${shown ? "" : "gone"}`} role="status" aria-live="polite">
      <span className="toast-msg">{message}</span>
      {undoId && (
        <form action={undoReview}>
          <input type="hidden" name="id" value={undoId} />
          <button className="toast-undo">Undo</button>
        </form>
      )}
    </div>
  );
}
