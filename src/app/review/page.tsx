import { getContext } from "@/lib/server/context";
import { Shell, Header } from "../ui/Shell";
import { IconCheckCircle, IconSparkle } from "../ui/Icons";
import { TxnForm, type TxnRow } from "../TxnForm";
import { Flash } from "../Flash";
import { suggestCategories } from "../actions";

export const maxDuration = 60;

export const metadata = { title: "Review · Expenses" };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, categories, households, pendingCount } = await getContext();
  const { data } = await db
    .from("transactions")
    .select("*, source_emails(subject, from_address, body_text), shared_shares(person_name, amount, settled_at)")
    .eq("user_id", uid).eq("status", "pending").is("duplicate_of", null)
    .order("occurred_at", { ascending: true }).limit(20);
  const rows = (data ?? []) as TxnRow[];
  return (
    <Shell active="review" pending={pendingCount}>
      <Header title="Review" sub={pendingCount > 0 ? `${pendingCount} to go · oldest first` : undefined}>
        {rows.some((r) => !r.category_id && r.kind !== "transfer") && (
          <form action={suggestCategories}><button className="btn"><IconSparkle />Suggest categories</button></form>
        )}
      </Header>
      <Flash error={flash.error} ok={flash.ok} />
      {rows.length === 0 ? (
        <div className="empty-state">
          <IconCheckCircle />
          <h2>You&apos;re all caught up</h2>
          <p>New spends from Gmail will appear here within a few minutes.</p>
        </div>
      ) : (
        rows.map((t) => <TxnForm key={t.id} txn={t} categories={categories} households={households} returnTo="/review" mode="review" />)
      )}
    </Shell>
  );
}
