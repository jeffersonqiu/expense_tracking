import { getContext } from "@/lib/server/context";
import { Shell, Header } from "../ui/Shell";
import { IconCheckCircle, IconSparkle } from "../ui/Icons";
import { Toast } from "../ui/Toast";
import { TxnForm, type TxnRow } from "../TxnForm";
import { Flash } from "../Flash";
import { suggestCategories } from "../actions";
import { ReviewQueue } from "./ReviewQueue";
import { money } from "@/lib/format";

export const maxDuration = 60;

export const metadata = { title: "Review · Expenses" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string; done?: string }> }) {
  const flash = await searchParams;
  const { db, uid, categories, households, projects, trips, pendingCount } = await getContext();
  const { data } = await db
    .from("transactions")
    .select("*, source_emails(subject, from_address, body_text), shared_shares(person_name, amount, settled_at)")
    .eq("user_id", uid).eq("status", "pending").is("duplicate_of", null)
    .order("occurred_at", { ascending: true }).limit(20);
  const rows = (data ?? []) as TxnRow[];
  const doneRow = flash.done && /^[0-9a-f-]{36}$/i.test(flash.done)
    ? (await db.from("transactions").select("id, merchant, status").eq("id", flash.done).eq("user_id", uid).maybeSingle()).data
    : null;
  const { data: recent } = await db.from("transactions")
    .select("id, merchant, amount, currency, kind, status, reviewed_at")
    .eq("user_id", uid).in("status", ["confirmed", "rejected"]).is("duplicate_of", null)
    .not("reviewed_at", "is", null).gte("reviewed_at", new Date(Date.now() - 12 * 3600e3).toISOString())
    .order("reviewed_at", { ascending: false }).limit(10);
  const empty = (
    <div className="empty-state">
      <IconCheckCircle />
      <h2>You&apos;re all caught up</h2>
      <p>New spends from Gmail will appear here within a few minutes.</p>
    </div>
  );
  return (
    <Shell active="review" pending={pendingCount}>
      <Header title="Review" sub={pendingCount > 0 ? `${pendingCount} to go · oldest first` : undefined}>
        {rows.some((r) => !r.category_id && r.kind !== "transfer") && (
          <form action={suggestCategories}><button className="btn"><IconSparkle />Suggest categories</button></form>
        )}
      </Header>
      <Flash error={flash.error} ok={flash.ok} />
      {doneRow && (
        <Toast key={doneRow.id} message={`${doneRow.status === "confirmed" ? "Accepted" : "Rejected"} · ${doneRow.merchant ?? "spend"}`} undoId={doneRow.id} />
      )}
      <ReviewQueue
        empty={empty}
        recent={(recent ?? []).map((r) => ({ id: r.id, merchant: r.merchant ?? "Spend", amount: money(r.amount, r.currency), status: r.status as "confirmed" | "rejected" }))}
        items={rows.map((t) => ({
          id: t.id,
          merchant: t.merchant ?? t.merchant_raw ?? "Spend",
          amount: money(t.amount, t.currency),
          node: <TxnForm txn={t} categories={categories} households={households} projects={projects} trips={trips} returnTo="/review" mode="review" />,
        }))}
      />
    </Shell>
  );
}
