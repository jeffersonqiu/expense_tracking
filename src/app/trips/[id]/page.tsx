import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/server/context";
import { tripDates, tripTiming, tripTotals } from "@/lib/server/trips";
import { money, sgtDate } from "@/lib/format";
import { Shell, Header } from "../../ui/Shell";
import { IconChevronLeft, IconChevronRight } from "../../ui/Icons";
import { Flash } from "../../Flash";
import { deleteTrip, saveTrip } from "../../actions";

const BUCKETS = [["transport", "Transport"], ["hotels", "Hotels"], ["daily", "Daily"]] as const;

function Links({ text }: { text: string }) {
  return (
    <div className="linkify">
      {text.split(/\s+/).filter(Boolean).map((w, i) =>
        /^https?:\/\//.test(w) ? <div key={i}><a href={w} target="_blank" rel="noopener noreferrer">{w.includes("docs.google.com") ? "Spending tracker sheet" : w}</a></div> : <span key={i}>{w} </span>)}
    </div>
  );
}

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, uid, profile, trips, pendingCount } = await getContext();
  const t = trips.find((x) => x.id === id);
  if (!t) notFound();
  const base = profile?.base_currency ?? "SGD";
  const tt = (await tripTotals(db, [t])).get(t.id)!;
  const { data: spends } = await db.from("transactions")
    .select("id, occurred_at, merchant, amount, currency, base_amount, kind, allocation, trip_bucket, status")
    .eq("user_id", uid).eq("trip_id", t.id).neq("status", "rejected").order("occurred_at");

  return (
    <Shell active="trips" pending={pendingCount}>
      <Link href={`/trips?y=${t.start_date.slice(0, 4)}`} className="btn plain" style={{ marginLeft: -8 }}><IconChevronLeft />Trips</Link>
      <Header title={t.name} sub={`${tripDates(t)} · ${tripTiming(t)}`} />
      <Flash error={sp.error} ok={sp.ok} />

      <section className="hero">
        <div className="h-label">Trip total</div>
        <div className="h-value">{money(tt.total, base)}</div>
        {t.budget != null && (
          <>
            <div className="bar-track" style={{ margin: "10px 0 6px" }}><div className="bar-fill" style={{ width: `${Math.min(100, (tt.total / Math.max(1, t.budget)) * 100)}%`, background: tt.total > t.budget ? "var(--bad)" : undefined }} /></div>
            <div className="h-foot">{tt.total > t.budget ? <span className="bad">{money(tt.total - t.budget, base)} over</span> : `${money(t.budget - tt.total, base)} left`} of {money(t.budget, base)} budget</div>
          </>
        )}
      </section>
      <div className="tiles four">
        <div className="tile"><div className="t-label">Daily</div><div className="t-value">{money(tt.daily, base)}</div></div>
        <div className="tile"><div className="t-label">Transport</div><div className="t-value">{money(tt.transport, base)}</div></div>
        <div className="tile"><div className="t-label">Hotels</div><div className="t-value">{money(tt.hotels, base)}</div></div>
        <div className="tile"><div className="t-label">{tt.claimable ? "Claimable (work)" : "Not split"}</div>
          <div className="t-value">{money(tt.claimable || tt.unsplit, base)}</div></div>
      </div>
      {(t.baseline_daily + t.baseline_transport + t.baseline_hotels + t.baseline_unsplit) > 0 && (
        <div className="section-foot">Includes starting totals added before tracking{tt.tracked ? `, plus ${tt.tracked} spends tracked here` : ""}.</div>
      )}

      {BUCKETS.map(([key, label]) => {
        const rows = (spends ?? []).filter((s) => s.trip_bucket === key);
        if (!rows.length) return null;
        return (
          <section key={key}>
            <div className="section-label">{label}</div>
            <div className="list">
              {rows.map((s) => (
                <Link className="row" href={`/transactions/${s.id}`} key={s.id}>
                  <div className="main">
                    <div className="title">{s.merchant ?? "—"}</div>
                    <div className="subtitle">{sgtDate(s.occurred_at)}{s.allocation === "work" ? " · Work claim" : ""}{s.status === "pending" ? " · waiting for review" : ""}</div>
                  </div>
                  <div className="trail num">
                    <div>{money(s.amount, s.currency)}</div>
                    {s.currency !== base && <div className="subtitle">{money(s.base_amount, base)}</div>}
                  </div>
                  <IconChevronRight className="chev" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      {t.links && (<><div className="section-label">Links</div><div className="list"><div className="row"><Links text={t.links} /></div></div></>)}

      <details className="addmore">
        <summary className="btn" style={{ width: "100%" }}>Edit trip, links, things to bring</summary>
        <form action={saveTrip} className="card">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="return_to" value={`/trips/${t.id}`} />
          <div className="fields">
            <label className="field"><span>Name</span><input name="name" defaultValue={t.name} required maxLength={80} /></label>
            <label className="field"><span>From</span><input name="start_date" type="date" defaultValue={t.start_date} required /></label>
            <label className="field"><span>To</span><input name="end_date" type="date" defaultValue={t.end_date ?? ""} /></label>
            <label className="field"><span>Budget</span><input name="budget" type="number" inputMode="decimal" min="0" defaultValue={t.budget ?? ""} /></label>
          </div>
          <div className="fields" style={{ marginTop: 10 }}>
            <label className="field"><span>Links (one per line)</span><textarea name="links" rows={2} defaultValue={t.links ?? ""} /></label>
            <label className="field"><span>Things to bring</span><textarea name="things_to_bring" rows={3} defaultValue={t.things_to_bring ?? ""} /></label>
            <label className="field"><span>Remarks</span><textarea name="remarks" rows={2} defaultValue={t.remarks ?? ""} /></label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}><button className="btn primary">Save</button></div>
        </form>
        <form action={deleteTrip} style={{ marginTop: 10, textAlign: "center" }}>
          <input type="hidden" name="id" value={t.id} />
          <button className="btn plain destructive">Delete trip</button>
        </form>
      </details>
      {t.things_to_bring && (<><div className="section-label">Things to bring</div><div className="list"><div className="row" style={{ whiteSpace: "pre-wrap" }}>{t.things_to_bring}</div></div></>)}
      {t.remarks && (<><div className="section-label">Remarks</div><div className="list"><div className="row" style={{ whiteSpace: "pre-wrap" }}>{t.remarks}</div></div></>)}
    </Shell>
  );
}
