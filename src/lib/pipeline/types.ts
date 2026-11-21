export type Kind = "spend" | "refund" | "investment" | "transfer" | "income";
export type CounterpartyType = "business" | "individual" | "unknown";

/** What the Apps Script sends for each Gmail message. */
export interface IncomingEmail {
  messageId: string;
  threadId?: string;
  from: string;
  subject: string;
  /** ISO timestamp the email was received. */
  date: string;
  labels: string[];
  /** Plain-text body (Apps Script getPlainBody), trimmed to a safe length. */
  text: string;
}

export interface ParsedTxn {
  occurredAt: string;
  amount: number;
  currency: string;
  kind: Kind;
  merchantRaw: string;
  counterpartyType: CounterpartyType;
  paymentMethod?: string;
  /**
   * "receipt" = merchant-level email (TADA, Grab, Shopee, Stripe...).
   * "rail" = how money moved (bank transfer / card alert).
   * A receipt and a rail of the same amount close in time are the same spend.
   */
  role: "receipt" | "rail";
  categoryHint?: string;
  description?: string;
}

export type ParseResult =
  | { type: "transaction"; parser: string; txns: ParsedTxn[] }
  | { type: "ignored"; parser: string; reason: string }
  | { type: "unknown" };

export interface Parser {
  id: string;
  matches(email: IncomingEmail): boolean;
  parse(email: IncomingEmail): ParseResult;
}
