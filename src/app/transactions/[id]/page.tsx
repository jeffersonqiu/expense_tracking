import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/server/context";
import { Shell, Header } from "../../ui/Shell";
import { IconChevronLeft } from "../../ui/Icons";
import { TxnForm, type TxnRow } from "../../TxnForm";

const STATUS: Record<string, string> = { pending: "Waiting for review", confirmed: "Accepted", rejected: "Rejected" };

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, uid, categories, households, pendingCount } = await getContext();
  const { data } = await db.from("transactions")
    .select("*, source_emails(subject, from_address, body_text), shared_shares(person_name, amount, settled_at)")
    .eq("id", id).eq("user_id", uid).maybeSingle();
  if (!data) notFound();
  const t = data as TxnRow;
  return (
    <Shell active="activity" pending={pendingCount}>
      <Link href="/transactions" className="btn plain" style={{ marginLeft: -8 }}><IconChevronLeft />Activity</Link>
      <Header title="Transaction" sub={STATUS[t.status]} />
      <TxnForm txn={t} categories={categories} households={households} returnTo="/transactions" mode="edit" />
    </Shell>
  );
}
