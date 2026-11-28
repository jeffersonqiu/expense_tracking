import { afterEach, describe, expect, it, vi } from "vitest";
import { JevDecider } from "../src/lib/ai/jev";
import type { Decider } from "../src/lib/ai/types";
import { unknownReceipt } from "./fixtures/emails";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(answers: Record<string, unknown>, cost = 0.00002) {
  const calls: { url: string; body: any; headers: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return new Response(JSON.stringify({ model: "typesafe/jev-1.14-x", answers, usage: { input_tokens: 400, output_tokens: 20, cost } }), { status: 200 });
  }));
  return calls;
}

describe("JevDecider", () => {
  it("sends a documented Decisions request and reads noul/choice answers", async () => {
    const calls = stubFetch({
      is_transaction: { type: "noul", noul: 0.93 },
      kind: { type: "choice", choice: "spend", confidence: 0.8, probabilities: { spend: 0.9 } },
    });
    const costs: number[] = [];
    const extractor: Decider = {
      name: "fake", extract: async () => ({ isTransaction: true, confidence: 1, amount: 8.4, currency: "SGD", merchant: "Some Cafe" }),
      decide: vi.fn(),
    };
    const jev = new JevDecider("k", (c) => { costs.push(c.costUsd); }, extractor, "typesafe/jev-1.14");
    const x = await jev.extract(unknownReceipt);

    expect(calls[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(calls[0]!.headers.Authorization).toBe("Bearer k");
    expect(calls[0]!.body.model).toBe("typesafe/jev-1.14");
    expect(calls[0]!.body.questions.is_transaction.type).toBe("noul");
    expect(Object.keys(calls[0]!.body.questions.is_transaction.criteria)).toEqual(["true", "false"]);
    expect(calls[0]!.body.questions.kind.type).toBe("choice");
    expect(x).toMatchObject({ isTransaction: true, confidence: 0.93, kind: "spend", amount: 8.4, merchant: "Some Cafe" });
    expect(costs).toEqual([0.00002]);
  });

  it("says no below 0.5 and skips extraction", async () => {
    stubFetch({ is_transaction: { type: "noul", noul: 0.2 }, kind: { type: "refusal" } });
    const extract = vi.fn();
    const jev = new JevDecider("k", () => {}, { name: "x", extract, decide: vi.fn() } as unknown as Decider);
    expect(await jev.extract(unknownReceipt)).toMatchObject({ isTransaction: false });
    expect(extract).not.toHaveBeenCalled();
  });

  it("decides category, allocation and pot in one request with the user's knowledge", async () => {
    const calls = stubFetch({
      category: { type: "choice", choice: "Hotels", confidence: 0.7, probabilities: {} },
      allocation: { type: "choice", choice: "work", confidence: 0.82, probabilities: {} },
      pot: { type: "choice", choice: "bills", confidence: 0.4, probabilities: {} },
    });
    const jev = new JevDecider("k", () => {}, null);
    const d = await jev.decide({
      merchant: "RITZ CARLTON JKT", amount: 588060, currency: "IDR", snippet: "", hasHousehold: true,
      knowledge: { facts: ["Hotels in Jakarta in Nov 2026 were work trips"], examples: [{ merchant: "RITZ CARLTON BALI", when: "Tue 21:00", amount: "IDR 1", category: "Hotels", allocation: "work", pot: null, correction: "user corrected AI: category Travel -> Hotels" }] },
    }, ["Travel", "Hotels"]);
    expect(d).toMatchObject({ category: "Hotels", categoryConfidence: 0.7, allocation: "work", allocationConfidence: 0.82, pot: "bills", potConfidence: 0.4, trip: null });
    const body = calls[0]!.body;
    expect(Object.keys(body.questions)).toEqual(["category", "allocation", "giving_kind", "pot"]);
    expect(Object.keys(body.questions.allocation.criteria)).toEqual(["personal", "work", "giving", "household"]);
    expect(body.state.what_we_know_about_this_user).toEqual(["Hotels in Jakarta in Nov 2026 were work trips"]);
    expect(body.state.similar_past_decisions[0].correction).toContain("Travel -> Hotels");

    stubFetch({ category: { type: "refusal" }, allocation: { type: "refusal" } });
    const r = await jev.decide({ merchant: "x", amount: 1, currency: "SGD", snippet: "", hasHousehold: false, knowledge: { facts: [], examples: [] } }, ["Food"]);
    expect(r).toMatchObject({ category: null, allocation: null, pot: null });
  });

  it("asks which trip and bucket when trips are nearby", async () => {
    const calls = stubFetch({
      category: { type: "choice", choice: "Travel", confidence: 0.8, probabilities: {} },
      allocation: { type: "choice", choice: "personal", confidence: 0.9, probabilities: {} },
      trip: { type: "choice", choice: "t-bkk", confidence: 0.86, probabilities: {} },
      trip_bucket: { type: "choice", choice: "transport", confidence: 0.9, probabilities: {} },
    });
    const jev = new JevDecider("k", () => {}, null);
    const d = await jev.decide({
      merchant: "SCOOT", amount: 210, currency: "SGD", snippet: "SIN -> BKK 20 Oct", hasHousehold: false,
      knowledge: { facts: [], examples: [] },
      trips: [{ id: "t-bkk", name: "Agentix Bangkok", start: "2026-10-20", end: "2026-10-23" }],
    }, ["Travel", "Hotels"]);
    expect(d).toMatchObject({ trip: "t-bkk", bucket: "transport", tripConfidence: 0.86 });
    expect(Object.keys(calls[0]!.body.questions.trip.criteria)).toEqual(["none", "t-bkk"]);
    expect(Object.keys(calls[0]!.body.questions.trip_bucket.criteria)).toEqual(["daily", "transport", "hotels"]);
  });
});
