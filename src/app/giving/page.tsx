import Link from "next/link";
import { getContext, monthRange, yearStart } from "@/lib/server/context";
import { givingPeriod } from "@/lib/server/summary";
import { money, sgtDate } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { MonthStepper } from "../ui/MonthStepper";
import { IconChevronRight } from "../ui/Icons";
import { Flash } from "../Flash";
import { saveGivingBudget } from "../actions";

export const metadata = { title: "Giving · Expenses" };

export default async function GivingPage({ searchParams }: { searchParams: Promise<{ m?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { db, uid, profile, pendingCount } = await getContext();
  const base = profile?.base_currency ?? "SGD";
  const { ym, start, end } = monthRange(sp.m);
  const budget = profile?.giving_monthly_budget == null ? null : Number(profile.giving_monthly_budget);
  const [month, ytd] = await Promise.all([
    givingPeriod(db, uid, start, end),
    givingPeriod(db, uid, yearStart(ym), end),
  ]);
  // Count from the first month with Giving recorded this year, so a fresh start isn't averaged over empty months.
  const firstYm = ytd.rows.length ? ytd.rows.map((r) => new Date(new Date(r.occurred_at).getTime() + 8 * 3600e3).toISOString().slice(0, 7)).sort()[0]! : ym;
  const monthsSoFar = Math.max(1, Number(ym.slice(5, 7)) - Number(firstYm.slice(5, 7)) + 1);
  const firstLabel = new Intl.DateTimeFormat("en-SG", { month: "short", timeZone: "UTC" }).format(new Date(firstYm + "-01T00:00:00Z"));
  const ytdBudget = budget ? budget * monthsSoFar : null;

  const BRANCHES = [["parents", "Parents"], ["regular", "Regular"], ["adhoc", "Ad hoc"]] as const;

  // Who received it this month (e.g. the monthly transfer to your parents, a charity)
  const byRecipient = new Map<string, { total: number; n: number }>();
  for (const r of month.rows) {
    const k = r.merchant ?? "Unknown";
    const v = byRecipient.get(k) ?? { total: 0, n: 0 };
    v.total += Number(r.base_amount ?? 0) * (r.kind === "refund" ? -1 : 1);
    v.n++;
    byRecipient.set(k, v);
  }
  const recipients = [...byRecipient.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <Shell active="giving" pending={pendingCount}>
      <Header title="Giving" sub="Allowance to family, gifts and donations, kept outside personal spending">
        <MonthStepper ym={ym} path="/giving" />
      </Header>
      <Flash error={sp.error} ok={sp.ok} />

      <section className="hero">
        <div className="h-label">Given this month</div>
        <div className="h-value">{money(month.total, base)}</div>
        {budget ? (
          <>
            <div className="bar-track" style={{ margin: "10px 0 6px" }}><div className="bar-fill" style={{ width: `${Math.min(100, (month.total / budget) * 100)}%`, background: month.total > budget ? "var(--bad)" : undefined }} /></div>
            <div className="h-foot">{month.total > budget ? <span className="bad">{money(month.total - budget, base)} over</span> : `${money(budget - month.total, base)} left`} of {money(budget, base)} monthly budget</div>
          </>
        ) : <div className="h-foot">Set a monthly budget below</div>}
      </section>

      <div className="tiles two">
        <div className="tile"><div className="t-label">{ym.slice(0, 4)} so far</div><div className="t-value">{money(ytd.total, base)}</div>
          <div className="t-foot">{ytdBudget ? <>{ytd.total > ytdBudget ? <span className="bad">{money(ytd.total - ytdBudget, base)} over</span> : `${money(ytdBudget - ytd.total, base)} under`} budget</> : `${monthsSoFar} ${monthsSoFar === 1 ? "month" : "months"}`}</div></div>
        <div className="tile"><div className="t-label">Monthly average</div><div className="t-value">{money(ytd.total / monthsSoFar, base)}</div>
          <div className="t-foot">{monthsSoFar === 1 ? `${firstLabel} only` : `${firstLabel} to ${new Intl.DateTimeFormat("en-SG", { month: "short", timeZone: "UTC" }).format(new Date(ym + "-01T00:00:00Z"))}`}</div></div>
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        <table className="buckets num">
          <thead><tr><th /><th>This month</th><th>{ym.slice(0, 4)} so far</th></tr></thead>
          <tbody>
            {BRANCHES.map(([k, label]) => (
              <tr key={k}><th>{label}</th><td>{money(month.byKind[k], base)}</td><td>{money(ytd.byKind[k], base)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th>Total</th><td>{money(month.total, base)}</td><td>{money(ytd.total, base)}</td></tr></tfoot>
        </table>
      </div>

      {recipients.length > 0 && (
        <>
          <h2 className="section-title">To whom</h2>
          <div className="list">
            {recipients.map(([name, v]) => (
              <div className="row" key={name}>
                <div className="main"><div className="title">{name}</div><div className="subtitle">{v.n} {v.n === 1 ? "payment" : "payments"}</div></div>
                <div className="trail num">{money(v.total, base)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="section-title">This month</h2>
      <div className="list">
        {month.rows.length === 0 && <div className="row empty">Nothing given this month yet. Choose <strong>Giving</strong> as the allocation on a spend card and it shows up here.</div>}
        {month.rows.map((r) => (
          <Link className="row" href={`/transactions/${r.id}`} key={r.id}>
            <div className="main"><div className="title">{r.merchant ?? "—"}</div><div className="subtitle">{sgtDate(r.occurred_at)} · {r.giving_kind === "parents" ? "Parents" : r.giving_kind === "regular" ? "Regular" : "Ad hoc"}</div></div>
            <div className="trail num">
              <div>{money(r.amount, r.currency)}</div>
              {r.currency !== base && <div className="subtitle">{money(r.base_amount, base)}</div>}
            </div>
            <IconChevronRight className="chev" />
          </Link>
        ))}
      </div>

      <form action={saveGivingBudget} className="card" style={{ marginTop: 16 }}>
        <label className="field"><span>Monthly giving budget ({base})</span>
          <input name="budget" type="number" inputMode="decimal" min="0" step="1" defaultValue={budget ?? ""} placeholder="e.g. 1000" />
        </label>
        <p className="small muted">Spends with the Giving allocation count here instead of in personal spending. Leave empty for no budget.</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="btn primary">Save budget</button></div>
      </form>
    </Shell>
  );
}
