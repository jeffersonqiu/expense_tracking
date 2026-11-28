import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { sumTotals, tripDates, tripTotals } from "@/lib/server/trips";
import { money } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { IconChevronRight, IconPlane, IconPlus } from "../ui/Icons";
import { Flash } from "../Flash";
import { saveTrip } from "../actions";

export const metadata = { title: "Trips · Expenses" };

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ y?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { db, profile, trips, pendingCount } = await getContext();
  const base = profile?.base_currency ?? "SGD";
  const thisYear = String(new Date(Date.now() + 8 * 3600e3).getUTCFullYear());
  const years = [...new Set([thisYear, ...trips.map((t) => t.start_date.slice(0, 4))])].sort().reverse();
  const year = sp.y && years.includes(sp.y) ? sp.y : thisYear;
  const list = trips.filter((t) => t.start_date.startsWith(year)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const totals = await tripTotals(db, list);
  const yearTotal = sumTotals([...totals.values()]);

  return (
    <Shell active="trips" pending={pendingCount}>
      <Header title="Trips" sub="Travel budget, tracked separately from everyday spending">
        <Link href="/trips/import" className="btn">Import</Link>
      </Header>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="seg links" style={{ maxWidth: 360, marginBottom: 14 }}>
        {years.slice(0, 4).map((y) => <Link key={y} href={`/trips?y=${y}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
      </div>

      <div className="tiles four">
        <div className="tile"><div className="t-label">Daily</div><div className="t-value">{money(yearTotal.daily, base)}</div></div>
        <div className="tile"><div className="t-label">Transport</div><div className="t-value">{money(yearTotal.transport, base)}</div></div>
        <div className="tile"><div className="t-label">Hotels</div><div className="t-value">{money(yearTotal.hotels, base)}</div></div>
        <div className="tile"><div className="t-label">Total {year}</div><div className="t-value">{money(yearTotal.total, base)}</div>
          {yearTotal.unsplit > 0 && <div className="t-foot">incl. {money(yearTotal.unsplit, base)} not split</div>}</div>
      </div>

      <h2 className="section-title">{list.length} {list.length === 1 ? "trip" : "trips"} in {year}</h2>
      <div className="list">
        {list.length === 0 && <div className="row empty">No trips in {year} yet.</div>}
        {list.map((t) => {
          const tt = totals.get(t.id)!;
          return (
            <Link className="row indent" href={`/trips/${t.id}`} key={t.id}>
              <div className="avatar tint"><IconPlane /></div>
              <div className="main">
                <div className="title">{t.name}</div>
                <div className="subtitle">{tripDates(t)}</div>
                <div className="subtitle num">
                  {[["Daily", tt.daily], ["Transport", tt.transport], ["Hotels", tt.hotels]].filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${money(Number(v), base)}`).join(" · ") || "Nothing tracked yet"}
                </div>
              </div>
              <div className="trail num" style={{ fontWeight: 600 }}>{money(tt.total, base)}</div>
              <IconChevronRight className="chev" />
            </Link>
          );
        })}
      </div>

      <details className="addmore">
        <summary className="btn" style={{ width: "100%" }}><IconPlus />New trip</summary>
        <form action={saveTrip} className="card">
          <div className="fields">
            <label className="field"><span>Name</span><input name="name" required maxLength={80} placeholder="Italy" /></label>
            <label className="field"><span>Start</span><input name="start_date" type="date" required /></label>
            <label className="field"><span>End</span><input name="end_date" type="date" /></label>
            <label className="field"><span>Budget (optional)</span><input name="budget" type="number" inputMode="decimal" min="0" /></label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button className="btn primary">Create trip</button></div>
        </form>
      </details>
    </Shell>
  );
}
