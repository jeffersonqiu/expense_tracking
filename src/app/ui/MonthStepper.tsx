import Link from "next/link";
import { shiftMonth } from "@/lib/server/context";
import { IconChevronLeft, IconChevronRight } from "./Icons";

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-SG", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function MonthStepper({ ym, path, extra = "" }: { ym: string; path: string; extra?: string }) {
  return (
    <div className="stepper">
      <Link href={`${path}?m=${shiftMonth(ym, -1)}${extra}`} aria-label="Previous month"><IconChevronLeft /></Link>
      <span className="label">{monthLabel(ym)}</span>
      <Link href={`${path}?m=${shiftMonth(ym, 1)}${extra}`} aria-label="Next month"><IconChevronRight /></Link>
    </div>
  );
}
