import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { setClaimStatus, settleShare } from "../actions";
import { money, sgtDate } from "@/lib/format";
import { Flash } from "@/app/Flash";
import { Nav } from "../Nav";

export const metadata = { title: "Balances · Expense Tracker" };

export default async function BalancesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, pendingCount } = await getContext();
  const [{ data: claims }, { data: shares }] = await Promise.all([
    db.from("transactions").select("id, occurred_at, merchant, amount, currency, claim_status, description")
      .eq("user_id", uid).eq("allocation", "work").eq("status", "confirmed").neq("claim_status", "reimbursed").order("occurred_at"),
    db.from("shared_shares").select("id, person_name, amount, settled_at, transactions!inner(id, merchant, occurred_at, currency, status)")
      .eq("user_id", uid).is("settled_at", null).order("created_at"),
  ]);
  type ShareTx = { id: string; merchant: string | null; occurred_at: string; currency: string; status: string };
  type ShareRow = NonNullable<typeof shares>[number];
  const people = new Map<string, { total: Map<string, number>; rows: ShareRow[] }>();
  for (const s of shares ?? []) {
    const tx = s.transactions as unknown as ShareTx;
    if (tx.status !== "confirmed") continue;
    const p = people.get(s.person_name) ?? { total: new Map<string, number>(), rows: [] as ShareRow[] };
    p.total.set(tx.currency, (p.total.get(tx.currency) ?? 0) + Number(s.amount));
    p.rows.push(s);
    people.set(s.person_name, p);
  }
  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <Flash error={flash.error} ok={flash.ok} />
        <h1>Balances</h1>
        <h2>Work claims</h2>
        <form action={setClaimStatus} className="card table-wrap">
          <table>
            <thead><tr><th></th><th>Date</th><th>Merchant</th><th>Status</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {(claims ?? []).map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" name="id" value={c.id} style={{ width: "auto" }} /></td>
                  <td>{sgtDate(c.occurred_at)}</td>
                  <td><Link href={`/transactions/${c.id}`}>{c.merchant}</Link><div className="small muted">{c.description}</div></td>
                  <td><span className="pill">{c.claim_status === "to_claim" ? "to claim" : c.claim_status}</span></td>
                  <td className="num">{money(c.amount, c.currency)}</td>
                </tr>
              ))}
              {(claims ?? []).length === 0 && <tr><td colSpan={5} className="muted">No open claims.</td></tr>}
            </tbody>
          </table>
          {(claims ?? []).length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" name="status" value="submitted">Mark submitted</button>
              <button className="btn primary" name="status" value="reimbursed">Mark reimbursed</button>
            </div>
          )}
        </form>

        <h2>People who owe you</h2>
        {people.size === 0 && <div className="card muted">Nobody owes you anything.</div>}
        {[...people.entries()].map(([person, p]) => (
          <div className="card" key={person}>
            <strong>{person}</strong> · {[...p.total.entries()].map(([cur, v]) => money(v, cur)).join(" + ")}
            <table style={{ marginTop: 6 }}>
              <tbody>
                {p.rows.map((s) => {
                  const tx = s.transactions as unknown as ShareTx;
                  return (
                    <tr key={s.id}>
                      <td>{sgtDate(tx.occurred_at)}</td><td>{tx.merchant}</td>
                      <td className="num">{money(s.amount, tx.currency)}</td>
                      <td className="num"><form action={settleShare} className="inline"><input type="hidden" name="id" value={s.id} /><button className="btn link small">Paid back</button></form></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </main>
    </>
  );
}
