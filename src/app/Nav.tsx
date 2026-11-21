import Link from "next/link";

export function Nav({ pending }: { pending: number }) {
  return (
    <nav className="top">
      <Link href="/" className="brand">Expense Tracker</Link>
      <Link href="/review">Review{pending > 0 && <span className="badge">{pending}</span>}</Link>
      <Link href="/transactions">Transactions</Link>
      <Link href="/household">Household</Link>
      <Link href="/balances">Balances</Link>
      <Link href="/settings">Settings</Link>
      <form action="/auth/signout" method="post">
        <button className="btn link small">Sign out</button>
      </form>
    </nav>
  );
}
