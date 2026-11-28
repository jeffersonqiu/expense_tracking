/**
 * A Wise transfer usually comes with two emails:
 *   1. the bank alert for the top-up, e.g. UOB "PayNow S$4.47 to Wise" (what left your bank)
 *   2. Wise "50,000 IDR is now in Tania's account" (who got it, what arrived)
 * They are one spend. These helpers pair them.
 */

export interface Leg {
  id: string;
  occurredAt: string;
  amount: number;
  currency: string;
  merchantKey: string;
  merchantRaw: string;
  paymentMethod: string | null;
  status: "pending" | "confirmed" | "rejected";
  duplicateOf: string | null;
}

const WINDOW_MS = 45 * 60e3;

/** The Wise email's own row: "Wise to …", paid via Wise. */
export const isWiseTransfer = (l: Pick<Leg, "merchantRaw" | "paymentMethod">) =>
  /^wise to /i.test(l.merchantRaw) && (l.paymentMethod ?? "").toLowerCase().includes("wise");

/** A bank alert paying Wise (the top-up), not yet folded into a transfer. */
export const isWiseTopUp = (l: Pick<Leg, "merchantKey" | "merchantRaw" | "paymentMethod">) =>
  /\bwise\b/.test(l.merchantKey) && !/^wise to /i.test(l.merchantRaw) && !(l.paymentMethod ?? "").toLowerCase().startsWith("wise");

/** A transfer still waiting for its top-up (payment method still just "Wise"). */
export const awaitingTopUp = (l: Pick<Leg, "paymentMethod">) => (l.paymentMethod ?? "").trim().toLowerCase() === "wise";

/**
 * The top-up that funded this transfer: same amount and currency when the Wise
 * email showed what was paid; otherwise (it only showed what arrived, e.g. IDR)
 * the only top-up close in time.
 */
export function pickTopUp(transfer: Leg, legs: Leg[]): Leg | null {
  const t = new Date(transfer.occurredAt).getTime();
  const near = legs
    .filter((l) => l.id !== transfer.id && !l.duplicateOf && l.status !== "rejected" && isWiseTopUp(l))
    .filter((l) => Math.abs(new Date(l.occurredAt).getTime() - t) <= WINDOW_MS)
    .sort((a, b) => Math.abs(new Date(a.occurredAt).getTime() - t) - Math.abs(new Date(b.occurredAt).getTime() - t));
  const same = near.find((l) => l.currency === transfer.currency && Math.abs(l.amount - transfer.amount) < 0.005);
  if (same) return same;
  if (transfer.currency !== "SGD" && near.length === 1) return near[0]!;
  return null;
}

/** The transfer a top-up funded (the reverse lookup, when the bank alert arrives second). */
export function pickTransfer(topUp: Leg, legs: Leg[]): Leg | null {
  const candidates = legs.filter((l) => l.id !== topUp.id && !l.duplicateOf && l.status !== "rejected" && isWiseTransfer(l) && awaitingTopUp(l));
  for (const tr of candidates.sort((a, b) =>
    Math.abs(new Date(a.occurredAt).getTime() - new Date(topUp.occurredAt).getTime()) -
    Math.abs(new Date(b.occurredAt).getTime() - new Date(topUp.occurredAt).getTime()))) {
    if (pickTopUp(tr, [topUp, ...legs.filter((l) => l.id !== tr.id)])?.id === topUp.id) return tr;
  }
  return null;
}
