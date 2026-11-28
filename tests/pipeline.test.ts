import { describe, expect, it } from "vitest";
import * as F from "./fixtures/emails";
import { runParsers } from "../src/lib/pipeline/parsers";
import { processEmail, type ProcessContext } from "../src/lib/pipeline/process";
import { findDuplicate } from "../src/lib/pipeline/dedupe";
import { merchantKey, keywordCategory } from "../src/lib/pipeline/categorize";
import { amountAppearsIn, parseSgtDate } from "../src/lib/pipeline/text";
import type { Decider } from "../src/lib/ai/types";

function txn(email: Parameters<typeof runParsers>[0]) {
  const r = runParsers(email);
  if (r.type !== "transaction") throw new Error(`expected transaction, got ${JSON.stringify(r)}`);
  return r.txns[0]!;
}

describe("parsers", () => {
  it("UOB PayNow to an individual", () => {
    const t = txn(F.uobPaynowIndividual);
    expect(t).toMatchObject({ amount: 16.6, currency: "SGD", kind: "spend", counterpartyType: "individual", role: "rail" });
    expect(t.occurredAt).toBe("2026-11-15T01:12:00.000Z");
  });

  it("UOB PayNow to a business (UEN)", () => {
    const t = txn(F.uobPaynowBusiness);
    expect(t).toMatchObject({ amount: 14, merchantRaw: "Qashier-85 Jp Kr cui", counterpartyType: "business" });
  });

  it("ignores UOB 'transfer is successful' confirmations, reversals and statements", () => {
    for (const e of [F.uobPaynowSuccess, F.uobReversal, F.uobStatement]) {
      expect(runParsers(e).type).toBe("ignored");
    }
  });

  it("UOB card alert", () => {
    expect(txn(F.uobCard)).toMatchObject({ amount: 4490, merchantRaw: "GAIN CITY-FUNAN MAIN", paymentMethod: "UOB card 1234" });
  });

  it("UOB refund is a refund dated on the refund day", () => {
    const t = txn(F.uobRefund);
    expect(t).toMatchObject({ amount: 49.7, kind: "refund", merchantRaw: "IKEA" });
    expect(t.occurredAt.startsWith("2026-11-08")).toBe(true);
  });

  it("OCBC Google Pay transfer", () => {
    const t = txn(F.ocbcGooglePay);
    expect(t).toMatchObject({ amount: 13.5, counterpartyType: "individual", paymentMethod: "OCBC Google Pay" });
    expect(t.occurredAt).toBe("2026-11-15T03:59:00.000Z");
  });

  it("TADA receipt", () => {
    const t = txn(F.tadaReceipt);
    expect(t).toMatchObject({ amount: 13.5, merchantRaw: "TADA", role: "receipt", categoryHint: "Transport", paymentMethod: "TADA Cash" });
    expect(t.occurredAt).toBe("2026-11-15T03:59:00.000Z");
  });

  it("Grab ride receipt", () => {
    expect(txn(F.grabRide)).toMatchObject({ amount: 21.4, currency: "SGD", categoryHint: "Transport", paymentMethod: "card 1234" });
  });

  it("Shopee payment confirmed, delivery ignored", () => {
    expect(txn(F.shopeePayment)).toMatchObject({ amount: 12.89, merchantRaw: "Shopee - uf_technology", paymentMethod: "Shopee SPayLater" });
    expect(runParsers(F.shopeeDelivered).type).toBe("ignored");
  });

  it("Stripe receipt in IDR", () => {
    expect(txn(F.stripeIdr)).toMatchObject({ amount: 294500, currency: "IDR", merchantRaw: "Grok xAI" });
  });

  it("SIMBA bill with whole-dollar amount", () => {
    expect(txn(F.simbaBill)).toMatchObject({ amount: 10, currency: "SGD", categoryHint: "Bills" });
  });

  it("Coinhako buy is an investment", () => {
    expect(txn(F.coinhakoBuy)).toMatchObject({ amount: 50, kind: "investment", description: "Buy 0.00059814 BTC" });
  });
});

describe("helpers", () => {
  it("parses SGT dates", () => {
    expect(parseSgtDate("15 Nov 26", "9:12AM")).toBe("2026-11-15T01:12:00.000Z");
    expect(parseSgtDate("03/11/26")).toBe("2026-11-03T04:00:00.000Z");
    expect(parseSgtDate("15-Nov-2026", "12:00 AM")).toBe("2026-11-14T16:00:00.000Z");
  });

  it("checks amounts appear verbatim", () => {
    expect(amountAppearsIn("Total charged: S$8.40.", 8.4)).toBe(true);
    expect(amountAppearsIn("Rp294,500.00", 294500)).toBe(true);
    expect(amountAppearsIn("Total charged: S$8.40.", 84)).toBe(false);
    expect(amountAppearsIn("Total 18.40", 8.4)).toBe(false);
  });

  it("normalises merchants and applies keyword categories", () => {
    expect(merchantKey("Grab* A-A3WKV47GWPCPAV")).toBe("grab");
    expect(merchantKey("Qashier-85 Jp Kr cui")).toBe("85 jp kr cui");
    expect(keywordCategory("HUA SHUANG KITCHEN M")).toBe("Food");
    expect(keywordCategory("SECRET FURNISHINGPTE")).toBe("House");
    expect(keywordCategory("ROYXX OX WEX YAXX")).toBeNull();
  });
});

describe("dedupe", () => {
  const receipt = { id: "r", occurredAt: "2026-11-15T03:59:00Z", amount: 13.5, currency: "SGD", role: "receipt" as const, merchantKey: "tada", status: "pending" as const };
  const rail = { occurredAt: "2026-11-15T03:59:00Z", amount: 13.5, currency: "SGD", role: "rail" as const, merchantKey: "tax lex huxx" };

  it("rail after receipt is the duplicate", () => {
    expect(findDuplicate(rail, [receipt])).toEqual({ action: "candidate_is_duplicate", of: "r" });
  });
  it("receipt after a pending rail demotes the rail", () => {
    expect(findDuplicate({ ...receipt, id: undefined }, [{ ...rail, id: "x", status: "pending" }])).toEqual({ action: "existing_is_duplicate", id: "x" });
  });
  it("different amount or far apart is not a duplicate", () => {
    expect(findDuplicate({ ...rail, amount: 13.6 }, [receipt])).toEqual({ action: "none" });
    expect(findDuplicate({ ...rail, occurredAt: "2026-11-15T09:00:00Z" }, [receipt])).toEqual({ action: "none" });
  });
});

describe("processEmail", () => {
  const NO_DECISION = { category: null, categoryConfidence: 0, allocation: null, allocationConfidence: 0, pot: null, potConfidence: 0 };
  const ctx = (ai: Decider | null = null, knowledge: ProcessContext["knowledge"] = async () => ({ facts: [], examples: [] })): ProcessContext => ({
    ai,
    knowledge,
    hasHousehold: true,
    categories: ["Food", "Transport", "Shopping", "Other"],
  });

  it("known sender becomes a categorised draft without AI", async () => {
    const out = await processEmail(F.tadaReceipt, ctx());
    expect(out.status).toBe("transaction");
    expect(out.drafts[0]).toMatchObject({ categoryName: "Transport", classifier: "rules", merchant: "TADA" });
  });

  it("AI decides category and allocation using the user's knowledge", async () => {
    let seen: { facts: string[]; examples: unknown[] } | null = null;
    const ai: Decider = {
      name: "fake",
      extract: async () => ({ isTransaction: false, confidence: 0 }),
      decide: async (input) => {
        seen = input.knowledge;
        return { category: "Food", categoryConfidence: 0.9, allocation: "work", allocationConfidence: 0.8, pot: null, potConfidence: 0 };
      },
    };
    const out = await processEmail(F.uobPaynowIndividual, ctx(ai, async () => ({
      facts: ["Weekday lunch PayNow to people is usually Food"], examples: [],
    })));
    expect(out.drafts[0]).toMatchObject({ categoryName: "Food", allocation: "work", classifier: "fake" });
    expect(out.drafts[0]!.suggestion).toMatchObject({ category: "Food", allocation: "work", source: "fake" });
    expect(seen!.facts).toEqual(["Weekday lunch PayNow to people is usually Food"]);
  });

  it("a personal spend the AI places in a trip becomes a Trip spend; work stays work", async () => {
    const mk = (allocation: "personal" | "work"): Decider => ({
      name: "fake",
      extract: async () => ({ isTransaction: false, confidence: 0 }),
      decide: async () => ({ ...NO_DECISION, category: "Food", categoryConfidence: 0.9, allocation, allocationConfidence: 0.8, trip: "bkk", tripConfidence: 0.8, bucket: "daily" }),
    });
    const trips = [{ id: "bkk", name: "Bangkok", start: "2026-11-10", end: "2026-11-20" }];
    const personal = await processEmail(F.uobPaynowIndividual, { ...ctx(mk("personal")), trips });
    expect(personal.drafts[0]).toMatchObject({ allocation: "trip", tripId: "bkk", tripBucket: "daily" });
    const work = await processEmail(F.uobPaynowIndividual, { ...ctx(mk("work")), trips });
    expect(work.drafts[0]).toMatchObject({ allocation: "work", tripId: "bkk" });
  });

  it("without AI, keyword rules give a fallback suggestion", async () => {
    const out = await processEmail(F.tadaReceipt, ctx());
    expect(out.drafts[0]!.suggestion).toMatchObject({ category: "Transport", allocation: "personal", source: "rules" });
  });

  it("rejects promotions and newsletters", async () => {
    expect((await processEmail(F.grabPromo, ctx())).status).toBe("ignored"); // grab parser: not a receipt
    expect((await processEmail(F.newsletter, ctx())).status).toBe("rejected");
  });

  it("unknown sender without AI goes to review", async () => {
    expect((await processEmail(F.unknownReceipt, ctx())).status).toBe("needs_review");
  });

  it("unknown sender with AI; invented amounts are flagged", async () => {
    const ai: Decider = {
      name: "fake",
      extract: async () => ({ isTransaction: true, confidence: 0.9, amount: 9.99, currency: "SGD", merchant: "Some Cafe", kind: "spend" }),
      decide: async () => ({ ...NO_DECISION, category: "Food", categoryConfidence: 0.8, allocation: "personal", allocationConfidence: 0.7 }),
    };
    const out = await processEmail(F.unknownReceipt, ctx(ai));
    expect(out.drafts[0]).toMatchObject({ merchant: "Some Cafe", needsManualAmount: true, categoryName: "Food" });

    const honest: Decider = { ...ai, extract: async () => ({ isTransaction: true, confidence: 0.9, amount: 8.4, currency: "SGD", merchant: "Some Cafe" }) };
    expect((await processEmail(F.unknownReceipt, ctx(honest))).drafts[0]!.needsManualAmount).toBe(false);
  });
});

describe("household utilities", () => {
  it("recognises Singapore utilities but not mobile plans", async () => {
    const { isHouseholdUtility } = await import("../src/lib/pipeline/categorize");
    expect(isHouseholdUtility("Pacificlight Energy")).toBe(true);
    expect(isHouseholdUtility("SP Services Ltd")).toBe(true);
    expect(isHouseholdUtility("TOWN COUNCIL - TC S&CC")).toBe(true);
    expect(isHouseholdUtility("SIMBA Telecom")).toBe(false);
    expect(isHouseholdUtility("Grab (ride)")).toBe(false);
  });

  it("new utility emails arrive pre-filed as Household -> Bills", async () => {
    const out = await processEmail(
      { ...F.uobCard, messageId: "u1", text: F.uobCard.text.replace("GAIN CITY-FUNAN MAIN", "PACIFICLIGHT ENERGY") },
      { ai: null, knowledge: async () => ({ facts: [], examples: [] }), categories: ["Bills", "Other"], hasHousehold: true },
    );
    expect(out.drafts[0]).toMatchObject({ allocation: "household", householdPot: "bills", categoryName: "Bills" });
  });
});

describe("hotels", () => {
  it("hotels and stays go to Hotels, flights stay in Travel", () => {
    expect(keywordCategory("THE RITZ CARLTON JKT O JAKARTA SLT")).toBe("Hotels");
    expect(keywordCategory("Marriott Bonvoy")).toBe("Hotels");
    expect(keywordCategory("AIRBNB * HM8XYZ")).toBe("Hotels");
    expect(keywordCategory("Singapore Airlines")).toBe("Travel");
  });
});

describe("giving", () => {
  it("files donations and red packets under Giving", () => {
    expect(keywordCategory("GIVING.SG DONATION")).toBe("Giving");
    expect(keywordCategory("Community Chest")).toBe("Giving");
    expect(keywordCategory("Willing Hearts")).toBe("Giving");
  });
});

describe("trips", () => {
  it("offers only trips near the spend date and files spends inside a trip by date", async () => {
    const { nearbyTrips, tripByDate } = await import("../src/lib/pipeline/process");
    const trips = [
      { id: "bkk", name: "Agentix Bangkok", start: "2026-10-20", end: "2026-10-23" },
      { id: "ita", name: "Italy", start: "2026-12-18", end: "2026-12-30" },
      { id: "old", name: "CNY 2025", start: "2025-01-28", end: "2025-02-02" },
    ];
    expect(nearbyTrips(trips, "2026-10-21T05:00:00Z").map((t) => t.id)).toEqual(["bkk", "ita"]);
    expect(tripByDate(trips, "2026-10-21T05:00:00Z", "Hotels")).toEqual({ id: "bkk", bucket: "hotels" });
    expect(tripByDate(trips, "2026-10-21T05:00:00Z", "Food")).toEqual({ id: "bkk", bucket: "daily" });
    expect(tripByDate(trips, "2026-11-05T05:00:00Z", "Food")).toBeNull();
  });
});
