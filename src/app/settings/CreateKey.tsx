"use client";
import { useActionState } from "react";
import { createIngestKey } from "../actions";

export function CreateKey() {
  const [state, action, pending] = useActionState(createIngestKey, {} as { key?: string; error?: string });
  return (
    <form action={action} style={{ display: "flex", flexWrap: "wrap", gap: 8, width: "100%" }}>
      <input name="label" placeholder="Connector name, e.g. My Gmail" aria-label="Connector name" style={{ flex: "1 1 180px" }} />
      <button className="btn primary" disabled={pending}>{pending ? "Creating…" : "Create key"}</button>
      {state.error && <div className="small bad" style={{ flexBasis: "100%" }}>{state.error}</div>}
      {state.key && (
        <div style={{ flexBasis: "100%", marginTop: 4 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>Shown once. Paste into Apps Script <strong>INGEST_KEY</strong>.</div>
          <div className="key" style={{ display: "block", padding: 10, userSelect: "all" }}>{state.key}</div>
        </div>
      )}
    </form>
  );
}
