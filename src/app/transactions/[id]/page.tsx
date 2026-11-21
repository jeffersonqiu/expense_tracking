import { notFound } from "next/navigation";
import { getContext } from "@/lib/server/context";
import { Nav } from "../../Nav";
import { TxnForm, type TxnRow } from "../../TxnForm";

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
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <h1>Edit transaction <span className="pill">{t.status}</span></h1>
        <TxnForm txn={t} categories={categories} households={households} returnTo="/transactions" mode="edit" />
      </main>
    </>
  );
}
