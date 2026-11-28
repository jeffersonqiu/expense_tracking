import { describe, expect, it } from "vitest";
import { pickTopUp, pickTransfer, type Leg } from "../src/lib/pipeline/wise";

const L = (p: Partial<Leg> & Pick<Leg, "id" | "occurredAt" | "amount" | "currency">): Leg => ({
  merchantKey: "wise", merchantRaw: "WISE ASIA-PACIFIC PTE. LTD.", paymentMethod: "UOB PayNow a/c 0856", status: "pending", duplicateOf: null, ...p,
});
const T = (p: Partial<Leg> & Pick<Leg, "id" | "occurredAt" | "amount" | "currency">): Leg =>
  L({ merchantKey: "wise to siti rahma", merchantRaw: "Wise to Siti Rahma", paymentMethod: "Wise", ...p });

describe("wise: transfer + bank top-up are one spend", () => {
  it("matches the top-up with the same SGD amount", () => {
    const tr = T({ id: "t", occurredAt: "2026-11-28T05:00:12Z", amount: 4.47, currency: "SGD" });
    const legs = [
      L({ id: "a", occurredAt: "2026-11-28T04:59:30Z", amount: 4.47, currency: "SGD" }),
      L({ id: "b", occurredAt: "2026-11-28T05:01:00Z", amount: 14.05, currency: "SGD" }),
    ];
    expect(pickTopUp(tr, legs)?.id).toBe("a");
  });
  it("when the Wise email only shows what arrived (IDR), takes the only top-up nearby", () => {
    const tr = T({ id: "t", occurredAt: "2026-11-28T05:00:12Z", amount: 50000, currency: "IDR" });
    expect(pickTopUp(tr, [L({ id: "a", occurredAt: "2026-11-28T04:59:30Z", amount: 4.47, currency: "SGD" })])?.id).toBe("a");
  });
  it("doesn't guess between two top-ups when the Wise email has no SGD amount", () => {
    const tr = T({ id: "t", occurredAt: "2026-11-28T05:00:12Z", amount: 50000, currency: "IDR" });
    const legs = [
      L({ id: "a", occurredAt: "2026-11-28T04:59:30Z", amount: 4.47, currency: "SGD" }),
      L({ id: "b", occurredAt: "2026-11-28T05:01:00Z", amount: 14.05, currency: "SGD" }),
    ];
    expect(pickTopUp(tr, legs)).toBeNull();
  });
  it("ignores top-ups far apart in time, other merchants, and ones already merged", () => {
    const tr = T({ id: "t", occurredAt: "2026-11-28T05:00:12Z", amount: 4.47, currency: "SGD" });
    expect(pickTopUp(tr, [
      L({ id: "late", occurredAt: "2026-11-28T07:00:00Z", amount: 4.47, currency: "SGD" }),
      L({ id: "other", occurredAt: "2026-11-28T05:00:00Z", amount: 4.47, currency: "SGD", merchantKey: "tada", merchantRaw: "TADA" }),
      L({ id: "done", occurredAt: "2026-11-28T05:00:00Z", amount: 4.47, currency: "SGD", duplicateOf: "x" }),
    ])).toBeNull();
  });
  it("finds the transfer when the bank alert arrives second", () => {
    const top = L({ id: "a", occurredAt: "2026-11-28T05:00:40Z", amount: 4.47, currency: "SGD" });
    const tr = T({ id: "t", occurredAt: "2026-11-28T05:00:12Z", amount: 4.47, currency: "SGD" });
    const merged = T({ id: "m", occurredAt: "2026-11-28T05:00:20Z", amount: 4.47, currency: "SGD", paymentMethod: "UOB PayNow a/c 0856 → Wise" });
    expect(pickTransfer(top, [tr, merged])?.id).toBe("t");
  });
});
