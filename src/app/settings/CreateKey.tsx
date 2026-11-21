"use client";
import { useActionState } from "react";
import { createIngestKey } from "../actions";

export function CreateKey() {
  const [state, action, pending] = useActionState(createIngestKey, {} as { key?: string; error?: string });
  return (
    <form action={action} className="row">
      <input name="label" placeholder="Label, e.g. Jefferson Gmail" style={{ maxWidth: 260 }} />
      <button className="btn primary" disabled={pending}>Create key</button>
      {state.error && <span className="error">{state.error}</span>}
      {state.key && (
        <div className="warn" style={{ width: "100%" }}>
          Copy this key into the Apps Script <code>INGEST_KEY</code> property now. It won&apos;t be shown again:
          <div><code>{state.key}</code></div>
        </div>
      )}
    </form>
  );
}
