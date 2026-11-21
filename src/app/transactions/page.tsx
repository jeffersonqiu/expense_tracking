import Link from "next/link";
import { getContext, monthRange, shiftMonth } from "@/lib/server/context";
import { Nav } from "../Nav";
import { TxnForm } from "../TxnForm";
import { quickAdd } from "../actions";
import { money, sgtDate } from "@/lib/format";

export const metadata = { title: "Transactions · Expense Tracker" };

const ALLOC: Record<string, string> = { personal: "Personal", work: "Work", shared: "Shared", household: "Household" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ m?: string; status?: string }> }) {
  const sp = await searchParams;
  const { db, uid, categories, households, pendingCount } = await getContext();
  const { ym, start, end } = monthRange(sp.m);
  const status = sp.status === "rejected" ? "rejected" : "confirmed";
  const { data } = await db.from("transactions")
    .select("id, occurred_at, amount, currency, base_amount, base_currency, kind, merchant, category_id, allocation, payment_method, status")
    .eq("user_id", uid).eq("status", status).gte("occurred_at", start).lt("occurred_at", end)
    .order("occurred_at", { ascending: false }).limit(1000);
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>Transactions · {ym}</h1>
          <div className="row">
            <Link className="btn" href={`/transactions?m=${shiftMonth(ym, -1)}`}>←</Link>
            <Link className="btn" href={`/transactions?m=${shiftMonth(ym, 1)}`}>→</Link>
            <a className="btn" href={`/api/export?m=${ym}`}>Export CSV</a>
          </div>
        </div>
        <form action={quickAdd} className="card row">
          <input name="text" placeholder='Quick add, e.g. "lunch 12.50" or "kopi 2"' required style={{ flex: 1, minWidth: 200 }} />
          <select name="payment" defaultValue="Cash" style={{ width: "auto" }}>
            <option>Cash</option><option>GrabPay</option><option>Card</option><option>PayNow</option>
          </select>
          <button className="btn primary">Add</button>
        </form>
        <details className="card">
          <summary>Add with full details</summary>
          <TxnForm txn={null} categories={categories} households={households} returnTo="/transactions" mode="new" />
        </details>
        <p className="small">
          <Link href={`/transactions?m=${ym}`}>Accepted</Link> · <Link href={`/transactions?m=${ym}&status=rejected`}>Rejected</Link>
        </p>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Allocation</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {(data ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{sgtDate(t.occurred_at)}</td>
                  <td><Link href={`/transactions/${t.id}`}>{t.merchant ?? "—"}</Link><div className="small muted">{t.payment_method}</div></td>
                  <td>{t.kind !== "spend" ? <span className="pill">{t.kind}</span> : cat.get(t.category_id) ?? "—"}</td>
                  <td>{ALLOC[t.allocation]}</td>
                  <td className="num">
                    {money(t.kind === "refund" ? -Number(t.amount) : t.amount, t.currency)}
                    {t.currency !== t.base_currency && <div className="small muted">{money(t.base_amount, t.base_currency)}</div>}
                  </td>
                </tr>
              ))}
              {(data ?? []).length === 0 && <tr><td colSpan={5} className="muted">Nothing this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
