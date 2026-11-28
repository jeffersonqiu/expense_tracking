import Link from "next/link";
import { getContext, monthRange } from "@/lib/server/context";
import { Shell, Header } from "../ui/Shell";
import { MonthStepper } from "../ui/MonthStepper";
import { IconChevronRight, IconDownload, IconPlus } from "../ui/Icons";
import { TxnForm } from "../TxnForm";
import { Flash } from "../Flash";
import { quickAdd } from "../actions";
import { money } from "@/lib/format";

export const metadata = { title: "Activity · Expenses" };

const ALLOC: Record<string, string> = { work: "Work", shared: "Shared", household: "Household" };

function dayKey(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
}
function dayLabel(key: string) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86400e3).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat("en-SG", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(key + "T00:00:00Z"));
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ m?: string; status?: string; error?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { db, uid, categories, households, projects, trips, pendingCount } = await getContext();
  const { ym, start, end } = monthRange(sp.m);
  const status = sp.status === "rejected" ? "rejected" : sp.status === "cards" ? "cards" : "confirmed";
  let q = db.from("transactions")
    .select("id, occurred_at, amount, currency, base_amount, base_currency, kind, merchant, category_id, allocation, payment_method")
    .eq("user_id", uid).eq("status", status === "rejected" ? "rejected" : "confirmed").gte("occurred_at", start).lt("occurred_at", end);
  q = status === "cards" ? q.eq("kind", "card_payment") : status === "confirmed" ? q.neq("kind", "card_payment") : q;
  const { data } = await q.order("occurred_at", { ascending: false }).limit(1000);
  const cat = new Map(categories.map((c) => [c.id, c.name]));

  const groups = new Map<string, NonNullable<typeof data>>();
  for (const t of data ?? []) {
    const k = dayKey(t.occurred_at);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }

  return (
    <Shell active="activity" pending={pendingCount}>
      <Header title="Activity">
        <MonthStepper ym={ym} path="/transactions" extra={status === "confirmed" ? "" : `&status=${status}`} />
        <a className="btn icon" href={`/api/export?m=${ym}`} aria-label="Export CSV" title="Export CSV"><IconDownload /></a>
      </Header>
      <Flash error={sp.error} ok={sp.ok} />

      <form action={quickAdd} className="card quickadd">
        <input name="text" placeholder="Quick add cash spend, e.g. “kopi 2.20”" required aria-label="Quick add" />
        <select name="payment" defaultValue="Cash" aria-label="Paid with">
          <option>Cash</option><option>GrabPay</option><option>Card</option><option>PayNow</option>
        </select>
        <button className="btn primary icon" aria-label="Add"><IconPlus /></button>
      </form>

      <div style={{ marginBottom: 4 }}>
        <div className="seg links" style={{ maxWidth: 380 }}>
          <Link href={`/transactions?m=${ym}`} aria-current={status === "confirmed" ? "page" : undefined}>Accepted</Link>
          <Link href={`/transactions?m=${ym}&status=cards`} aria-current={status === "cards" ? "page" : undefined}>Card payments</Link>
          <Link href={`/transactions?m=${ym}&status=rejected`} aria-current={status === "rejected" ? "page" : undefined}>Rejected</Link>
        </div>
      </div>

      {groups.size === 0 && <div className="list" style={{ marginTop: 12 }}><div className="row empty">Nothing here for this month.</div></div>}
      {[...groups.entries()].map(([k, rows]) => {
        const dayTotal = rows.reduce((s, t) => s + (t.kind === "spend" ? Number(t.base_amount ?? 0) : t.kind === "refund" ? -Number(t.base_amount ?? 0) : 0), 0);
        return (
          <section key={k}>
            <div className="day"><span>{dayLabel(k)}</span><span className="num">{dayTotal ? money(dayTotal, rows[0]!.base_currency) : ""}</span></div>
            <div className="list">
              {rows.map((t) => (
                <Link className="row indent" href={`/transactions/${t.id}`} key={t.id}>
                  <div className="avatar">{(t.merchant ?? "?").trim().charAt(0).toUpperCase()}</div>
                  <div className="main">
                    <div className="title">{t.merchant ?? "—"}</div>
                    <div className="subtitle">
                      {t.kind === "card_payment" ? t.payment_method ?? "Card payment" : t.kind !== "spend" && t.kind !== "refund" ? t.kind.charAt(0).toUpperCase() + t.kind.slice(1) : cat.get(t.category_id) ?? "Uncategorised"}
                      {ALLOC[t.allocation] ? ` · ${ALLOC[t.allocation]}` : ""}
                      {t.payment_method ? ` · ${t.payment_method}` : ""}
                    </div>
                  </div>
                  <div className="trail">
                    <div className={t.kind === "refund" ? "good" : undefined}>{t.kind === "refund" ? "+" : ""}{money(t.amount, t.currency)}</div>
                    {t.currency !== t.base_currency && <div className="subtitle">{money(t.base_amount, t.base_currency)}</div>}
                  </div>
                  <IconChevronRight className="chev" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <details className="addmore">
        <summary className="btn" style={{ width: "100%" }}><IconPlus />Add expense with details</summary>
        <TxnForm txn={null} categories={categories} households={households} projects={projects} trips={trips} returnTo="/transactions" mode="new" />
      </details>
    </Shell>
  );
}
