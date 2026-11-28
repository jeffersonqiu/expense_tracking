/** Helpers for reading amounts and dates out of email text. */

const SYMBOLS: Record<string, string> = {
  "S$": "SGD",
  SGD: "SGD",
  "US$": "USD",
  USD: "USD",
  $: "USD",
  Rp: "IDR",
  IDR: "IDR",
  "€": "EUR",
  EUR: "EUR",
  "£": "GBP",
  GBP: "GBP",
  RM: "MYR",
  MYR: "MYR",
  "¥": "JPY",
  JPY: "JPY",
  "A$": "AUD",
  AUD: "AUD",
};

export function currencyFromSymbol(sym: string): string | null {
  return SYMBOLS[sym.trim()] ?? null;
}

/** "1,234.50" -> 1234.5 ; returns NaN when not a number. */
export function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100) / 100;
}

/** Collapse whitespace and table pipes so regexes work on flattened text. */
export function flatten(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthNum(m: string): number | null {
  return MONTHS[m.slice(0, 3).toLowerCase()] ?? null;
}

function fullYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

function to24h(time: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i.exec(time.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return [h, min];
}

/** Build an ISO timestamp for a Singapore local date/time (UTC+8). */
export function sgtIso(y: number, mo: number, d: number, h = 12, mi = 0): string | null {
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d, h - 8, mi);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Parse common Singapore bank date formats as SGT:
 *  "15 Nov 26", "15 Nov 2026", "15-Nov-2026", "11 November 2026",
 *  "15-11-2026", "03/11/26" (day first). Optional time "9:12AM", "11:59 AM", "12:41:57".
 */
export function parseSgtDate(date: string, time?: string): string | null {
  const s = date.trim();
  let y = 0, mo = 0, d = 0;
  let m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2,4})$/.exec(s);
  if (m) {
    d = Number(m[1]);
    mo = monthNum(m[2]!) ?? 0;
    y = fullYear(m[3]!);
  } else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s))) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = fullYear(m[3]!);
  } else if ((m = /^([A-Za-z]{3,9}) (\d{1,2}), (\d{4})$/.exec(s))) {
    mo = monthNum(m[1]!) ?? 0;
    d = Number(m[2]);
    y = Number(m[3]);
  } else {
    return null;
  }
  const hm = time ? to24h(time) : null;
  return sgtIso(y, mo, d, hm?.[0] ?? 12, hm?.[1] ?? 0);
}

export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1]! : from).trim().toLowerCase();
}

export function senderDomain(from: string): string {
  const addr = senderAddress(from);
  return addr.slice(addr.indexOf("@") + 1);
}

/** True when the sender's domain is `domain` or a subdomain of it. */
export function fromDomain(from: string, domain: string): boolean {
  const d = senderDomain(from);
  return d === domain || d.endsWith("." + domain);
}

/** Any money-looking token, e.g. "S$12.30", "SGD 5", "13.50 SGD", "Rp294,500.00". */
export const MONEY_RE =
  /(?:\b(?:SGD|USD|IDR|EUR|GBP|MYR|JPY|AUD)\s?\d[\d,]*(?:\.\d{1,2})?\b|(?:S\$|US\$|A\$|Rp|RM|€|£|¥|\$)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\s?(?:SGD|USD|IDR|EUR|GBP|MYR)\b)/;

/** Does the amount appear verbatim in the text (guards against invented numbers)? */
export function amountAppearsIn(text: string, amount: number): boolean {
  const variants = new Set<string>();
  const fixed = amount.toFixed(2);
  variants.add(fixed);
  variants.add(Number(fixed).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  if (Number.isInteger(amount)) {
    variants.add(String(amount));
    variants.add(amount.toLocaleString("en-US"));
  }
  const flat = text.replace(/\s+/g, " ");
  for (const v of variants) {
    const re = new RegExp(`(^|[^\\d.,])${v.replace(/[.,]/g, (c) => "\\" + c)}(?![\\d]|[.,]\\d)`);
    if (re.test(flat)) return true;
  }
  return false;
}

/**
 * Email body for the AI: drop invisible characters, empty table cells and blank
 * runs (Wise and bank emails pad the top with hundreds of them), so the real
 * content fits in what the model reads.
 */
export function compactBody(text: string): string {
  return text
    .replace(/[​-‍⁠﻿͏­᠎]/g, "")
    .replace(/ /g, " ")
    .replace(/^[\s|]*$/gm, "")        // lines that are only pipes/spaces
    .replace(/\|\s*\|/g, "|")          // empty table cells
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
