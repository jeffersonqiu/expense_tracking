import { getContext } from "@/lib/server/context";
import { promoteEmail } from "../actions";
import { sgtDateTime } from "@/lib/format";
import { Flash } from "@/app/Flash";
import { Nav } from "../Nav";

export const metadata = { title: "Skipped emails · Expense Tracker" };

export default async function MissedPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, pendingCount } = await getContext();
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { data } = await db.from("source_emails")
    .select("id, received_at, from_address, subject, status, reason")
    .eq("user_id", uid).in("status", ["rejected", "needs_review", "ignored"]).gte("received_at", since)
    .order("received_at", { ascending: false }).limit(300);
  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <Flash error={flash.error} ok={flash.ok} />
        <h1>Skipped emails (30 days)</h1>
        <p className="muted small">Emails the connector sent that did not become a transaction. If one was really a spend, turn it into a draft.</p>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Received</th><th>Email</th><th>Why</th><th></th></tr></thead>
            <tbody>
              {(data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="small">{sgtDateTime(e.received_at)}</td>
                  <td>{e.subject}<div className="small muted">{e.from_address}</div></td>
                  <td className="small"><span className="pill">{e.status}</span> {e.reason}</td>
                  <td><form action={promoteEmail} className="inline"><input type="hidden" name="id" value={e.id} /><button className="btn small">Make draft</button></form></td>
                </tr>
              ))}
              {(data ?? []).length === 0 && <tr><td colSpan={4} className="muted">Nothing skipped.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
