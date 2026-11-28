import { saveTransaction } from "./actions";
import { DateRange } from "./ui/DateRange";
import { Segmented } from "./ui/Segmented";
import { isHouseholdUtility } from "@/lib/pipeline/categorize";
import { money, sgtDateTime, toLocalInput } from "@/lib/format";
import { tripDates } from "@/lib/server/trips";
import { defaultPot, type Category, type Household, type Project, type Trip } from "@/lib/server/context";

export interface TxnRow {
  id: string;
  occurred_at: string;
  amount: number | string;
  currency: string;
  base_amount?: number | string | null;
  base_currency?: string;
  kind: string;
  merchant: string | null;
  merchant_raw: string | null;
  category_id: string | null;
  allocation: string;
  claim_status: string | null;
  household_id: string | null;
  household_pot?: string | null;
  giving_kind?: string | null;
  trip_id?: string | null;
  trip_bucket?: string | null;
  suggestion?: unknown;
  project_id?: string | null;
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

const ALLOCATIONS = [
  { value: "personal", label: "Personal" },
  { value: "work", label: "Work" },
  { value: "trip", label: "Trip" },
  { value: "household", label: "Household" },
  { value: "giving", label: "Giving" },
];

const sgtDay = (iso?: string) => new Date(new Date(iso ?? Date.now()).getTime() + 8 * 3600e3).toISOString().slice(0, 10);

/** Trips covering the spend's date first, then the closest by date (bookings happen before a trip). */
function tripOptions(trips: Trip[], occurredAt?: string, selected?: string | null): Trip[] {
  const d = sgtDay(occurredAt);
  const t = new Date(d).getTime();
  const gap = (x: Trip) => {
    const s = new Date(x.start_date).getTime(), e = new Date(x.end_date ?? x.start_date).getTime();
    return t < s ? s - t : t > e ? t - e : 0;
  };
  const near = [...trips].sort((a, b) => gap(a) - gap(b) || a.start_date.localeCompare(b.start_date)).slice(0, 12);
  const sel = selected ? trips.find((x) => x.id === selected) : undefined;
  return sel && !near.includes(sel) ? [sel, ...near] : near;
}

function suggestionSource(classifier: string | null, confidence: number | null): string {
  if (classifier === "memory") return "From your past choice";
  if (confidence != null && confidence < 50 && (classifier === "jev" || classifier === "haiku")) return `Not sure · ${confidence}%`;
  if (classifier === "rules") return "Suggested by keyword";
  if (classifier === "jev" || classifier === "haiku") {
    return `Suggested by ${classifier === "jev" ? "Jev" : "AI"}${confidence != null ? ` · ${confidence}%` : ""}`;
  }
  return "Suggested";
}

/** One captured spend: review card, edit form, or manual entry. */
export function TxnForm({
  txn, categories, households, projects = [], trips = [], returnTo, mode,
}: {
  txn: TxnRow | null;
  categories: Category[];
  households: Household[];
  projects?: Project[];
  trips?: Trip[];
  returnTo: string;
  mode: "review" | "edit" | "new";
}) {
  const personHint = txn?.counterparty_type === "individual";
  const amountSigned = txn ? (txn.kind === "refund" ? -Number(txn.amount) : Number(txn.amount)) : 0;
  const showConv = txn && txn.base_currency && txn.currency !== txn.base_currency;
  const confidence = txn?.confidence != null ? Math.round(Number(txn.confidence) * 100) : null;
  const openProjects = projects.filter((p) => p.status === "open");
  const catName = categories.find((c) => c.id === txn?.category_id)?.name;
  // A utility that arrived as Personal (nothing remembered yet) is suggested as a household bill.
  const utilityHint = !!txn && txn.status === "pending" && txn.allocation === "personal" && !txn.suggestion
    && households.length > 0 && isHouseholdUtility(txn.merchant_raw ?? txn.merchant ?? "");
  // "Shared" is retired: old shared spends show as Personal (their shares are kept in Balances).
  const allocation = utilityHint ? "household" : txn?.allocation === "shared" ? "personal" : txn?.allocation ?? "personal";
  const pot = utilityHint ? "bills" : txn?.household_pot ?? defaultPot(catName, openProjects.length > 0);

  return (
    <form action={saveTransaction} className="review">
      <input type="hidden" name="id" value={txn?.id ?? ""} />
      <input type="hidden" name="return_to" value={returnTo} />

      {txn && (
        <div className="top">
          <div style={{ minWidth: 0 }}>
            <div className="merchant">{txn.merchant ?? txn.merchant_raw ?? "Unknown merchant"}</div>
            <div className="meta">
              <span>{sgtDateTime(txn.occurred_at)}</span>
              {txn.payment_method && <span>{txn.payment_method}</span>}
              {txn.kind === "refund" && <span className="pill good">Refund</span>}
              {txn.kind === "investment" && <span className="pill tint">Investment</span>}
              {txn.needs_manual_amount && <span className="pill warn">Check amount</span>}
              {personHint && <span className="pill">Paid to a person</span>}
            </div>
          </div>
          <div className="amount">
            <span className={amountSigned < 0 ? "good" : undefined}>{money(amountSigned, txn.currency)}</span>
            {showConv && <span className="conv">{money(txn.base_amount ?? null, txn.base_currency)}</span>}
          </div>
        </div>
      )}

      <div className="block">
        <div className="lbl">Allocation</div>
        <div className="seg-five"><Segmented name="allocation" value={allocation} options={ALLOCATIONS} /></div>
        {utilityHint && <div className="small faint" style={{ marginTop: 6 }}>Looks like a household utility bill</div>}
      </div>

      <div className="block when-work">
        <div className="lbl">Claim status</div>
        <Segmented name="claim_status" value={txn?.claim_status ?? "to_claim"} options={[
          { value: "to_claim", label: "To claim" }, { value: "submitted", label: "Submitted" }, { value: "reimbursed", label: "Reimbursed" },
        ]} />
      </div>
      <div className="block when-giving">
        <div className="lbl">Giving</div>
        <Segmented name="giving_kind" value={txn?.giving_kind ?? "adhoc"} options={[
          { value: "parents", label: "Parents" }, { value: "regular", label: "Regular" }, { value: "adhoc", label: "Ad hoc" },
        ]} />
        <div className="small faint" style={{ marginTop: 6 }}>Counts toward your Giving budget, not personal spending</div>
      </div>
      <div className="block when-household">
        {households.length > 1 && (
          <label className="field" style={{ marginBottom: 12 }}><span>Household</span>
            <select name="household_id" defaultValue={txn?.household_id ?? households[0]?.id ?? ""}>
              {households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        )}
        {households.length === 1 && <input type="hidden" name="household_id" value={households[0]!.id} />}
        {households.length === 0 && <div className="small bad">Create a household in Settings first.</div>}
        <div className="lbl">Household pot</div>
        <Segmented name="household_pot" value={pot} options={[
          { value: "allowance", label: "Allowance" }, { value: "bills", label: "Bills" }, { value: "project", label: "Project" },
        ]} />
        <div className="when-project" style={{ marginTop: 12 }}>
          <label className="field"><span>Project</span>
            <select name="project_id" defaultValue={txn?.project_id ?? openProjects[0]?.id ?? "__new"}>
              {openProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="__new">+ New project…</option>
            </select>
          </label>
          <input name="new_project_name" placeholder="New project name, e.g. Renovation 2026" maxLength={80} className="when-newproject" style={{ marginTop: 8 }} aria-label="New project name" />
        </div>
      </div>
      <div className="block when-trip-alloc">
        <label className="field"><span>Trip</span>
          <select name="trip_id" defaultValue={txn?.trip_id ?? ""}>
            <option value="">{trips.length ? "Choose a trip…" : "No trips yet"}</option>
            {tripOptions(trips, txn?.occurred_at, txn?.trip_id).map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {tripDates(t)}{t.kind === "business" ? " · Business" : ""}</option>
            ))}
            <option value="__new">+ New trip…</option>
          </select>
        </label>
        <div className="when-newtrip" style={{ marginTop: 8 }}>
          <input name="new_trip_name" placeholder="Trip name, e.g. Italy" maxLength={80} aria-label="New trip name" />
          <div className="when-trip-only" style={{ marginTop: 8 }}>
            <Segmented name="new_trip_kind" value="personal" options={[{ value: "personal", label: "Personal trip" }, { value: "business", label: "Business trip" }]} />
          </div>
          <div style={{ marginTop: 8 }}>
            <DateRange startName="new_trip_start" endName="new_trip_end" near={sgtDay(txn?.occurred_at)} />
          </div>
        </div>
        <div className="when-trip" style={{ marginTop: 10 }}>
          <Segmented name="trip_bucket" value={txn?.trip_bucket ?? "daily"} options={[
            { value: "daily", label: "Daily" }, { value: "transport", label: "Transport" }, { value: "hotels", label: "Hotels" },
          ]} />
        </div>
        <div className="small faint when-work-only" style={{ marginTop: 6 }}>Optional: tag the business trip. A trip with work spends counts as a business trip.</div>
      </div>

      <div className="block">
        <div className="lbl" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span>Category</span>
          {mode === "review" && txn?.category_id && <span className="faint">{suggestionSource(txn.classifier, confidence)}</span>}
        </div>
        <div className="chips">
          {categories.map((c) => (
            <label key={c.id}>
              <input type="radio" name="category_id" value={c.id} defaultChecked={txn?.category_id === c.id} />
              <span>{c.name}</span>
            </label>
          ))}
        </div>
      </div>

      <details open={mode !== "review" || !!txn?.needs_manual_amount}>
        <summary>{mode === "new" ? "Details" : "More details"}</summary>
        <div className="fields">
          <label className="field"><span>Merchant</span><input name="merchant" defaultValue={txn?.merchant ?? ""} required /></label>
          <label className="field"><span>Amount</span><input name="amount" type="number" inputMode="decimal" step="0.01" min="0" defaultValue={txn ? Number(txn.amount) : ""} required /></label>
          <label className="field"><span>Currency</span><input name="currency" defaultValue={txn?.currency ?? "SGD"} pattern="[A-Z]{3}" maxLength={3} required /></label>
          <label className="field"><span>Date and time</span><input name="occurred_at" type="datetime-local" defaultValue={toLocalInput(txn?.occurred_at ?? new Date().toISOString())} required /></label>
          <label className="field"><span>Type</span>
            <select name="kind" defaultValue={txn?.kind ?? "spend"}>
              <option value="spend">Spend</option>
              <option value="refund">Refund</option>
              <option value="investment">Investment</option>
              <option value="transfer">Transfer (not spending)</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label className="field"><span>Note</span><input name="description" defaultValue={txn?.description ?? ""} maxLength={500} /></label>
        </div>
        {txn?.source_emails && (
          <details style={{ marginTop: 12 }}>
            <summary>Show original email</summary>
            <div className="small muted">{txn.source_emails.from_address} · {txn.source_emails.subject}</div>
            <pre className="email">{txn.source_emails.body_text.slice(0, 3000)}</pre>
          </details>
        )}
      </details>

      <div className="actions">
        {mode === "review" ? (
          <>
            <div className="opts small faint">Every decision teaches the app</div>
            <div className="go">
              <button className="btn destructive" name="decision" value="reject" formNoValidate>Reject</button>
              <button className="btn primary" name="decision" value="accept">Accept</button>
            </div>
          </>
        ) : mode === "new" ? (
          <div className="go"><button className="btn primary" name="decision" value="accept">Add expense</button></div>
        ) : (
          <>
            <span className="small faint">{txn?.classifier ? `Captured by ${txn.classifier}${confidence != null ? ` · ${confidence}% confident` : ""}` : ""}</span>
            <div className="go">
              {txn?.status !== "rejected" && <button className="btn destructive" name="decision" value="reject" formNoValidate>Reject</button>}
              <button className="btn primary" name="decision" value={txn?.status === "pending" ? "accept" : "save"}>Save</button>
            </div>
          </>
        )}
      </div>
    </form>
  );
}
