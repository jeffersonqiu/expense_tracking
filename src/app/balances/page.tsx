import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { setClaimStatus, settleShare } from "../actions";
import { money, sgtDate } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { Flash } from "../Flash";

export const metadata = { title: "Balances · Expenses" };

type ShareTx = { id: string; merchant: string | null; occurred_at: string; currency: string; status: string };

export default async function BalancesPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, pendingCount } = await getContext();
  const [{ data: claims }, { data: shares }] = await Promise.all([
    db.from("transactions").select("id, occurred_at, merchant, amount, currency, claim_status, description")
      .eq("user_id", uid).eq("allocation", "work").eq("status", "confirmed").neq("claim_status", "reimbursed").order("occurred_at"),
    db.from("shared_shares").select("id, person_name, amount, settled_at, transactions!inner(id, merchant, occurred_at, currency, status)")
      .eq("user_id", uid).is("settled_at", null).order("created_at"),
  ]);
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
    <Shell active="balances" pending={pendingCount}>
      <Header title="Balances" sub="Money that's coming back to you" />
      <Flash error={flash.error} ok={flash.ok} />

      <div className="section-label">Work claims</div>
      <form action={setClaimStatus}>
        <div className="list">
          {(claims ?? []).length === 0 && <div className="row empty">No open claims.</div>}
          {(claims ?? []).map((c) => (
            <label className="row" key={c.id} style={{ cursor: "pointer" }}>
              <input type="checkbox" name="id" value={c.id} style={{ width: 20, height: 20, accentColor: "var(--tint)" }} />
              <div className="main">
                <div className="title"><Link href={`/transactions/${c.id}`} style={{ color: "inherit" }}>{c.merchant}</Link></div>
                <div className="subtitle">{sgtDate(c.occurred_at)}{c.description ? ` · ${c.description}` : ""}</div>
              </div>
              <span className={`pill ${c.claim_status === "submitted" ? "tint" : ""}`}>{c.claim_status === "to_claim" ? "To claim" : "Submitted"}</span>
              <div className="trail num">{money(c.amount, c.currency)}</div>
            </label>
          ))}
        </div>
        {(claims ?? []).length > 0 && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn" name="status" value="submitted">Mark submitted</button>
            <button className="btn primary" name="status" value="reimbursed">Mark reimbursed</button>
          </div>
        )}
      </form>

      <div className="section-label">People who owe you</div>
      {people.size === 0 && <div className="list"><div className="row empty">Nobody owes you anything.</div></div>}
      {[...people.entries()].map(([person, p]) => (
        <div key={person} style={{ marginBottom: 12 }}>
          <div className="list">
            <div className="row">
              <div className="avatar tint">{person.charAt(0).toUpperCase()}</div>
              <div className="main"><div className="title">{person}</div></div>
              <div className="trail num" style={{ fontWeight: 600 }}>{[...p.total.entries()].map(([cur, v]) => money(v, cur)).join(" + ")}</div>
            </div>
            {p.rows.map((s) => {
              const tx = s.transactions as unknown as ShareTx;
              return (
                <div className="row" key={s.id}>
                  <div className="main">
                    <div className="title" style={{ fontWeight: 400 }}>{tx.merchant}</div>
                    <div className="subtitle">{sgtDate(tx.occurred_at)}</div>
                  </div>
                  <div className="trail num">{money(s.amount, tx.currency)}</div>
                  <form action={settleShare} className="inline"><input type="hidden" name="id" value={s.id} /><button className="btn plain small">Paid back</button></form>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Shell>
  );
}
