import type { IncomingEmail, ParsedTxn } from "./types";
import type { Decider, Knowledge } from "../ai/types";
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
}

/** What the AI (or the fallback rules) proposed, kept to compare with the final decision. */
export interface Suggestion {
  category: string | null;
  allocation: string | null;
  pot: string | null;
  confidence: { category: number; allocation: number; pot: number };
  source: string;
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
    let suggestion: Suggestion = {
      category: keywordHint,
      allocation: utilityHint && ctx.hasHousehold ? "household" : "personal",
      pot: utilityHint && ctx.hasHousehold ? "bills" : null,
      confidence: { category: keywordHint ? 0.7 : 0, allocation: 0.5, pot: utilityHint ? 0.6 : 0 },
      source: "rules",
    };

    if (ctx.ai && t.kind !== "transfer") {
      const knowledge = await ctx.knowledge({ merchantKey: key, merchantRaw: t.merchantRaw, counterparty: t.counterpartyType });
      const d = await ctx.ai.decide({
        merchant: t.merchantRaw, amount: t.amount, currency: t.currency, snippet: email.text.slice(0, 1500),
        counterparty: t.counterpartyType, when: sgtWhen(t.occurredAt), paymentMethod: t.paymentMethod,
        keywordHint, utilityHint, hasHousehold: ctx.hasHousehold, knowledge,
      }, ctx.categories);
      suggestion = {
        category: d.category ?? keywordHint,
        allocation: d.allocation === "household" && !ctx.hasHousehold ? "personal" : d.allocation ?? suggestion.allocation,
        pot: d.allocation === "household" && ctx.hasHousehold ? d.pot ?? "allowance" : null,
        confidence: { category: d.categoryConfidence, allocation: d.allocationConfidence, pot: d.potConfidence },
        source: classifier === "rules" ? ctx.ai.name : classifier,
      };
    }

    drafts.push({
      ...t,
      merchant: displayMerchant(t.merchantRaw),
      merchantKey: key,
      categoryName: suggestion.category,
      allocation: suggestion.allocation,
      householdPot: suggestion.allocation === "household" ? suggestion.pot : null,
      confidence: Math.min(baseConfidence, suggestion.category ? suggestion.confidence.category || 0.5 : 0.5),
      classifier: suggestion.source,
      needsManualAmount,
      suggestion,
    });
  }

  return { status: "transaction", parser, reason: null, drafts };
}
