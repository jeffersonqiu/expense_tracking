import type { IncomingEmail, ParsedTxn } from "./types";
import type { Decider } from "../ai/types";
import { runParsers } from "./parsers";
import { looksTransactional, prefilter } from "./filters";
import { amountAppearsIn } from "./text";
import { displayMerchant, keywordCategory, merchantKey } from "./categorize";

export interface MerchantMemory {
  categoryName: string | null;
  kind: ParsedTxn["kind"] | null;
  allocation: string | null;
  autoAccept?: boolean;
}

export interface ProcessContext {
  /** Look up the user's learned rule for a merchant key. */
  memory: (key: string) => Promise<MerchantMemory | null>;
  /** AI is optional: null when disabled or over budget. */
  ai: Decider | null;
  categories: string[];
}

export interface Draft extends ParsedTxn {
  merchant: string;
  merchantKey: string;
  categoryName: string | null;
  allocation: string | null;
  confidence: number;
  classifier: string;
  needsManualAmount: boolean;
  autoAccept: boolean;
}

export interface ProcessOutcome {
  status: "transaction" | "ignored" | "rejected" | "needs_review";
  parser: string | null;
  reason: string | null;
  drafts: Draft[];
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
    const mem = await ctx.memory(key);
    let categoryName: string | null = null;
    let catConfidence = 0;
    let catClassifier = classifier;

    if (mem?.categoryName) {
      categoryName = mem.categoryName;
      catConfidence = 0.95;
      catClassifier = "memory";
    } else {
      const kw = keywordCategory(t.merchantRaw, t.categoryHint);
      if (kw) {
        categoryName = kw;
        catConfidence = t.categoryHint ? 0.95 : 0.8;
        catClassifier = "rules";
      } else if (ctx.ai && t.counterpartyType !== "individual") {
        const pick = await ctx.ai.pickCategory(
          { merchant: t.merchantRaw, amount: t.amount, currency: t.currency, snippet: email.text.slice(0, 1500) },
          ctx.categories,
        );
        if (pick.category && ctx.categories.includes(pick.category)) {
          categoryName = pick.category;
          catConfidence = pick.confidence;
          catClassifier = ctx.ai.name;
        }
      }
    }

    drafts.push({
      ...t,
      kind: mem?.kind ?? t.kind,
      merchant: displayMerchant(t.merchantRaw),
      merchantKey: key,
      categoryName,
      allocation: mem?.allocation ?? null,
      confidence: Math.min(baseConfidence, categoryName ? catConfidence : 0.5),
      classifier: catClassifier,
      needsManualAmount,
      autoAccept: !!mem?.autoAccept && !needsManualAmount && !!categoryName,
    });
  }

  return { status: "transaction", parser, reason: null, drafts };
}
