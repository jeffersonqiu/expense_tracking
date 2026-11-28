import Link from "next/link";
import { getContext, monthRange, shiftMonth } from "@/lib/server/context";
import { billsMonth, householdMonth, projectTotals } from "@/lib/server/summary";
import { markReimbursed } from "../actions";
import { money, sgtDate } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { MonthStepper } from "../ui/MonthStepper";
import { IconAlert, IconChevronRight, IconHouse } from "../ui/Icons";
import { Flash } from "../Flash";

export const metadata = { title: "Household · Expenses" };

function Ring({ value, max }: { value: number; max: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const frac = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg className="ring" viewBox="0 0 96 96" role="img" aria-label={`${Math.round((value / Math.max(1, max)) * 100)}% of budget used`}>
      <circle className="track" cx="48" cy="48" r={r} fill="none" strokeWidth="10" />
      <circle className={`value ${value > max ? "over" : ""}`} cx="48" cy="48" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
    </svg>
  );
}

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ m?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { db, uid, households, projects, pendingCount } = await getContext();
  const hh = households[0];
  if (!hh) {
    return (
      <Shell active="household" pending={pendingCount}>
        <Header title="Household" />
        <div className="empty-state">
          <IconHouse />
          <h2>No household yet</h2>
          <p>Create one in <Link href="/settings">Settings</Link> to track shared home spending against a monthly budget.</p>
        </div>
      </Shell>
    );
  }
  const { ym, start, end } = monthRange(sp.m);
  const [month, bills, projTotals] = await Promise.all([
    householdMonth(db, hh.id, start, end),
    billsMonth(db, hh.id, start, end, monthRange(shiftMonth(ym, -3)).start),
    projectTotals(db, hh.id),
  ]);
  const openProjects = projects.filter((p) => p.household_id === hh.id && p.status === "open");
  const billDelta = bills.total - bills.lastMonthTotal;
  const [{ data: list }, { data: owed }, { data: members }] = await Promise.all([
    db.from("transactions").select("id, user_id, occurred_at, merchant, amount, currency, kind, reimbursed_at, household_pot")
      .eq("household_id", hh.id).eq("allocation", "household").eq("status", "confirmed")
      .gte("occurred_at", start).lt("occurred_at", end).order("occurred_at", { ascending: false }),
    db.from("transactions").select("id, user_id, occurred_at, merchant, base_amount, kind, household_pot")
      .eq("household_id", hh.id).eq("allocation", "household").eq("status", "confirmed")
      .is("reimbursed_at", null).neq("user_id", hh.owner_id).order("occurred_at"),
    db.from("profiles").select("id, display_name"),
  ]);
  const name = (id: string) => (id === uid ? "You" : (members ?? []).find((m) => m.id === id)?.display_name?.split(" ")[0] ?? "Member");
  const isOwner = hh.owner_id === uid;
  const owedTotal = (owed ?? []).reduce((s, r) => s + (r.kind === "refund" ? -1 : 1) * Number(r.base_amount ?? 0), 0);
  const left = hh.monthly_budget - month.spent;

  return (
    <Shell active="household" pending={pendingCount}>
      <Header title={hh.name}><MonthStepper ym={ym} path="/household" /></Header>
      <Flash error={sp.error} ok={sp.ok} />

      <section className="hero ring-wrap" aria-label="Budget">
        <Ring value={month.spent} max={hh.monthly_budget} />
        <div>
          <div className="h-label">Allowance · {left >= 0 ? "left this month" : "over budget"}</div>
          <div className={`h-value ${left < 0 ? "bad" : ""}`}>{money(Math.abs(left), hh.currency)}</div>
          <div className="h-foot">{money(month.spent, hh.currency)} spent of {money(hh.monthly_budget, hh.currency)}</div>
        </div>
      </section>

      <h2 className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>Bills &amp; utilities</span>
        <span className="num" style={{ fontWeight: 600 }}>{money(bills.total, hh.currency)}</span>
      </h2>
      <div className="list">
        {bills.lines.length === 0 && <div className="row empty">No bills this month yet.</div>}
        {bills.lines.map((l) => (
          <div className="row" key={l.merchant + l.ids[0]}>
            <div className="main">
              <div className="title">{l.merchant}</div>
              {l.usual != null && <div className="subtitle">Usually {money(l.usual, hh.currency)}</div>}
            </div>
            {l.unusual && <span className="pill warn"><IconAlert className="" />Higher than usual</span>}
            <div className="trail num">{money(l.amount, hh.currency)}</div>
          </div>
        ))}
      </div>
      {bills.lastMonthTotal > 0 && (
        <div className="section-foot">
          {Math.abs(billDelta) < 0.005 ? "Same as last month." : `${money(Math.abs(billDelta), hh.currency)} ${billDelta > 0 ? "more" : "less"} than last month.`}
        </div>
      )}

      <h2 className="section-title">Projects</h2>
      <div className="list">
        {openProjects.length === 0 && <div className="row empty">No open projects. Start one from a review card (Household → Project) or in Settings.</div>}
        {openProjects.map((pr) => {
          const spent = projTotals.get(pr.id) ?? 0;
          const over = pr.budget != null && spent > pr.budget;
          return (
            <div className="row bars" key={pr.id} style={{ flexWrap: "wrap" }}>
              <div className="main">
                <div className="title">{pr.name}</div>
                <div className="subtitle">{pr.budget != null ? (over ? <span className="bad">over budget by {money(spent - pr.budget, hh.currency)}</span> : `${money(pr.budget - spent, hh.currency)} left of ${money(pr.budget, hh.currency)}`) : "No budget set"}</div>
              </div>
              <div className="trail num" style={{ fontWeight: 600 }}>{money(spent, hh.currency)}</div>
              {pr.budget != null && <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (spent / Math.max(1, pr.budget)) * 100)}%`, background: over ? "var(--bad)" : undefined }} /></div>}
            </div>
          );
        })}
      </div>

      <h2 className="section-title">{isOwner ? "To reimburse" : "Owed to you"}{owedTotal > 0 && <span className="muted" style={{ fontWeight: 500 }}> · {money(owedTotal, hh.currency)}</span>}</h2>
      <form action={markReimbursed}>
        <div className="list">
          {(owed ?? []).length === 0 && <div className="row empty">All settled.</div>}
          {(owed ?? []).map((r) => (
            <label className="row" key={r.id} style={{ cursor: isOwner ? "pointer" : undefined }}>
              {isOwner && <input type="checkbox" name="id" value={r.id} style={{ width: 20, height: 20, accentColor: "var(--tint)" }} />}
              <div className="main">
                <div className="title">{r.merchant ?? "—"}</div>
                <div className="subtitle">Paid by {name(r.user_id)} · {sgtDate(r.occurred_at)}{r.household_pot && r.household_pot !== "allowance" ? ` · ${r.household_pot === "bills" ? "Bill" : "Project"}` : ""}</div>
              </div>
              <div className="trail num">{money((r.kind === "refund" ? -1 : 1) * Number(r.base_amount ?? 0), hh.currency)}</div>
            </label>
          ))}
        </div>
        {isOwner && (owed ?? []).length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn primary">Mark selected as reimbursed</button>
          </div>
        )}
      </form>

      <h2 className="section-title">All household spending this month</h2>
      <div className="list">
        {(list ?? []).length === 0 && <div className="row empty">No household spending this month.</div>}
        {(list ?? []).map((r) => {
          const inner = (
            <>
              <div className="avatar">{(r.merchant ?? "?").trim().charAt(0).toUpperCase()}</div>
              <div className="main">
                <div className="title">{r.merchant ?? "—"}</div>
                <div className="subtitle">
                  {name(r.user_id)} · {sgtDate(r.occurred_at)}
                  {r.household_pot && r.household_pot !== "allowance" ? ` · ${r.household_pot === "bills" ? "Bill" : "Project"}` : ""}
                  {r.user_id !== hh.owner_id && (r.reimbursed_at ? " · reimbursed" : " · owed")}
                </div>
              </div>
              <div className="trail num"><span className={r.kind === "refund" ? "good" : undefined}>{r.kind === "refund" ? "+" : ""}{money(r.amount, r.currency)}</span></div>
            </>
          );
          return r.user_id === uid
            ? <Link className="row indent" href={`/transactions/${r.id}`} key={r.id}>{inner}<IconChevronRight className="chev" /></Link>
            : <div className="row indent" key={r.id}>{inner}</div>;
        })}
      </div>
    </Shell>
  );
}
