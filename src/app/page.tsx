import Link from "next/link";
import { getContext, monthRange, shiftMonth } from "@/lib/server/context";
import { householdMonth, personalMonth } from "@/lib/server/summary";
import { money } from "@/lib/format";
import { Nav } from "./Nav";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { db, uid, profile, categories, households, pendingCount } = await getContext();
  const base = profile?.base_currency ?? "SGD";
  const { ym, start, end } = monthRange(sp.m);
  const hh = households[0];

  const [personal, household, heartbeat, claims, shares, owed] = await Promise.all([
    personalMonth(db, uid, start, end),
    hh ? householdMonth(db, hh.id, start, end) : Promise.resolve(null),
    db.from("script_heartbeats").select("last_seen_at, last_error").eq("user_id", uid).maybeSingle(),
    db.from("transactions").select("base_amount").eq("user_id", uid).eq("allocation", "work").eq("status", "confirmed").in("claim_status", ["to_claim", "submitted"]),
    db.from("shared_shares").select("amount, transactions!inner(fx_rate, status)").eq("user_id", uid).is("settled_at", null),
    hh ? db.from("transactions").select("base_amount, kind, user_id").eq("household_id", hh.id).eq("allocation", "household").eq("status", "confirmed").is("reimbursed_at", null).neq("user_id", hh.owner_id) : Promise.resolve({ data: [] }),
  ]);

  const claimTotal = (claims.data ?? []).reduce((s, r) => s + Number(r.base_amount ?? 0), 0);
  const owedToMe = (shares.data ?? []).reduce((s, r) => {
    const tx = r.transactions as unknown as { fx_rate: number | null; status: string };
    return tx.status === "confirmed" ? s + Number(r.amount) * Number(tx.fx_rate ?? 0) : s;
  }, 0);
  const owedToMembers = (owed.data ?? []).reduce((s, r) => s + (r.kind === "refund" ? -1 : 1) * Number(r.base_amount ?? 0), 0);
  const lastSeen = heartbeat.data?.last_seen_at ? new Date(heartbeat.data.last_seen_at) : null;
  const stale = !lastSeen || Date.now() - lastSeen.getTime() > 24 * 3600e3;

  const cats = [...personal.byCategory.entries()]
    .map(([id, v]) => ({ name: categories.find((c) => c.id === id)?.name ?? "Uncategorised", v }))
    .sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...cats.map((c) => c.v));
  const budget = hh?.monthly_budget ?? 0;

  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        {stale && (
          <div className="warn">
            {lastSeen ? `Gmail connector last seen ${lastSeen.toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}.` : "Gmail connector not set up yet."}{" "}
            <Link href="/settings">Check settings</Link>
          </div>
        )}
        {pendingCount > 0 && <div className="warn"><Link href="/review">{pendingCount} spends waiting for review</Link></div>}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1>{ym}</h1>
          <div className="row">
            <Link className="btn" href={`/?m=${shiftMonth(ym, -1)}`}>←</Link>
            <Link className="btn" href={`/?m=${shiftMonth(ym, 1)}`}>→</Link>
          </div>
        </div>
        <div className="grid">
          <div className="card stat"><div className="label">Personal spending</div><div className="value">{money(personal.total, base)}</div><div className="small muted">accepted only · your share of shared spends</div></div>
          {hh && (
            <div className="card stat">
              <div className="label">Household ({hh.name})</div>
              <div className="value">{money(household?.spent ?? 0, hh.currency)}</div>
              <div className="bar" style={{ margin: "6px 0" }}><span style={{ width: `${Math.min(100, ((household?.spent ?? 0) / Math.max(1, budget)) * 100)}%` }} /></div>
              <div className="small muted">{money(Math.max(0, budget - (household?.spent ?? 0)), hh.currency)} left of {money(budget, hh.currency)}</div>
            </div>
          )}
          <div className="card stat"><div className="label">Work claims outstanding</div><div className="value">{money(claimTotal, base)}</div></div>
          <div className="card stat"><div className="label">People owe you</div><div className="value">{money(owedToMe, base)}</div></div>
          {hh && hh.owner_id === uid && <div className="card stat"><div className="label">You owe household members</div><div className="value">{money(owedToMembers, hh.currency)}</div></div>}
          <div className="card stat"><div className="label">Invested</div><div className="value">{money(personal.investments, base)}</div></div>
        </div>
        <h2>Personal spending by category</h2>
        <div className="card">
          {cats.length === 0 && <p className="muted">No accepted spending this month yet.</p>}
          {cats.map((c) => (
            <div key={c.name} style={{ marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: "space-between" }}><span>{c.name}</span><span>{money(c.v, base)}</span></div>
              <div className="bar"><span style={{ width: `${(Math.max(0, c.v) / maxCat) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
