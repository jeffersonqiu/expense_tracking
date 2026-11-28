import Link from "next/link";
import { getContext, monthRange, shiftMonth } from "@/lib/server/context";
import { givingPeriod, householdMonth, personalMonth } from "@/lib/server/summary";
import { money, sgtDate } from "@/lib/format";
import { Shell, Header } from "./ui/Shell";
import { MonthStepper } from "./ui/MonthStepper";
import { IconAlert, IconBriefcase, IconChart, IconChevronRight, IconGear, IconHouse, IconInbox, IconHeart, IconPeople, IconPlane, IconWallet } from "./ui/Icons";
import { tripTotals, sumTotals } from "@/lib/server/trips";

export default async function Summary({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { db, uid, profile, categories, households, trips, pendingCount } = await getContext();
  const base = profile?.base_currency ?? "SGD";
  const { ym, start, end } = monthRange(sp.m);
  const prev = monthRange(shiftMonth(ym, -1));
  const hh = households[0];
  const givingBudget = profile?.giving_monthly_budget == null ? null : Number(profile.giving_monthly_budget);
  const giving = await givingPeriod(db, uid, start, end);

  const [personal, prevPersonal, household, heartbeat, claims, shares, owed, recent, cardPay] = await Promise.all([
    personalMonth(db, uid, start, end),
    personalMonth(db, uid, prev.start, prev.end),
    hh ? householdMonth(db, hh.id, start, end) : Promise.resolve(null),
    db.from("script_heartbeats").select("last_seen_at").eq("user_id", uid).maybeSingle(),
    db.from("transactions").select("base_amount").eq("user_id", uid).eq("allocation", "work").eq("status", "confirmed").in("claim_status", ["to_claim", "submitted"]),
    db.from("shared_shares").select("amount, transactions!inner(fx_rate, status)").eq("user_id", uid).is("settled_at", null),
    hh ? db.from("transactions").select("base_amount, kind").eq("household_id", hh.id).eq("allocation", "household").eq("status", "confirmed").is("reimbursed_at", null).neq("user_id", hh.owner_id) : Promise.resolve({ data: [] as { base_amount: number | null; kind: string }[] }),
    db.from("transactions").select("id, occurred_at, merchant, amount, currency, kind, category_id").eq("user_id", uid).eq("status", "confirmed").neq("kind", "card_payment").gte("occurred_at", start).lt("occurred_at", end).order("occurred_at", { ascending: false }).limit(5),
    db.from("transactions").select("base_amount").eq("user_id", uid).eq("status", "confirmed").eq("kind", "card_payment").gte("occurred_at", start).lt("occurred_at", end),
  ]);
  const cardPaid = (cardPay.data ?? []).reduce((s, r) => s + Number(r.base_amount ?? 0), 0);

  const year = ym.slice(0, 4);
  const yearTrips = trips.filter((t) => t.start_date.startsWith(year));
  const tripYear = sumTotals([...(await tripTotals(db, yearTrips)).values()]);
  const claimTotal = (claims.data ?? []).reduce((s, r) => s + Number(r.base_amount ?? 0), 0);
  const owedToMe = (shares.data ?? []).reduce((s, r) => {
    const tx = r.transactions as unknown as { fx_rate: number | null; status: string };
    return tx.status === "confirmed" ? s + Number(r.amount) * Number(tx.fx_rate ?? 0) : s;
  }, 0);
  const owedToMembers = (owed.data ?? []).reduce((s, r) => s + (r.kind === "refund" ? -1 : 1) * Number(r.base_amount ?? 0), 0);
  const lastSeen = heartbeat.data?.last_seen_at ? new Date(heartbeat.data.last_seen_at) : null;
  const stale = !lastSeen || Date.now() - lastSeen.getTime() > 24 * 3600e3;

  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const cats = [...personal.byCategory.entries()]
    .map(([id, v]) => ({ name: catName.get(id ?? "") ?? "Uncategorised", v }))
    .filter((c) => c.v > 0)
    .sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...cats.map((c) => c.v));
  const delta = personal.total - prevPersonal.total;
  const spent = household?.spent ?? 0;
  const budget = hh?.monthly_budget ?? 0;

  return (
    <Shell active="summary" pending={pendingCount}>
      <Header title="Summary">
        <MonthStepper ym={ym} path="/" />
        <Link href="/settings" className="btn icon gear-link" aria-label="Settings"><IconGear /></Link>
      </Header>

      {stale && (
        <Link href="/settings" className="banner warn" style={{ color: "var(--label)" }}>
          <IconAlert />
          <span className="grow">{lastSeen ? "Gmail connector hasn't checked in for over a day." : "Connect Gmail to start capturing spending."}</span>
          <IconChevronRight className="chev" />
        </Link>
      )}
      {pendingCount > 0 && (
        <Link href="/review" className="banner" style={{ color: "var(--label)" }}>
          <span className="avatar tint" style={{ width: 28, height: 28 }}><IconInbox /></span>
          <span className="grow"><strong>{pendingCount}</strong> {pendingCount === 1 ? "spend" : "spends"} waiting for review</span>
          <IconChevronRight className="chev" />
        </Link>
      )}

      <section className="hero" aria-label="Personal spending">
        <div className="h-label">Personal spending</div>
        <div className="h-value">{money(personal.total, base)}</div>
        <div className="h-foot">
          {prevPersonal.total > 0
            ? Math.abs(delta) < 0.005 ? "Same as last month" : <>{money(Math.abs(delta), base)} {delta > 0 ? "more" : "less"} than last month</>
            : null}
        </div>
      </section>

      <div className="tiles">
        {hh && (
          <Link href="/household" className="tile">
            <div className="t-label"><IconHouse />{hh.name}</div>
            <div className="t-value">{money(Math.abs(budget - spent), hh.currency)}</div>
            <div className="t-foot">{spent > budget ? <span className="bad">over budget</span> : `left of ${money(budget, hh.currency)}`}</div>
          </Link>
        )}
        <Link href={`/giving?m=${ym}`} className="tile">
          <div className="t-label"><IconHeart />Giving</div>
          <div className="t-value">{money(giving.total, base)}</div>
          {givingBudget != null && givingBudget > 0 ? (
            <>
              <div className="bar-track" style={{ margin: "6px 0 4px" }}><div className="bar-fill" style={{ width: `${Math.min(100, (giving.total / givingBudget) * 100)}%`, background: giving.total > givingBudget ? "var(--bad)" : undefined }} /></div>
              <div className="t-foot">{giving.total > givingBudget ? <span className="bad">{money(giving.total - givingBudget, base)} over</span> : `${money(givingBudget - giving.total, base)} left`} of {money(givingBudget, base)}</div>
            </>
          ) : <div className="t-foot">no budget</div>}
        </Link>
        <Link href={`/trips?y=${year}`} className="tile">
          <div className="t-label"><IconPlane />Trips {year}</div>
          <div className="t-value">{money(tripYear.personal.total, base)}</div>
          <div className="t-foot">{tripYear.business.total ? `you paid · +${money(tripYear.business.total, base)} business` : `${yearTrips.length} ${yearTrips.length === 1 ? "trip" : "trips"}`}</div>
        </Link>
        {cardPaid > 0 && (
          <Link href={`/transactions?m=${ym}&status=cards`} className="tile">
            <div className="t-label"><IconWallet />Card payments</div>
            <div className="t-value">{money(cardPaid, base)}</div>
            <div className="t-foot">{(cardPay.data ?? []).length} paid</div>
          </Link>
        )}
        <Link href="/balances" className="tile">
          <div className="t-label"><IconBriefcase />Work claims</div>
          <div className="t-value">{money(claimTotal, base)}</div>
          <div className="t-foot">not yet reimbursed</div>
        </Link>
        {owedToMe > 0 && (
          <Link href="/balances" className="tile">
            <div className="t-label"><IconPeople />Owed to you</div>
            <div className="t-value">{money(owedToMe, base)}</div>
          </Link>
        )}
        {hh && hh.owner_id === uid && owedToMembers > 0 ? (
          <Link href="/household" className="tile">
            <div className="t-label"><IconHouse />To reimburse</div>
            <div className="t-value">{money(owedToMembers, hh.currency)}</div>
          </Link>
        ) : (
          <div className="tile">
            <div className="t-label"><IconChart />Invested</div>
            <div className="t-value">{money(personal.investments, base)}</div>
          </div>
        )}
      </div>

      <h2 className="section-title">By category</h2>
      <div className="list bars">
        {cats.length === 0 && <div className="row empty">No accepted spending this month yet.</div>}
        {cats.map((c) => (
          <div className="row" key={c.name} title={`${c.name}: ${money(c.v, base)}`}>
            <div className="main"><div className="title">{c.name}</div></div>
            <div className="trail">
              <span className="num">{money(c.v, base)}</span>{" "}
              <span className="small faint num">{personal.total > 0 ? Math.round((c.v / personal.total) * 100) : 0}%</span>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.v / maxCat) * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <h2 className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        Recent <Link href="/transactions" className="small" style={{ fontWeight: 500 }}>See all</Link>
      </h2>
      <div className="list">
        {(recent.data ?? []).length === 0 && <div className="row empty">Nothing accepted yet this month.</div>}
        {(recent.data ?? []).map((t) => (
          <Link className="row" href={`/transactions/${t.id}`} key={t.id}>
            <div className="avatar">{(t.merchant ?? "?").trim().charAt(0).toUpperCase()}</div>
            <div className="main">
              <div className="title">{t.merchant ?? "—"}</div>
              <div className="subtitle">{catName.get(t.category_id) ?? (t.kind === "spend" ? "Uncategorised" : t.kind)} · {sgtDate(t.occurred_at)}</div>
            </div>
            <div className="trail num">
              <span className={t.kind === "refund" ? "good" : undefined}>{t.kind === "refund" ? "+" : ""}{money(t.amount, t.currency)}</span>
            </div>
          </Link>
        ))}
      </div>
    </Shell>
  );
}
