/**
 * Cross-source duplicate detection.
 * A merchant receipt (TADA/Grab/Shopee/Stripe) and a payment-rail alert
 * (UOB/OCBC PayNow, card alert) for the same amount close in time describe one
 * spend. The receipt is kept as the primary row; the rail is marked duplicate.
 */

export interface DedupeCandidate {
  id?: string;
  occurredAt: string;
  amount: number;
  currency: string;
  role: "receipt" | "rail";
  merchantKey: string;
}

export interface ExistingTxn extends DedupeCandidate {
  id: string;
  /** Only pending rows may be demoted to duplicates. */
  status: "pending" | "confirmed" | "rejected";
}

export type DedupeDecision =
  | { action: "none" }
  | { action: "candidate_is_duplicate"; of: string }
  | { action: "existing_is_duplicate"; id: string };

const RECEIPT_RAIL_WINDOW_MS = 3 * 3600e3;
const SAME_ROLE_WINDOW_MS = 10 * 60e3;

export function findDuplicate(c: DedupeCandidate, existing: ExistingTxn[]): DedupeDecision {
  const t = new Date(c.occurredAt).getTime();
  const sameMoney = (x: ExistingTxn) =>
    x.currency === c.currency && Math.abs(x.amount - c.amount) < 0.005 && x.status !== "rejected";
  const near = (x: ExistingTxn, window: number) => Math.abs(new Date(x.occurredAt).getTime() - t) <= window;

  // Closest match first.
  const matches = existing
    .filter(sameMoney)
    .sort((a, b) => Math.abs(new Date(a.occurredAt).getTime() - t) - Math.abs(new Date(b.occurredAt).getTime() - t));

  for (const x of matches) {
    if (x.role !== c.role && near(x, RECEIPT_RAIL_WINDOW_MS)) {
      if (c.role === "rail") return { action: "candidate_is_duplicate", of: x.id };
      if (x.status === "pending") return { action: "existing_is_duplicate", id: x.id };
      // Rail already confirmed by the user: keep theirs, drop the receipt.
      return { action: "candidate_is_duplicate", of: x.id };
    }
    if (x.role === c.role && x.merchantKey === c.merchantKey && near(x, SAME_ROLE_WINDOW_MS)) {
      return { action: "candidate_is_duplicate", of: x.id };
    }
  }
  return { action: "none" };
}
