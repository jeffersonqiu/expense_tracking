import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { Shell, Header } from "../../ui/Shell";
import { IconChevronLeft } from "../../ui/Icons";
import { Flash } from "../../Flash";
import { importTrips } from "../../actions";

export default async function ImportTripsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { pendingCount } = await getContext();
  return (
    <Shell active="trips" pending={pendingCount}>
      <Link href="/trips" className="btn plain" style={{ marginLeft: -8 }}><IconChevronLeft />Trips</Link>
      <Header title="Import trips" sub="Bring in trips you tracked in a spreadsheet" />
      <Flash error={sp.error} ok={sp.ok} />
      <form action={importTrips} className="card">
        <label className="field"><span>Paste rows: one trip per line with month (e.g. &ldquo;Oct 2026&rdquo;), name, daily, transport, hotels, total. Copying straight from the Travel Collation sheet works.</span>
          <textarea name="rows" rows={10} required placeholder={"Oct 2026\tAgentix Bangkok\t45.00\t0.00\t0.00\t45.00"} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} />
        </label>
        <p className="small muted">Importing the same trip again updates its totals instead of duplicating it. Totals are kept as the trip&apos;s starting amounts; spends you tag in the app add on top.</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="btn primary">Import</button></div>
      </form>
    </Shell>
  );
}
