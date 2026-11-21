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
      pickCategory: async () => ({ category: null, confidence: 0 }),
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
    const jev = new JevDecider("k", () => {}, { name: "x", extract, pickCategory: vi.fn() } as unknown as Decider);
    expect(await jev.extract(unknownReceipt)).toMatchObject({ isTransaction: false });
    expect(extract).not.toHaveBeenCalled();
  });

  it("picks a category only from the user's list and handles refusals", async () => {
    const calls = stubFetch({ category: { type: "choice", choice: "Food", confidence: 0.7, probabilities: {} } });
    const jev = new JevDecider("k", () => {}, null);
    expect(await jev.pickCategory({ merchant: "Hua Shuang Kitchen", amount: 6, currency: "SGD", snippet: "" }, ["Food", "Transport"]))
      .toEqual({ category: "Food", confidence: 0.7 });
    expect(Object.keys(calls[0]!.body.questions.category.criteria)).toEqual(["Food", "Transport"]);

    stubFetch({ category: { type: "refusal" } });
    expect(await jev.pickCategory({ merchant: "x", amount: 1, currency: "SGD", snippet: "" }, ["Food"])).toEqual({ category: null, confidence: 0 });
  });
});
