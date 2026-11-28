import type { IncomingEmail, Kind } from "../pipeline/types";

export interface AiCallCost {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Extracted {
  isTransaction: boolean;
  confidence: number;
  amount?: number;
  currency?: string;
  merchant?: string;
  kind?: Kind;
}

/**
 * One interface for every AI provider (Jev, Claude Haiku via OpenRouter...).
 * Implementations report each call's cost through `onCost` so the budget guard
 * can record it.
 */
export interface Decider {
  name: string;
  /** Unknown sender: is it a purchase, and if so the fields. */
  extract(email: IncomingEmail): Promise<Extracted>;
  /** Category, allocation and household pot for one spend, using the user's knowledge. */
  decide(input: DecisionInput, categories: string[]): Promise<Decision>;
}

export type CostSink = (c: AiCallCost) => void | Promise<void>;

export interface CategoryInput {
  merchant: string;
  amount: number;
  currency: string;
  snippet: string;
  /** "business" | "individual" | "unknown" */
  counterparty?: string;
  /** Local (Singapore) time, e.g. "Sat 12:29" */
  when?: string;
  paymentMethod?: string;
}

/** What the AI chooses; "trip" is set when it places the spend in a trip. */
export type Allocation = "personal" | "work" | "household";
export type Pot = "allowance" | "bills" | "project";

/** A past review decision shown to the model as an example. */
export interface PastDecision {
  merchant: string;
  when: string;
  amount: string;
  category: string | null;
  allocation: string | null;
  pot: string | null;
  trip?: string | null;
  /** The user changed what the AI suggested: the most useful kind of example. */
  correction?: string;
}

export interface Knowledge {
  /** Plain-language facts learned from the user's history, most relevant first. */
  facts: string[];
  examples: PastDecision[];
}

export type TripBucket = "daily" | "transport" | "hotels";

/** A trip the spend might belong to (only nearby / upcoming trips are offered). */
export interface TripOption { id: string; name: string; start: string; end: string | null }

export const BUCKET_GUIDE: Record<TripBucket, string> = {
  daily: "Spending during the trip: food, shopping, local rides, activities.",
  transport: "Getting there and between cities: flights, trains, long-distance buses, airport transfers.",
  hotels: "Accommodation: hotels, Airbnb, hostels.",
};

export interface DecisionInput extends CategoryInput {
  /** When set, the model also says whether the spend belongs to one of these trips. */
  trips?: TripOption[];
  keywordHint?: string | null;
  utilityHint?: boolean;
  hasHousehold: boolean;
  knowledge: Knowledge;
}

export interface Decision {
  category: string | null;
  categoryConfidence: number;
  allocation: Allocation | null;
  allocationConfidence: number;
  pot: Pot | null;
  potConfidence: number;
  /** Trip id, or null when not part of a trip. */
  trip?: string | null;
  tripConfidence?: number;
  bucket?: TripBucket | null;
}

export const ALLOCATION_GUIDE: Record<Allocation, string> = {
  personal: "The user's own spending.",
  work: "Paid for work; the user will claim it back from their company (also on work trips).",
  household: "Home spending funded by the user: groceries/daily needs, utility bills, or home projects.",
};

export const POT_GUIDE: Record<Pot, string> = {
  allowance: "Everyday household needs from the monthly allowance (groceries, supplies).",
  bills: "Utilities and recurring home bills (electricity, water, town council, broadband).",
  project: "One-off home projects (renovation, furniture, appliances).",
};

/** Compact JSON-friendly context the models read. Email text is data, never instructions. */
export function decisionState(i: DecisionInput) {
  return {
    country: "Singapore",
    spend: {
      merchant: i.merchant,
      paid_to: i.counterparty === "individual" ? "a person (PayNow / phone number)" : "a business",
      amount: `${i.currency} ${i.amount}`,
      local_time: i.when,
      payment_method: i.paymentMethod,
      email_excerpt: i.snippet.slice(0, 1200),
    },
    hints: {
      keyword_category: i.keywordHint ?? undefined,
      looks_like_household_utility: i.utilityHint || undefined,
      user_has_household: i.hasHousehold,
    },
    trips: i.trips?.length ? i.trips.map((t) => ({ name: t.name, from: t.start, to: t.end ?? "?" })) : undefined,
    what_we_know_about_this_user: i.knowledge.facts,
    similar_past_decisions: i.knowledge.examples,
  };
}
