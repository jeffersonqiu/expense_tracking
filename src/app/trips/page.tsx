import Link from "next/link";
import { getContext, type Trip } from "@/lib/server/context";
import { sortTrips, sumTotals, tripDates, tripTiming, tripTotals, sgtToday, type TripTotals } from "@/lib/server/trips";
import { money } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { IconChevronRight, IconPlane, IconPlus } from "../ui/Icons";
import { Flash } from "../Flash";
import { saveTrip } from "../actions";
import { DateRange } from "../ui/DateRange";

export const metadata = { title: "Trips · Expenses" };

function TripRow({ t, tt, base }: { t: Trip; tt: TripTotals; base: string }) {
  const buckets = ([["Daily", tt.daily], ["Transport", tt.transport], ["Hotels", tt.hotels]] as const)
    .filter(([, v]) => v > 0).map(([k, v]) => `${k} ${money(v, base)}`).join(" · ");
  return (
    <Link className="row indent trip-row" href={`/trips/${t.id}`}>
      <div className="avatar tint"><IconPlane /></div>
      <div className="main">
        <div className="title">{t.name}</div>
        <div className="subtitle">{tripDates(t)} · {t.end_date ? tripTiming(t) : <span className="warn">add end date</span>}</div>
        {buckets && <div className="subtitle num">{buckets}</div>}
      </div>
      <div className="trail num" style={{ fontWeight: 600 }}>{tt.total ? money(tt.total, base) : ""}</div>
      <IconChevronRight className="chev" />
    </Link>
  );
}

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ y?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { db, profile, trips, pendingCount } = await getContext();
  const base = profile?.base_currency ?? "SGD";
  const today = sgtToday();
  const thisYear = today.slice(0, 4);
  const groups = sortTrips(trips, today);
  const pastYears = [...new Set([thisYear, ...trips.map((t) => t.start_date.slice(0, 4))])].sort().reverse();
  const year = sp.y && pastYears.includes(sp.y) ? sp.y : thisYear;
  const past = groups.past.filter((t) => (t.end_date ?? t.start_date).startsWith(year));
  const totals = await tripTotals(db, trips);
  const yearTotal = sumTotals(trips.filter((t) => t.start_date.startsWith(year)).map((t) => totals.get(t.id)!));
  const section = (title: string, list: Trip[]) => list.length > 0 && (
    <>
      <h2 className="section-title">{title}</h2>
      <div className="list">{list.map((t) => <TripRow key={t.id} t={t} tt={totals.get(t.id)!} base={base} />)}</div>
    </>
  );

  return (
    <Shell active="trips" pending={pendingCount}>
      <Header title="Trips" sub="Travel spending, tracked separately from everyday spending" />
      <Flash error={sp.error} ok={sp.ok} />

      {pastYears.length > 1 && (
        <div className="seg links" style={{ maxWidth: 360, marginBottom: 14 }}>
          {pastYears.slice(0, 4).map((y) => <Link key={y} href={`/trips?y=${y}`} aria-current={y === year ? "page" : undefined}>{y}</Link>)}
        </div>
      )}
      <div className="tiles four">
        <div className="tile"><div className="t-label">Daily</div><div className="t-value">{money(yearTotal.daily, base)}</div></div>
        <div className="tile"><div className="t-label">Transport</div><div className="t-value">{money(yearTotal.transport, base)}</div></div>
        <div className="tile"><div className="t-label">Hotels</div><div className="t-value">{money(yearTotal.hotels, base)}</div></div>
        <div className="tile"><div className="t-label">Total {year}</div><div className="t-value">{money(yearTotal.total, base)}</div></div>
      </div>
      {section("On a trip now", groups.now)}
      {section("Upcoming", groups.upcoming)}

      <h2 className="section-title">Past trips{pastYears.length > 1 ? ` in ${year}` : ""}</h2>
      <div className="list">
        {past.length === 0 && <div className="row empty">No past trips in {year}.</div>}
        {past.map((t) => <TripRow key={t.id} t={t} tt={totals.get(t.id)!} base={base} />)}
      </div>

      <details className="addmore" open={trips.length === 0}>
        <summary className="btn" style={{ width: "100%" }}><IconPlus />New trip</summary>
        <form action={saveTrip} className="card">
          <div className="fields">
            <label className="field"><span>Name</span><input name="name" required maxLength={80} placeholder="Italy" /></label>
            <div className="field"><span>Dates</span><DateRange startName="start_date" endName="end_date" /></div>
            <label className="field"><span>Budget (optional)</span><input name="budget" type="number" inputMode="decimal" min="0" /></label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button className="btn primary">Create trip</button></div>
        </form>
      </details>
    </Shell>
  );
}
