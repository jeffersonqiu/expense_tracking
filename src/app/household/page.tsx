import Link from "next/link";
import { getContext, monthRange, shiftMonth } from "@/lib/server/context";
import { householdMonth } from "@/lib/server/summary";
import { markReimbursed } from "../actions";
import { money, sgtDate } from "@/lib/format";
import { Nav } from "../Nav";

export const metadata = { title: "Household · Expense Tracker" };

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { db, uid, households, pendingCount } = await getContext();
  const hh = households[0];
  if (!hh) {
    return (
      <>
        <Nav pending={pendingCount} />
        <main className="wrap"><h1>Household</h1><div className="card">No household yet. <Link href="/settings">Create one in Settings</Link>.</div></main>
      </>
    );
  }
  const { ym, start, end } = monthRange(sp.m);
  const month = await householdMonth(db, hh.id, start, end);
  const [{ data: list }, { data: owed }, { data: members }] = await Promise.all([
    db.from("transactions").select("id, user_id, occurred_at, merchant, amount, currency, base_amount, kind, reimbursed_at")
      .eq("household_id", hh.id).eq("allocation", "household").eq("status", "confirmed")
      .gte("occurred_at", start).lt("occurred_at", end).order("occurred_at", { ascending: false }),
    db.from("transactions").select("id, user_id, occurred_at, merchant, base_amount, kind")
      .eq("household_id", hh.id).eq("allocation", "household").eq("status", "confirmed")
      .is("reimbursed_at", null).neq("user_id", hh.owner_id).order("occurred_at"),
    db.from("profiles").select("id, display_name, email"),
  ]);
  const name = (id: string) => (members ?? []).find((m) => m.id === id)?.display_name ?? "Member";
  const isOwner = hh.owner_id === uid;
  const owedTotal = (owed ?? []).reduce((s, r) => s + (r.kind === "refund" ? -1 : 1) * Number(r.base_amount ?? 0), 0);
  const left = hh.monthly_budget - month.spent;

  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>{hh.name} · {ym}</h1>
          <div className="row">
            <Link className="btn" href={`/household?m=${shiftMonth(ym, -1)}`}>←</Link>
            <Link className="btn" href={`/household?m=${shiftMonth(ym, 1)}`}>→</Link>
          </div>
        </div>
        <div className="grid">
          <div className="card stat"><div className="label">Spent</div><div className="value">{money(month.spent, hh.currency)}</div></div>
          <div className="card stat"><div className="label">Budget</div><div className="value">{money(hh.monthly_budget, hh.currency)}</div></div>
          <div className="card stat"><div className="label">{left >= 0 ? "Left" : "Over budget"}</div><div className={`value ${left < 0 ? "error" : ""}`}>{money(Math.abs(left), hh.currency)}</div></div>
        </div>

        <h2>{isOwner ? "To reimburse" : "Owed to you"} · {money(owedTotal, hh.currency)}</h2>
        <form action={markReimbursed} className="card table-wrap">
          <table>
            <thead><tr>{isOwner && <th></th>}<th>Date</th><th>Paid by</th><th>Merchant</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {(owed ?? []).map((r) => (
                <tr key={r.id}>
                  {isOwner && <td><input type="checkbox" name="id" value={r.id} style={{ width: "auto" }} /></td>}
                  <td>{sgtDate(r.occurred_at)}</td><td>{name(r.user_id)}</td><td>{r.merchant}</td>
                  <td className="num">{money((r.kind === "refund" ? -1 : 1) * Number(r.base_amount ?? 0), hh.currency)}</td>
                </tr>
              ))}
              {(owed ?? []).length === 0 && <tr><td colSpan={5} className="muted">Nothing outstanding.</td></tr>}
            </tbody>
          </table>
          {isOwner && (owed ?? []).length > 0 && <button className="btn primary" style={{ marginTop: 8 }}>Mark selected as reimbursed</button>}
        </form>

        <h2>This month</h2>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Paid by</th><th>Merchant</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {(list ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{sgtDate(r.occurred_at)}</td><td>{r.user_id === uid ? "You" : name(r.user_id)}</td>
                  <td>{r.user_id === uid ? <Link href={`/transactions/${r.id}`}>{r.merchant}</Link> : r.merchant}</td>
                  <td className="num">{money(r.kind === "refund" ? -Number(r.amount) : r.amount, r.currency)}</td>
                  <td className="small muted">{r.user_id !== hh.owner_id && (r.reimbursed_at ? "reimbursed" : "owed")}</td>
                </tr>
              ))}
              {(list ?? []).length === 0 && <tr><td colSpan={5} className="muted">No household spending this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
