import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { rankKnowledge, similarity } from "../src/lib/server/knowledge";

const fact = (subject: string, statement: string, extra: Record<string, unknown> = {}) => ({
  subject_type: "merchant", subject, statement, conditions: null, support: 3, contradictions: 0, last_seen_at: "", ...extra,
});
const log = (merchant: string, extra: Record<string, unknown> = {}) => ({
  merchant, merchant_key: merchant.toLowerCase(), local_time: "Tue 12:30", amount: 10, currency: "SGD", counterparty_type: "business",
  final_category: "Food", final_allocation: "personal", final_pot: null,
  corrected_category: false, corrected_allocation: false, corrected_pot: false, suggested: null, ...extra,
});

describe("knowledge retrieval", () => {
  it("links merchant branches by shared words", () => {
    expect(similarity("THE RITZ CARLTON JKT O JAKARTA", "ritz carlton bali")).toBeGreaterThan(0.25);
    expect(similarity("Grab (ride)", "Fairprice Finest")).toBe(0);
  });

  it("returns related facts and lessons, and puts corrections first", () => {
    const k = rankKnowledge(
      { merchantRaw: "THE RITZ CARLTON JKT", counterparty: "business" },
      [
        fact("ritz carlton", "Ritz Carlton stays are Hotels", { support: 4 }),
        fact("fairprice", "FairPrice is Groceries"),
        fact("hotels", "Hotel bills were corrected from Travel to Hotels", { subject_type: "lesson" }),
      ],
      [
        log("RITZ CARLTON BALI", { final_category: "Hotels", final_allocation: "work" }),
        log("RITZ CARLTON SG", { final_category: "Hotels", final_allocation: "personal", corrected_allocation: true, suggested: { allocation: "work" } }),
        log("Joyful CCK"),
      ],
    );
    expect(k.facts[0]).toContain("Ritz Carlton stays are Hotels");
    expect(k.facts.join(" ")).toContain("corrected from Travel to Hotels");
    expect(k.facts.join(" ")).not.toContain("FairPrice");
    expect(k.examples).toHaveLength(2);
    expect(k.examples[0]).toMatchObject({ merchant: "RITZ CARLTON SG", correction: "user corrected AI: allocation work -> personal" });
  });
});
