import { getContext } from "@/lib/server/context";
import { Flash } from "@/app/Flash";
import { Nav } from "../Nav";
import { TxnForm, type TxnRow } from "../TxnForm";
import { money, sgtDateTime } from "@/lib/format";

export const metadata = { title: "Review · Expense Tracker" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, categories, households, pendingCount } = await getContext();
  const { data } = await db
    .from("transactions")
    .select("*, source_emails(subject, from_address, body_text), shared_shares(person_name, amount, settled_at)")
    .eq("user_id", uid).eq("status", "pending").is("duplicate_of", null)
    .order("occurred_at", { ascending: true }).limit(30);
  const rows = (data ?? []) as TxnRow[];
  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <Flash error={flash.error} ok={flash.ok} />
        <h1>Review ({pendingCount})</h1>
        <p className="muted small">Oldest first. Every captured spend waits here until you accept or reject it.</p>
        {rows.length === 0 && <div className="card">All caught up.</div>}
        {rows.map((t) => (
          <section key={t.id}>
            <h2 style={{ marginTop: 16 }}>
              {money(t.amount, t.currency)} · {t.merchant ?? t.merchant_raw} <span className="muted small">{sgtDateTime(t.occurred_at)}</span>
            </h2>
            <TxnForm txn={t} categories={categories} households={households} returnTo="/review" mode="review" />
          </section>
        ))}
      </main>
    </>
  );
}
