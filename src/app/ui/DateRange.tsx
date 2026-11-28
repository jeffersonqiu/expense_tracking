"use client";
import { useState } from "react";

const DAY = 86400e3;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + "T00:00:00Z");
const label = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-SG", { ...o, timeZone: "UTC" }).format(parse(s));
const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

/**
 * One calendar for a date range: first tap sets From, second tap sets To.
 * Tapping again starts a new range; tapping before From moves From.
 * Submits as two hidden fields; a single tapped day is a one-day range.
 */
export function DateRange({ startName, endName, start: s0, end: e0, near }: {
  startName: string; endName: string; start?: string | null; end?: string | null; near?: string;
}) {
  const [start, setStart] = useState<string | null>(s0 ?? null);
  const [end, setEnd] = useState<string | null>(e0 ?? null);
  const first = parse((s0 ?? near ?? iso(new Date(Date.now() + 8 * 3600e3))).slice(0, 7) + "-01");
  const [month, setMonth] = useState(first);

  const tap = (d: string) => {
    if (!start || end) { setStart(d); setEnd(null); }
    else if (d < start) setStart(d);
    else setEnd(d);
  };
  const shift = (n: number) => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + n, 1)));

  const lead = (month.getUTCDay() + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(new Date(month.getTime() + i * DAY)))];
  const today = iso(new Date(Date.now() + 8 * 3600e3));
  const last = end ?? start;
  const days = start && end ? Math.round((parse(end).getTime() - parse(start).getTime()) / DAY) + 1 : null;

  return (
    <div className="range">
      <input type="hidden" name={startName} value={start ?? ""} />
      <input type="hidden" name={endName} value={last ?? ""} />
      <div className="range-sum" aria-live="polite">
        <div className={!start || end ? "on" : ""}><span>From</span>{start ? label(start, { weekday: "short", day: "numeric", month: "short" }) : "Tap a day"}</div>
        <div className={start && !end ? "on" : ""}><span>To</span>{end ? label(end, { weekday: "short", day: "numeric", month: "short" }) : start ? "Tap the last day" : "—"}</div>
        {days && <div className="range-len">{days} {days === 1 ? "day" : "days"}</div>}
      </div>
      <div className="range-head">
        <button type="button" className="btn plain icon" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <strong>{label(iso(month), { month: "long", year: "numeric" })}</strong>
        <button type="button" className="btn plain icon" onClick={() => shift(1)} aria-label="Next month">›</button>
      </div>
      <div className="range-grid" role="grid">
        {WEEK.map((w, i) => <div key={"w" + i} className="range-wd">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const inRange = start && last && d >= start && d <= last;
          const cls = [
            "range-day",
            inRange ? "in" : "",
            d === start ? "start" : "",
            d === last ? "end" : "",
            d === today ? "today" : "",
            d === near ? "near" : "",
          ].join(" ");
          return (
            <button type="button" key={d} className={cls} onClick={() => tap(d)} aria-pressed={!!inRange} aria-label={label(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>
              <span>{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
