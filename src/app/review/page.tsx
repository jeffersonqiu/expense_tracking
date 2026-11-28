import { getContext } from "@/lib/server/context";
import { Shell, Header } from "../ui/Shell";
import { IconCheckCircle, IconSparkle } from "../ui/Icons";
import { TxnForm, type TxnRow } from "../TxnForm";
import { Flash } from "../Flash";
import { suggestCategories, undoReview } from "../actions";
import { SwipeCard } from "./SwipeCard";
import { money } from "@/lib/format";

export const maxDuration = 60;

export const metadata = { title: "Review · Expenses" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, categories, households, projects, pendingCount } = await getContext();
  const { data } = await db
    .from("transactions")
    .select("*, source_emails(subject, from_address, body_text), shared_shares(person_name, amount, settled_at)")
    .eq("user_id", uid).eq("status", "pending").is("duplicate_of", null)
    .order("occurred_at", { ascending: true }).limit(20);
  const rows = (data ?? []) as TxnRow[];
  const { data: recent } = await db.from("transactions")
    .select("id, merchant, amount, currency, kind, status, reviewed_at")
    .eq("user_id", uid).in("status", ["confirmed", "rejected"]).is("duplicate_of", null)
    .not("reviewed_at", "is", null).gte("reviewed_at", new Date(Date.now() - 12 * 3600e3).toISOString())
    .order("reviewed_at", { ascending: false }).limit(3);
  return (
    <Shell active="review" pending={pendingCount}>
      <Header title="Review" sub={pendingCount > 0 ? `${pendingCount} to go · oldest first` : undefined}>
        {rows.some((r) => !r.category_id && r.kind !== "transfer") && (
          <form action={suggestCategories}><button className="btn"><IconSparkle />Suggest categories</button></form>
        )}
      </Header>
      <Flash error={flash.error} ok={flash.ok} />
      {(recent ?? []).length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 4 }}>Just reviewed</div>
          <div className="list" style={{ marginBottom: 16 }}>
            {(recent ?? []).map((r) => (
              <div className="row" key={r.id} style={{ minHeight: 48 }}>
                <span className={`pill ${r.status === "confirmed" ? "good" : "bad"}`}>{r.status === "confirmed" ? "Accepted" : "Rejected"}</span>
                <div className="main"><div className="title" style={{ fontWeight: 400 }}>{r.merchant ?? "—"}</div></div>
                <div className="trail num small muted">{money(r.amount, r.currency)}</div>
                <form action={undoReview} className="inline">
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn plain">Undo</button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
      {rows.length > 0 && <p className="swipe-tip small muted">Swipe a card right to accept, left to reject.</p>}
      {rows.length === 0 ? (
        <div className="empty-state">
          <IconCheckCircle />
          <h2>You&apos;re all caught up</h2>
          <p>New spends from Gmail will appear here within a few minutes.</p>
        </div>
      ) : (
        rows.map((t) => (
          <SwipeCard key={t.id}>
            <TxnForm txn={t} categories={categories} households={households} projects={projects} returnTo="/review" mode="review" />
          </SwipeCard>
        ))
      )}
    </Shell>
  );
}
