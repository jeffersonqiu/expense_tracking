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
  /** Pick one category name from the user's list. */
  pickCategory(input: CategoryInput, categories: string[]): Promise<{ category: string | null; confidence: number }>;
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
