import type { IncomingEmail, ParseResult, Parser, ParsedTxn } from "./types";
import { compactBody, currencyFromSymbol, flatten, fromDomain, parseAmount, parseSgtDate } from "./text";

const ok = (parser: string, txns: ParsedTxn[]): ParseResult => ({ type: "transaction", parser, txns });
const ignore = (parser: string, reason: string): ParseResult => ({ type: "ignored", parser, reason });

function money(currency: string | null | undefined, raw: string | undefined) {
  const amount = raw ? parseAmount(raw) : Number.NaN;
  if (!currency || Number.isNaN(amount)) return null;
  return { currency, amount };
}

/**
 * Paying a credit card: UOB Cards, "HSBC CC", "CIMB CC", Citibank (its card accounts),
 * Amex, "... Credit Card". Bills to utilities etc. stay as spending.
 */
export function isCardPayee(payee: string): boolean {
  return /\b(cc|credit ?cards?|cards|card|citi(bank)?|amex|american express|diners)\b/i.test(payee);
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

    // Bill payments: "You made/scheduled a bill payment(s) of SGD 2377.83 to UOB Cards on your
    // a/c ending 0856 at 1:13PM SGT, 28 Nov 26. Bill ref: ending 9742."
    m = /You made(?:\/scheduled)? a bill payment\(?s?\)? of ([A-Z]{3}) ?([\d,]+\.\d{2}) to (.+?) on your a\/c ending (\d{4}) at (\d{1,2}:\d{2}\s?[AP]M) SGT, (\d{1,2} [A-Za-z]{3} \d{2,4})\.(?:\s*Bill ref: ending (\w+))?/i.exec(t);
    if (m) {
      const mo = money(m[1], m[2]);
      if (!mo) return ignore("uob", "unreadable amount");
      const payee = m[3]!.trim();
      const card = isCardPayee(payee);
      return ok("uob", [{
        ...mo,
        occurredAt: parseSgtDate(m[6]!, m[5]) ?? e.date,
        kind: card ? "card_payment" : "spend",
        merchantRaw: card && m[7] ? `${payee} ••${m[7]}` : payee,
        counterpartyType: "business",
        paymentMethod: `UOB a/c ${m[4]}`,
        role: "rail",
        description: m[7] ? `Bill ref ending ${m[7]}` : undefined,
      }]);
    }

    // Funds transfers: "You made/scheduled a funds transfer(s) of SGD 760.70 to CITIBANK a/c ending 3064
    // from your a/c ending 0856 at 1:09PM SGT, 28 Nov 26." To a card account = card payment.
    m = /You made(?:\/scheduled)? a funds transfer\(?s?\)? of ([A-Z]{3}) ?([\d,]+\.\d{2}) to (.+?) a\/c ending (\w+) from your a\/c ending (\d{4}) at (\d{1,2}:\d{2}\s?[AP]M) SGT, (\d{1,2} [A-Za-z]{3} \d{2,4})/i.exec(t);
    if (m) {
      const mo = money(m[1], m[2]);
      if (!mo) return ignore("uob", "unreadable amount");
      const bank = m[3]!.trim();
      const card = isCardPayee(bank);
      return ok("uob", [{
        ...mo,
        occurredAt: parseSgtDate(m[7]!, m[6]) ?? e.date,
        kind: card ? "card_payment" : "transfer",
        merchantRaw: `${bank} ••${m[4]}`,
        counterpartyType: card ? "business" : "unknown",
        paymentMethod: `UOB a/c ${m[5]}`,
        role: "rail",
      }]);
    }
    if (/Your FAST funds transfer to .+ is successful/i.test(t)) {
      return ignore("uob", "transfer success confirmation (amount comes in a separate alert)");
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
    const t = flatten(compactBody(e.text));
    // Headline, with or without a leading "#" (Gmail's plain text has none):
    // "50,000 IDR is now in Tania Devina's account." / "... is now in your account."
    const head = /(?:^|[\s#|])([\d][\d,.]*)\s*([A-Z]{3}) is now in (?:(.+?)['’]s|your) account/.exec(t);
    if (!head) return ignore("wise", "not a transfer receipt");
    // "Amount: 4.47 SGD": what left your account, fee included. Missing in some emails.
    const det = /Amount:?\s*([\d][\d,.]*)\s*([A-Z]{3})/.exec(t);
    const no = /Transfer Number:?\s*#?(\d{6,})/.exec(t)?.[1] ?? /#(\d{6,})/.exec(e.subject)?.[1];
    const recipient = head[3]?.trim();
    const received = `${head[1]} ${head[2]}`;
    // Without the paid amount, use what arrived; the bank top-up leg supplies the SGD later.
    const mo = (det ? money(det[2], det[1]) : null) ?? money(head[2], head[1]);
    if (!mo) return ignore("wise", "unreadable amount");
    const org = recipient && /\b(yayasan|foundation|fund|charity|church|temple|masjid|mosque|pt|ltd|inc|llc|gereja|panti)\b/i.test(recipient);
    return ok("wise", [{
      ...mo,
      occurredAt: e.date,
      kind: "spend",
      merchantRaw: recipient ? `Wise to ${recipient}` : "Wise to own account",
      counterpartyType: recipient ? (org ? "business" : "individual") : "unknown",
      paymentMethod: "Wise",
      role: "receipt",
      description: `Received ${received}${no ? ` · Wise #${no}` : ""}`,
    }]);
  },
};

// ---------------------------------------------------------------------------
// Citibank (alerts@citibank.com.sg)
//   "Credit Card Payment Received Alert … Citi Cash Back+ Card: Card Number : XXXX-XXXX-XXXX-3064
//    Transaction Date : 28/11/2026 Transaction Amount : SGD 760.70"
//   "there is a charge made on your Citi PremierMiles Card: Account Number : XXXX-…-8630
//    Transaction date : 28/11/26 Transaction time : 14:26:51 Transaction amount : IDR69000.00
//    Transaction details : HIJOO SALAD PANGLIMA P JAKARTA SLT IDN"
// ---------------------------------------------------------------------------
export const citi: Parser = {
  id: "citi",
  matches: (e) => fromDomain(e.from, "citibank.com.sg") || fromDomain(e.from, "citi.com"),
  parse(e) {
    const t = flatten(compactBody(e.text));
    const cardName = /on your (Citi [^:]+?Card)\s*:/i.exec(t)?.[1]?.trim() ?? "Citi card";
    const last4 = /(?:Card|Account) Number\s*:\s*X{4}-X{4}-X{4}-?\s*(\d{4})/i.exec(t)?.[1];
    const amt = /Transaction amount\s*:\s*([A-Z]{3})\s?([\d,]+(?:\.\d{1,2})?)/i.exec(t);
    const date = /Transaction date\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i.exec(t);
    const time = /Transaction time\s*:\s*(\d{1,2}:\d{2})(?::\d{2})?/i.exec(t)?.[1];
    const occurredAt = (() => {
      if (!date) return e.date;
      const y = date[3]!.length === 2 ? `20${date[3]}` : date[3]!;
      const iso = new Date(`${y}-${date[2]!.padStart(2, "0")}-${date[1]!.padStart(2, "0")}T${time ?? "12:00"}:00+08:00`);
      if (Number.isNaN(iso.getTime())) return e.date;
      // Same day as the email: keep the email's exact time when the alert has none.
      return time ? iso.toISOString() : sameDayOrEmail(iso.toISOString(), e.date);
    })();
    const method = `${cardName}${last4 ? ` ••${last4}` : ""}`;

    if (/payment received/i.test(e.subject + " " + t)) {
      const mo = amt ? money(amt[1], amt[2]) : null;
      if (!mo) return ignore("citi", "payment notice without an amount");
      return ok("citi", [{
        ...mo, occurredAt, kind: "card_payment", merchantRaw: method, counterpartyType: "business",
        paymentMethod: method, role: "receipt", description: "Card payment received",
      }]);
    }
    if (/charge made on your|Credit Card\/Ready Credit Transaction/i.test(e.subject + " " + t)) {
      const mo = amt ? money(amt[1], amt[2]) : null;
      const what = /Transaction details\s*:\s*(.+?)(?:\s+Thank you|\s+Citibank Online|$)/i.exec(t)?.[1]?.trim();
      if (!mo || !what) return ignore("citi", "card alert without amount or merchant");
      return ok("citi", [{
        ...mo, occurredAt, kind: "spend", merchantRaw: what, counterpartyType: "business", paymentMethod: method, role: "rail",
      }]);
    }
    return ignore("citi", "account notice");
  },
};

export const PARSERS: Parser[] = [uob, ocbc, tada, grab, shopee, stripe, simba, coinhako, wise, citi];

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
