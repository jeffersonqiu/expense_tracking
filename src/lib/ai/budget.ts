import type { IncomingEmail } from "../pipeline/types";
import type { CostSink, Decider } from "./types";

export class BudgetExceeded extends Error {
  constructor() {
    super("AI monthly budget reached");
  }
}

/** Remaining budget (never negative). */
export function remainingBudget(spentUsd: number, capUsd: number, enabled: boolean): number {
  if (!enabled) return 0;
  return Math.max(0, capUsd - spentUsd);
}

/**
 * Wraps a Decider so every call first checks the month's remaining budget.
 * `spent` is updated as calls report their cost, so a long batch stops as soon
 * as the cap is hit.
 */
export class GuardedDecider implements Decider {
  name: string;
  private spent: number;

  constructor(private inner: Decider, spentUsd: number, private capUsd: number, private enabled: boolean) {
    this.name = inner.name;
    this.spent = spentUsd;
  }

  /** Pass this as the inner decider's cost sink (before constructing the inner). */
  static sink(target: { current?: GuardedDecider }, persist: CostSink): CostSink {
    return async (c) => {
      if (target.current) target.current.spent += c.costUsd;
      await persist(c);
    };
  }

  private check() {
    if (remainingBudget(this.spent, this.capUsd, this.enabled) <= 0) throw new BudgetExceeded();
  }

  async extract(email: IncomingEmail) {
    this.check();
    return this.inner.extract(email);
  }

  async pickCategory(input: Parameters<Decider["pickCategory"]>[0], categories: string[]) {
    this.check();
    return this.inner.pickCategory(input, categories);
  }
}
