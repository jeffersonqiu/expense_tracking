export function money(amount: number | string | null | undefined, currency = "SGD"): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-SG", { style: "currency", currency, maximumFractionDigits: currency === "IDR" || currency === "JPY" ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function sgtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

export function sgtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Value for <input type="datetime-local"> in SGT. */
export function toLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 16);
}

/** Parse <input type="datetime-local"> (SGT) back to ISO. */
export function fromLocalInput(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return new Date(`${v}:00+08:00`).toISOString();
}

/** Signed contribution to spending: refunds count negative; investments/transfers don't count. */
export function spendValue(kind: string, baseAmount: number | null): number {
  if (baseAmount == null) return 0;
  if (kind === "spend") return Number(baseAmount);
  if (kind === "refund") return -Number(baseAmount);
  return 0;
}
