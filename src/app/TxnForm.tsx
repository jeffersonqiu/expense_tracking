import { saveTransaction } from "./actions";
import { toLocalInput } from "@/lib/format";
import type { Category, Household } from "@/lib/server/context";

export interface TxnRow {
  id: string;
  occurred_at: string;
  amount: number | string;
  currency: string;
  kind: string;
  merchant: string | null;
  merchant_raw: string | null;
  category_id: string | null;
  allocation: string;
  claim_status: string | null;
  household_id: string | null;
  description: string | null;
  payment_method: string | null;
  needs_manual_amount: boolean;
  confidence: number | string | null;
  classifier: string | null;
  counterparty_type: string | null;
  status: string;
  source_emails?: { subject: string; from_address: string; body_text: string } | null;
  shared_shares?: { person_name: string; amount: number | string; settled_at: string | null }[];
}

/** One editable transaction: used by the review queue, transaction detail and manual add. */
export function TxnForm({
  txn, categories, households, returnTo, mode,
}: {
  txn: TxnRow | null;
  categories: Category[];
  households: Household[];
  returnTo: string;
  mode: "review" | "edit" | "new";
}) {
  const shares = (txn?.shared_shares ?? []).filter((s) => !s.settled_at).map((s) => `${s.person_name}: ${s.amount}`).join("\n");
  const hint = txn?.counterparty_type === "individual" ? "Paid to a person: switch Type to Transfer if this wasn't a purchase." : null;
  return (
    <form action={saveTransaction} className="card">
      <input type="hidden" name="id" value={txn?.id ?? ""} />
      <input type="hidden" name="return_to" value={returnTo} />
      {txn && (
        <div className="row small muted" style={{ marginBottom: 8 }}>
          <span>{txn.payment_method ?? "—"}</span>
          {txn.classifier && <span className="pill">{txn.classifier}{txn.confidence != null ? ` · ${Math.round(Number(txn.confidence) * 100)}%` : ""}</span>}
          {txn.needs_manual_amount && <span className="pill error">check amount</span>}
        </div>
      )}
      {hint && <p className="small muted" style={{ marginTop: 0 }}>{hint}</p>}
      <div className="fields">
        <label>Merchant<input name="merchant" defaultValue={txn?.merchant ?? ""} required /></label>
        <label>Amount<input name="amount" type="number" step="0.01" min="0" defaultValue={txn ? Number(txn.amount) : ""} required /></label>
        <label>Currency<input name="currency" defaultValue={txn?.currency ?? "SGD"} pattern="[A-Z]{3}" maxLength={3} required /></label>
        <label>Date & time<input name="occurred_at" type="datetime-local" defaultValue={toLocalInput(txn?.occurred_at ?? new Date().toISOString())} required /></label>
        <label>Type
          <select name="kind" defaultValue={txn?.kind ?? "spend"}>
            <option value="spend">Spend</option>
            <option value="refund">Refund</option>
            <option value="investment">Investment</option>
            <option value="transfer">Transfer (not spending)</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label>Category
          <select name="category_id" defaultValue={txn?.category_id ?? ""}>
            <option value="">— choose —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Allocation
          <select name="allocation" defaultValue={txn?.allocation ?? "personal"}>
            <option value="personal">Personal</option>
            <option value="work">Work claim</option>
            <option value="shared">Shared, I paid first</option>
            <option value="household">Household</option>
          </select>
        </label>
        <label>Claim status (work)
          <select name="claim_status" defaultValue={txn?.claim_status ?? "to_claim"}>
            <option value="to_claim">To claim</option>
            <option value="submitted">Submitted</option>
            <option value="reimbursed">Reimbursed</option>
          </select>
        </label>
        <label>Household
          <select name="household_id" defaultValue={txn?.household_id ?? households[0]?.id ?? ""}>
            <option value="">—</option>
            {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </label>
      </div>
      <div className="fields" style={{ marginTop: 10 }}>
        <label>Note<input name="description" defaultValue={txn?.description ?? ""} maxLength={500} /></label>
        <label>Shared: who owes you (one per line, "Name: amount")
          <textarea name="shares" rows={2} defaultValue={shares} placeholder="Alex: 12.50" />
        </label>
      </div>
      {txn?.source_emails && (
        <details style={{ marginTop: 8 }}>
          <summary>Email: {txn.source_emails.subject}</summary>
          <p className="small muted">{txn.source_emails.from_address}</p>
          <pre className="email">{txn.source_emails.body_text.slice(0, 3000)}</pre>
        </details>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {mode === "review" ? (
          <>
            <button className="btn primary" name="decision" value="accept">Accept</button>
            <button className="btn danger" name="decision" value="reject" formNoValidate>Reject</button>
            <label className="check small"><input type="checkbox" name="remember" defaultChecked /> Remember for this merchant</label>
            <label className="check small"><input type="checkbox" name="auto_accept" /> Auto-accept next time</label>
          </>
        ) : mode === "new" ? (
          <button className="btn primary" name="decision" value="accept">Add</button>
        ) : (
          <>
            <button className="btn primary" name="decision" value={txn?.status === "pending" ? "accept" : "save"}>Save</button>
            {txn?.status !== "rejected" && <button className="btn danger" name="decision" value="reject" formNoValidate>Reject</button>}
          </>
        )}
      </div>
    </form>
  );
}
