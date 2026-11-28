import type { IncomingEmail, ParsedTxn } from "./types";
import type { Decider, Knowledge, TripBucket, TripOption } from "../ai/types";
import { runParsers } from "./parsers";
import { looksTransactional, prefilter } from "./filters";
import { amountAppearsIn } from "./text";
import { displayMerchant, isHouseholdUtility, keywordCategory, merchantKey } from "./categorize";

export interface ProcessContext {
  /** Facts and similar past decisions relevant to this spend (from the learning loop). */
  knowledge: (q: { merchantKey: string; merchantRaw: string; counterparty: string }) => Promise<Knowledge>;
  /** AI is optional: null when disabled or over budget. */
  ai: Decider | null;
  categories: string[];
  hasHousehold: boolean;
  /** The user's trips; only those near the spend's date are offered to the AI. */
  trips?: TripOption[];
}

const DAY = 86400e3;

/** Trips a spend could belong to: during the trip, or booked up to 6 months before it. */
export function nearbyTrips(trips: TripOption[], occurredAt: string): TripOption[] {
  const t = new Date(occurredAt).getTime();
  return trips.filter((tr) => {
    const start = new Date(tr.start + "T00:00:00+08:00").getTime();
    const end = new Date((tr.end ?? tr.start) + "T23:59:59+08:00").getTime() + (tr.end ? 2 * DAY : 21 * DAY);
    return t >= start - 180 * DAY && t <= end;
  });
}

/** Without AI: a spend dated inside a trip belongs to it; the bucket comes from the category. */
export function tripByDate(trips: TripOption[], occurredAt: string, category: string | null): { id: string; bucket: TripBucket } | null {
  const t = new Date(occurredAt).getTime();
  const hit = trips.find((tr) => {
    const start = new Date(tr.start + "T00:00:00+08:00").getTime();
    const end = tr.end ? new Date(tr.end + "T23:59:59+08:00").getTime() : start + 14 * DAY;
    return t >= start && t <= end;
  });
  if (!hit) return null;
  return { id: hit.id, bucket: category === "Hotels" ? "hotels" : category === "Travel" ? "transport" : "daily" };
}

/** What the AI (or the fallback rules) proposed, kept to compare with the final decision.
 *  `pot` is the household pot, or the giving branch when the allocation is giving. */
export interface Suggestion {
  category: string | null;
  allocation: string | null;
  pot: string | null;
  confidence: { category: number; allocation: number; pot: number; trip?: number };
  source: string;
  trip?: string | null;
  bucket?: TripBucket | null;
}

export interface Draft extends ParsedTxn {
  merchant: string;
  merchantKey: string;
  categoryName: string | null;
  allocation: string | null;
  confidence: number;
  classifier: string;
  needsManualAmount: boolean;
  householdPot: string | null;
  /** Giving branch (parents / regular / adhoc) when the allocation is giving. */
  givingKind: string | null;
  tripId: string | null;
  tripBucket: TripBucket | null;
  suggestion: Suggestion;
}

export interface ProcessOutcome {
  status: "transaction" | "ignored" | "rejected" | "needs_review";
  parser: string | null;
  reason: string | null;
  drafts: Draft[];
}

/** "Sat 12:29" in Singapore time: helps guess meals vs. other spends. */
export function sgtWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** Turn one email into zero or more pending drafts. Pure apart from injected lookups/AI. */
export async function processEmail(email: IncomingEmail, ctx: ProcessContext): Promise<ProcessOutcome> {
  const parsed = runParsers(email);

  if (parsed.type === "ignored") return { status: "ignored", parser: parsed.parser, reason: parsed.reason, drafts: [] };

  let txns: ParsedTxn[] = [];
  let parser: string | null = null;
  let baseConfidence = 1;
  let classifier = "rules";
  let needsManualAmount = false;

  if (parsed.type === "transaction") {
    txns = parsed.txns;
    parser = parsed.parser;
  } else {
    // Unknown sender
    const f = prefilter(email);
    if (!f.pass) return { status: "rejected", parser: null, reason: f.reason, drafts: [] };
    if (!looksTransactional(email)) return { status: "rejected", parser: null, reason: "no amount or payment words", drafts: [] };
    if (!ctx.ai) return { status: "needs_review", parser: null, reason: "unknown sender; AI off or over budget", drafts: [] };

    const x = await ctx.ai.extract(email);
    classifier = ctx.ai.name;
    if (!x.isTransaction || x.confidence < 0.4) {
      return { status: "rejected", parser: null, reason: `AI: not a transaction (${x.confidence.toFixed(2)})`, drafts: [] };
    }
    if (x.amount == null || !x.currency || !amountAppearsIn(email.text + " " + email.subject, x.amount)) {
      needsManualAmount = true;
    }
    txns = [{
      occurredAt: email.date,
      amount: x.amount ?? 0,
      currency: x.currency ?? "SGD",
      kind: x.kind ?? "spend",
      merchantRaw: x.merchant || email.from,
      counterpartyType: "business",
      role: "receipt",
    }];
    baseConfidence = x.confidence;
  }

  const drafts: Draft[] = [];
  for (const t of txns) {
    const key = merchantKey(t.merchantRaw);
    const keywordHint = keywordCategory(t.merchantRaw, t.categoryHint);
    const utilityHint = isHouseholdUtility(t.merchantRaw);

    // Fallback when AI is off: keyword category, utilities as household bills.
    const givingHint = keywordHint === "Giving";
    let suggestion: Suggestion = {
      category: keywordHint,
      allocation: givingHint ? "giving" : utilityHint && ctx.hasHousehold ? "household" : "personal",
      pot: givingHint ? "adhoc" : utilityHint && ctx.hasHousehold ? "bills" : null,
      confidence: { category: keywordHint ? 0.7 : 0, allocation: 0.5, pot: utilityHint ? 0.6 : 0 },
      source: "rules",
    };
    const byDate = tripByDate(ctx.trips ?? [], t.occurredAt, keywordHint);
    if (byDate) {
      suggestion.trip = byDate.id;
      suggestion.bucket = byDate.bucket;
      suggestion.confidence.trip = 0.6;
    }

    if (ctx.ai && t.kind !== "transfer") {
      const knowledge = await ctx.knowledge({ merchantKey: key, merchantRaw: t.merchantRaw, counterparty: t.counterpartyType });
      const d = await ctx.ai.decide({
        merchant: t.merchantRaw, amount: t.amount, currency: t.currency, snippet: email.text.slice(0, 1500),
        counterparty: t.counterpartyType, when: sgtWhen(t.occurredAt), paymentMethod: t.paymentMethod,
        keywordHint, utilityHint, hasHousehold: ctx.hasHousehold, knowledge,
        trips: nearbyTrips(ctx.trips ?? [], t.occurredAt),
      }, ctx.categories);
      suggestion = {
        category: d.category ?? keywordHint,
        allocation: d.allocation === "household" && !ctx.hasHousehold ? "personal" : d.allocation ?? suggestion.allocation,
        pot: d.allocation === "household" && ctx.hasHousehold ? d.pot ?? "allowance"
          : d.allocation === "giving" ? d.givingKind ?? "adhoc" : null,
        confidence: { category: d.categoryConfidence, allocation: d.allocationConfidence, pot: d.allocation === "giving" ? d.givingConfidence ?? 0 : d.potConfidence, trip: d.tripConfidence ?? 0 },
        source: classifier === "rules" ? ctx.ai.name : classifier,
        trip: d.trip ?? null,
        bucket: d.trip ? d.bucket ?? "daily" : null,
      };
    }

    drafts.push({
      ...t,
      merchant: displayMerchant(t.merchantRaw),
      merchantKey: key,
      categoryName: suggestion.allocation === "giving" ? "Giving" : suggestion.category,
      allocation: suggestion.trip && (suggestion.allocation === "personal" || !suggestion.allocation) ? "trip" : suggestion.allocation,
      householdPot: suggestion.allocation === "household" ? suggestion.pot : null,
      givingKind: suggestion.allocation === "giving" ? suggestion.pot ?? "adhoc" : null,
      tripId: suggestion.trip ?? null,
      tripBucket: suggestion.trip ? suggestion.bucket ?? "daily" : null,
      confidence: Math.min(baseConfidence, suggestion.category ? suggestion.confidence.category || 0.5 : 0.5),
      classifier: suggestion.source,
      needsManualAmount,
      suggestion,
    });
  }

  return { status: "transaction", parser, reason: null, drafts };
}
