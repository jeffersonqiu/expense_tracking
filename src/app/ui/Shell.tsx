import Link from "next/link";
import { IconGear, IconHouse, IconInbox, IconList, IconHeart, IconPeople, IconPlane, IconSummary, IconWallet } from "./Icons";

export type Section = "summary" | "review" | "activity" | "household" | "trips" | "giving" | "balances" | "settings";

const NAV: { id: Section; href: string; label: string; Icon: (p: { className?: string }) => React.ReactNode; tab: boolean }[] = [
  { id: "summary", href: "/", label: "Summary", Icon: IconSummary, tab: true },
  { id: "review", href: "/review", label: "Review", Icon: IconInbox, tab: true },
  { id: "activity", href: "/transactions", label: "Activity", Icon: IconList, tab: true },
  { id: "household", href: "/household", label: "Household", Icon: IconHouse, tab: true },
  { id: "trips", href: "/trips", label: "Trips", Icon: IconPlane, tab: true },
  { id: "giving", href: "/giving", label: "Giving", Icon: IconHeart, tab: false },
  { id: "balances", href: "/balances", label: "Balances", Icon: IconPeople, tab: false },
  { id: "settings", href: "/settings", label: "Settings", Icon: IconGear, tab: false },
];

/** App chrome: translucent sidebar on desktop, tab bar on phones. */
export function Shell({ active, pending, children }: { active: Section; pending: number; children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Main">
        <div className="app"><span className="app-icon"><IconWallet /></span>Expenses</div>
        {NAV.map(({ id, href, label, Icon }) => (
          <Link key={id} href={href} className="navlink" aria-current={active === id ? "page" : undefined}>
            <Icon />
            {label}
            {id === "review" && pending > 0 && <span className="count">{pending}</span>}
          </Link>
        ))}
        <div className="spacer" />
        <form action="/auth/signout" method="post">
          <button className="btn plain small" style={{ justifyContent: "flex-start", color: "var(--label-2)" }}>Sign out</button>
        </form>
      </aside>
      <main className="content">
        <div className="page">{children}</div>
      </main>
      <nav className="tabbar" aria-label="Main">
        {NAV.filter((n) => n.tab).map(({ id, href, label, Icon }) => (
          <Link key={id} href={href} className="tab" aria-current={active === id ? "page" : undefined}>
            <Icon />
            {label}
            {id === "review" && pending > 0 && <span className="dot">{pending > 99 ? "99+" : pending}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Header({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="header">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </header>
  );
}
