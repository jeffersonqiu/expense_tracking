import { getContext } from "@/lib/server/context";
import { promoteEmail } from "../actions";
import { sgtDateTime } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { Flash } from "../Flash";

export const metadata = { title: "Skipped emails · Expenses" };

const STATUS: Record<string, string> = { rejected: "Not a spend", needs_review: "Unclear", ignored: "Ignored" };

export default async function MissedPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, pendingCount } = await getContext();
  const since = new Date(Date.now() - 30 * 86400e3).toISOString();
  const { data } = await db.from("source_emails")
    .select("id, received_at, from_address, subject, status, reason")
    .eq("user_id", uid).in("status", ["rejected", "needs_review", "ignored"]).gte("received_at", since)
    .order("received_at", { ascending: false }).limit(300);
  return (
    <Shell active="settings" pending={pendingCount}>
      <Header title="Skipped emails" sub="Last 30 days" />
      <Flash error={flash.error} ok={flash.ok} />
      <div className="list">
        {(data ?? []).length === 0 && <div className="row empty">Nothing skipped.</div>}
        {(data ?? []).map((e) => (
          <div className="row" key={e.id}>
            <div className="main">
              <div className="title" style={{ fontWeight: 400 }}>{e.subject || "(no subject)"}</div>
              <div className="subtitle">{e.from_address.replace(/<.*>/, "").trim() || e.from_address} · {sgtDateTime(e.received_at)}</div>
              <div className="subtitle"><span className={`pill ${e.status === "needs_review" ? "warn" : ""}`}>{STATUS[e.status] ?? e.status}</span> {e.reason}</div>
            </div>
            <form action={promoteEmail} className="inline"><input type="hidden" name="id" value={e.id} /><button className="btn" style={{ fontSize: 13, padding: "5px 10px" }}>Make draft</button></form>
          </div>
        ))}
      </div>
    </Shell>
  );
}
