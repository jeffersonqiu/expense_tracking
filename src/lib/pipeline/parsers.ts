import type { IncomingEmail, ParseResult, Parser, ParsedTxn } from "./types";
import { currencyFromSymbol, flatten, fromDomain, parseAmount, parseSgtDate } from "./text";

const ok = (parser: string, txns: ParsedTxn[]): ParseResult => ({ type: "transaction", parser, txns });
const ignore = (parser: string, reason: string): ParseResult => ({ type: "ignored", parser, reason });

function money(currency: string | null | undefined, raw: string | undefined) {
  const amount = raw ? parseAmount(raw) : Number.NaN;
  if (!currency || Number.isNaN(amount)) return null;
  return { currency, amount };
}

// ---------------------------------------------------------------------------
// UOB (unialerts@uobgroup.com)
// ---------------------------------------------------------------------------
export const uob: Parser = {
  id: "uob",
  matches: (e) => fromDomain(e.from, "uobgroup.com"),
  parse(e) {
    const t = flatten(e.text);

    let m = /You made a PayNow transfer of ([A-Z]{3}) ([\d,]+\.\d{2}) to (.+?) \((Mobile|UEN|NRIC|VPA|Account)[^)]*\) on your a\/c ending (\d{4}) at (\d{1,2}:\d{2}\s?[AP]M) SGT, (\d{1,2} [A-Za-z]{3} \d{2,4})/.exec(t);
    if (m) {
      const mo = money(m[1], m[2]);
      if (!mo) return ignore("uob", "unreadable amount");
      return ok("uob", [{
        ...mo,
        occurredAt: parseSgtDate(m[7]!, m[6]) ?? e.date,
        kind: "spend",
        merchantRaw: m[3]!.trim(),
        counterpartyType: m[4] === "UEN" ? "business" : m[4] === "Mobile" || m[4] === "NRIC" ? "individual" : "unknown",
        paymentMethod: `UOB PayNow a/c ${m[5]}`,
        role: "rail",
      }]);
    }

    if (/Your PayNow transfer to .+ on .+ is successful/.test(t)) {
      return ignore("uob", "PayNow success confirmation (amount comes in a separate alert)");
    }
    if (/has been reversed/.test(t)) return ignore("uob", "card hold reversed");

    m = /A refund of ([A-Z]{3}) ?([\d,]+\.\d{2}) from (.+?) has been made to your UOB card ending (\d{4}) on (\d{1,2} [A-Za-z]{3} \d{4})/.exec(t);
    if (m) {
      const mo = money(m[1], m[2]);
      if (!mo) return ignore("uob", "unreadable amount");
      return ok("uob", [{
        ...mo,
        occurredAt: parseSgtDate(m[5]!) ?? e.date,
        kind: "refund",
        merchantRaw: m[3]!.trim(),
        counterpartyType: "business",
        paymentMethod: `UOB card ${m[4]}`,
        role: "rail",
      }]);
    }

    m = /A transaction of ([A-Z]{3}) ?([\d,]+\.\d{2}) was made with your UOB Card ending (\d{4}) on (\d{2}\/\d{2}\/\d{2,4}) at (.+?)\. If unauthori[sz]ed/i.exec(t);
    if (m) {
      const mo = money(m[1], m[2]);
      if (!mo) return ignore("uob", "unreadable amount");
      return ok("uob", [{
        ...mo,
        occurredAt: sameDayOrEmail(parseSgtDate(m[4]!), e.date),
        kind: "spend",
        merchantRaw: m[5]!.trim(),
        counterpartyType: "business",
        paymentMethod: `UOB card ${m[3]}`,
        role: "rail",
      }]);
    }

    // Alternative wording: "A transaction of 10.60 SGD made with your UOB card ending 9742 on 15 Nov 26, 9:47AM at MERCHANT."
    m = /A transaction of ([\d,]+\.\d{2}) ([A-Z]{3}) made with your UOB card ending (\d{4}) on (\d{1,2} [A-Za-z]{3} \d{2,4}), (\d{1,2}:\d{2}\s?[AP]M) at (.+?)\.(?: |$)/i.exec(t);
    if (m) {
      const mo = money(m[2], m[1]);
      if (!mo) return ignore("uob", "unreadable amount");
      return ok("uob", [{
        ...mo,
        occurredAt: parseSgtDate(m[4]!, m[5]) ?? e.date,
        kind: "spend",
        merchantRaw: m[6]!.trim(),
        counterpartyType: "business",
        paymentMethod: `UOB card ${m[3]}`,
        role: "rail",
      }]);
    }

    if (/eStatement|eAdvice|statement is ready/i.test(t)) return ignore("uob", "statement notice");
    return { type: "unknown" };
  },
};

/** Card alerts carry only a date; keep the email's time when the dates agree. */
function sameDayOrEmail(parsed: string | null, emailDate: string): string {
  if (!parsed) return emailDate;
  const sgtDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
  return sgtDay(parsed) === sgtDay(emailDate) ? emailDate : parsed;
}

// ---------------------------------------------------------------------------
// OCBC (notifications@ocbc.com) – Google Pay / PayNow transfers
// ---------------------------------------------------------------------------
export const ocbc: Parser = {
  id: "ocbc",
  matches: (e) => fromDomain(e.from, "ocbc.com"),
  parse(e) {
    const t = flatten(e.text);
    const m = /([A-Z]{3}) ?([\d,]+\.\d{2}) was sent to (.+?) using (his\/her mobile number|.+?) .*?from the account you linked to Google Pay/.exec(t);
    if (m) {
      const mo = money(m[1], m[2]);
      if (!mo) return ignore("ocbc", "unreadable amount");
      const d = /Date of transfer: (\d{1,2}-[A-Za-z]{3}-\d{4})/.exec(t);
      const tm = /Time of transfer: (\d{1,2}:\d{2}\s?[AP]M)/.exec(t);
      return ok("ocbc", [{
        ...mo,
        occurredAt: (d && parseSgtDate(d[1]!, tm?.[1])) ?? e.date,
        kind: "spend",
        merchantRaw: m[3]!.trim(),
        counterpartyType: m[4]!.includes("mobile") ? "individual" : "unknown",
        paymentMethod: "OCBC Google Pay",
        role: "rail",
      }]);
    }
    if (/e-Statement|eStatement|statement/i.test(t + " " + e.subject)) return ignore("ocbc", "statement notice");
    return { type: "unknown" };
  },
};

// ---------------------------------------------------------------------------
// TADA ride receipts (hailing@tada.global)
// ---------------------------------------------------------------------------
export const tada: Parser = {
  id: "tada",
  matches: (e) => fromDomain(e.from, "tada.global"),
  parse(e) {
    const t = flatten(e.text);
    const m = /Total Fee Charged\s*\*?([\d,]+\.\d{2}) ([A-Z]{3})/.exec(t);
    if (!m) return /receipt/i.test(e.subject) ? ignore("tada", "receipt without total") : { type: "unknown" };
    const mo = money(m[2], m[1]);
    if (!mo) return ignore("tada", "unreadable amount");
    const d = /Pick-up Date and Time \| (\d{2}-\d{2}-\d{4}) (\d{2}:\d{2})/.exec(t);
    const pm = /Payment Method \| ([^|]+?) \|/.exec(t);
    return ok("tada", [{
      ...mo,
      occurredAt: (d && parseSgtDate(d[1]!, d[2])) ?? e.date,
      kind: "spend",
      merchantRaw: "TADA",
      counterpartyType: "business",
      paymentMethod: pm ? `TADA ${pm[1]!.trim()}` : undefined,
      role: "receipt",
      categoryHint: "Transport",
    }]);
  },
};

// ---------------------------------------------------------------------------
// Grab e-receipts (no-reply@grab.com)
// ---------------------------------------------------------------------------
export const grab: Parser = {
  id: "grab",
  matches: (e) => fromDomain(e.from, "grab.com"),
  parse(e) {
    if (!/receipt/i.test(e.subject)) return ignore("grab", "not a receipt");
    const t = flatten(e.text);
    const m = /Total Paid \|? ?(S\$|RM|Rp|\$)\s?([\d,]+\.\d{2})/.exec(t) ?? /Total\s*\|?\s*(S\$|RM|Rp|\$)\s?([\d,]+\.\d{2})/.exec(t);
    if (!m) return ignore("grab", "receipt without total");
    const mo = money(currencyFromSymbol(m[1]!), m[2]);
    if (!mo) return ignore("grab", "unreadable amount");
    const isRide = /Car or taxi|Hope you enjoyed your ride|Picked up on/i.test(t);
    const isFood = /GrabFood|food order|Order Summary|restaurant/i.test(t);
    const card = /Paid by \|[\s|]*(\d{4}) \|/.exec(t);
    return ok("grab", [{
      ...mo,
      occurredAt: e.date,
      kind: "spend",
      merchantRaw: isRide ? "Grab (ride)" : isFood ? "GrabFood" : "Grab",
      counterpartyType: "business",
      paymentMethod: card ? `card ${card[1]}` : undefined,
      role: "receipt",
      categoryHint: isRide ? "Transport" : isFood ? "Food" : undefined,
    }]);
  },
};

// ---------------------------------------------------------------------------
// Shopee (info@mail.shopee.sg)
// ---------------------------------------------------------------------------
export const shopee: Parser = {
  id: "shopee",
  matches: (e) => fromDomain(e.from, "shopee.sg"),
  parse(e) {
    if (!/payment has been confirmed/i.test(e.subject)) return ignore("shopee", "order status update");
    const t = flatten(e.text);
    const m = /Amount Paid: \| (S\$)\s?([\d,]+\.\d{2})/.exec(t) ?? /Total Payment: \| (S\$)\s?([\d,]+\.\d{2})/.exec(t);
    if (!m) return ignore("shopee", "payment email without amount");
    const mo = money(currencyFromSymbol(m[1]!), m[2]);
    if (!mo) return ignore("shopee", "unreadable amount");
    const seller = /Seller: \| (\S+)/.exec(t);
    const pm = /Payment Method: \| ([^|]+?) \|/.exec(t);
    const pd = /Payment Date: \| (\d{1,2} [A-Za-z]{3} \d{4}) (\d{2}:\d{2})/.exec(t);
    const item = /\| 1\. (.+?) \|/.exec(t);
    return ok("shopee", [{
      ...mo,
      occurredAt: (pd && parseSgtDate(pd[1]!, pd[2])) ?? e.date,
      kind: "spend",
      merchantRaw: seller ? `Shopee - ${seller[1]}` : "Shopee",
      counterpartyType: "business",
      paymentMethod: pm ? `Shopee ${pm[1]!.trim()}` : undefined,
      role: "receipt",
      categoryHint: "Shopping",
      description: item?.[1]?.slice(0, 120),
    }]);
  },
};

// ---------------------------------------------------------------------------
// Stripe receipts (receipts+acct_...@stripe.com) – any merchant using Stripe
// ---------------------------------------------------------------------------
export const stripe: Parser = {
  id: "stripe",
  matches: (e) => fromDomain(e.from, "stripe.com"),
  parse(e) {
    const t = flatten(e.text);
    const merchant = /Receipt from (.+?) (?:Receipt )?#/.exec(t)?.[1] ?? /Your (.+?) receipt/.exec(e.subject)?.[1];
    const m = /Amount paid ([^\d\s]{1,3}|[A-Z]{3}\s)?\s?([\d,]+\.\d{2})/.exec(t);
    if (!m || !merchant) return { type: "unknown" };
    const mo = money(m[1] ? currencyFromSymbol(m[1]) : "USD", m[2]);
    if (!mo) return ignore("stripe", "unknown currency");
    if (/refund/i.test(e.subject)) {
      return ok("stripe", [{ ...mo, occurredAt: e.date, kind: "refund", merchantRaw: merchant.trim(), counterpartyType: "business", role: "receipt" }]);
    }
    return ok("stripe", [{
      ...mo,
      occurredAt: e.date,
      kind: "spend",
      merchantRaw: merchant.trim(),
      counterpartyType: "business",
      role: "receipt",
    }]);
  },
};

// ---------------------------------------------------------------------------
// SIMBA mobile bills
// ---------------------------------------------------------------------------
export const simba: Parser = {
  id: "simba",
  matches: (e) => fromDomain(e.from, "simba.sg"),
  parse(e) {
    const t = flatten(e.text);
    const m = /Amount Paid: \| ([A-Z]{3}) ([\d,]+(?:\.\d{2})?)/.exec(t);
    if (!m) return ignore("simba", "no payment amount");
    const mo = money(m[1], m[2]);
    if (!mo) return ignore("simba", "unreadable amount");
    const d = /Payment Date: \| (\d{2}-\d{2}-\d{4})/.exec(t);
    return ok("simba", [{
      ...mo,
      occurredAt: sameDayOrEmail(d ? parseSgtDate(d[1]!) : null, e.date),
      kind: "spend",
      merchantRaw: "SIMBA Telecom",
      counterpartyType: "business",
      role: "receipt",
      categoryHint: "Bills",
    }]);
  },
};

// ---------------------------------------------------------------------------
// Coinhako crypto purchases → investment, not spending
// ---------------------------------------------------------------------------
export const coinhako: Parser = {
  id: "coinhako",
  matches: (e) => fromDomain(e.from, "coinhako.com"),
  parse(e) {
    const t = flatten(e.text);
    const buy = /successfully purchased ([\d.]+) ([A-Z]{2,6})/.exec(t);
    const paid = /YOU PAID .*?Amount: \| (S\$|US\$|\$)\s?([\d,]+(?:\.\d{1,2})?)/.exec(t);
    if (!buy || !paid) return ignore("coinhako", "not a purchase receipt");
    const mo = money(currencyFromSymbol(paid[1]!), paid[2]);
    if (!mo) return ignore("coinhako", "unreadable amount");
    return ok("coinhako", [{
      ...mo,
      occurredAt: e.date,
      kind: "investment",
      merchantRaw: "Coinhako",
      counterpartyType: "business",
      paymentMethod: "Coinhako Wallet",
      role: "receipt",
      categoryHint: "Invest",
      description: `Buy ${buy[1]} ${buy[2]}`,
    }]);
  },
};

// ---------------------------------------------------------------------------
// Wise (noreply@wise.com): "Transfer sent". The amount is what left your
// account (fee included), so the SGD total matches what you actually paid.
// ---------------------------------------------------------------------------
export const wise: Parser = {
  id: "wise",
  matches: (e) => fromDomain(e.from, "wise.com"),
  parse(e) {
    if (!/^transfer sent/i.test(e.subject.trim())) {
      return /paused|cancel|refund|verify/i.test(e.subject) ? ignore("wise", "transfer status update") : { type: "unknown" };
    }
    const t = flatten(e.text);
    const head = /#\s*([\d,.]+)\s+([A-Z]{3}) is now in (?:(.+?)['’]s|your) account\./.exec(t);
    const det = /Amount:\s*([\d,.]+)\s+([A-Z]{3})(?:\s+Rate:[^W]*?)?\s+Wise fee:\s*([\d,.]+)\s+([A-Z]{3})/.exec(t);
    const no = /Transfer Number:\s*#(\d+)/.exec(t)?.[1];
    if (!head || !det) return ignore("wise", "not a transfer receipt");
    const mo = money(det[2], det[1]);
    if (!mo) return ignore("wise", "unreadable amount");
    const recipient = head[3]?.trim();
    const received = `${head[1]} ${head[2]}`;
    const org = recipient && /\b(yayasan|foundation|fund|charity|church|temple|masjid|mosque|pt|ltd|inc|llc|gereja|panti)\b/i.test(recipient);
    return ok("wise", [{
      ...mo,
      occurredAt: e.date,
      // To your own account: money moved, not spent (change it on the card if it was for someone).
      kind: recipient ? "spend" : "transfer",
      merchantRaw: recipient ? `Wise to ${recipient}` : "Wise to own account",
      counterpartyType: recipient ? (org ? "business" : "individual") : "unknown",
      paymentMethod: "Wise",
      role: "rail",
      description: `Received ${received}${no ? ` · Wise #${no}` : ""}`,
    }]);
  },
};

export const PARSERS: Parser[] = [uob, ocbc, tada, grab, shopee, stripe, simba, coinhako, wise];

export function runParsers(email: IncomingEmail): ParseResult {
  for (const p of PARSERS) {
    if (p.matches(email)) {
      const r = p.parse(email);
      if (r.type !== "unknown") return r;
      return { type: "unknown" };
    }
  }
  return { type: "unknown" };
}
