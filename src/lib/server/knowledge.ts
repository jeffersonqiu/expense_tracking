import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Knowledge, PastDecision } from "../ai/types";
import { merchantKey } from "../pipeline/categorize";

const MAX_FACTS = 12;
const MAX_EXAMPLES = 8;

function tokens(s: string): Set<string> {
  return new Set(merchantKey(s).split(" ").filter((t) => t.length > 1 && !/^\d+$/.test(t)));
}

/** Jaccard overlap of merchant words: "ritz carlton jkt" ~ "ritz carlton bali". */
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

interface FactRow {
  subject_type: string; subject: string; statement: string; conditions: string | null;
  support: number; contradictions: number; last_seen_at: string;
}
interface LogRow {
  merchant: string | null; merchant_key: string | null; local_time: string | null; amount: number | string | null; currency: string | null;
  counterparty_type: string | null; final_category: string | null; final_allocation: string | null; final_pot: string | null;
  corrected_category: boolean; corrected_allocation: boolean; corrected_pot: boolean;
  final_trip?: string | null; corrected_trip?: boolean;
  suggested: { category?: string; allocation?: string; pot?: string } | null;
}

/** Facts and past decisions to show the AI for one spend. Pure ranking; data loaded once per request. */
export function rankKnowledge(q: { merchantRaw: string; counterparty: string }, facts: FactRow[], log: LogRow[]): Knowledge {
  const scoredFacts = facts
    .map((f) => {
      const sim = similarity(q.merchantRaw, f.subject);
      const general = f.subject_type === "lesson" || f.subject_type === "pattern" ? 0.35 : 0;
      const relevance = Math.max(sim >= 0.2 ? sim : 0, general);
      const strength = Math.log2(1 + f.support) / 6 - f.contradictions * 0.05;
      return { f, relevance, score: relevance + strength };
    })
    .filter((x) => x.relevance > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FACTS)
    .map(({ f }) => `${f.statement}${f.conditions ? ` (when: ${f.conditions})` : ""} [seen ${f.support}x${f.contradictions ? `, ${f.contradictions} exceptions` : ""}]`);

  const scoredLog = log
    .map((r) => {
      const sim = similarity(q.merchantRaw, r.merchant ?? r.merchant_key ?? "");
      const corrected = r.corrected_category || r.corrected_allocation || r.corrected_pot || !!r.corrected_trip;
      const sameKind = r.counterparty_type === q.counterparty ? 0.05 : 0;
      return { r, corrected, score: sim + (corrected ? 0.15 : 0) + sameKind };
    })
    .filter((x) => x.score > 0.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXAMPLES);

  const examples: PastDecision[] = scoredLog.map(({ r, corrected }) => {
    const fixes: string[] = [];
    if (r.corrected_category) fixes.push(`category ${r.suggested?.category ?? "?"} -> ${r.final_category ?? "none"}`);
    if (r.corrected_allocation) fixes.push(`allocation ${r.suggested?.allocation ?? "?"} -> ${r.final_allocation ?? "?"}`);
    if (r.corrected_pot) fixes.push(`pot ${r.suggested?.pot ?? "?"} -> ${r.final_pot ?? "?"}`);
    if (r.corrected_trip) fixes.push(`trip -> ${r.final_trip ?? "not a trip"}`);
    return {
      merchant: r.merchant ?? r.merchant_key ?? "?",
      when: r.local_time ?? "",
      amount: `${r.currency ?? ""} ${r.amount ?? ""}`.trim(),
      category: r.final_category,
      allocation: r.final_allocation,
      pot: r.final_pot,
      trip: r.final_trip ?? null,
      ...(corrected ? { correction: `user corrected AI: ${fixes.join("; ")}` } : {}),
    };
  });
  return { facts: scoredFacts, examples };
}

/** Loads the user's active facts and recent decisions once; returns a per-spend lookup. */
export async function knowledgeFor(db: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - 120 * 86400e3).toISOString();
  const [facts, log] = await Promise.all([
    db.from("knowledge_facts")
      .select("subject_type, subject, statement, conditions, support, contradictions, last_seen_at")
      .eq("user_id", userId).eq("active", true).order("support", { ascending: false }).limit(400),
    db.from("decision_log")
      .select("merchant, merchant_key, local_time, amount, currency, counterparty_type, final_category, final_allocation, final_pot, final_trip, corrected_category, corrected_allocation, corrected_pot, corrected_trip, suggested")
      .eq("user_id", userId).eq("decision", "accept").gte("decided_at", since)
      .order("decided_at", { ascending: false }).limit(1500),
  ]);
  const F = (facts.data ?? []) as FactRow[];
  const L = (log.data ?? []) as LogRow[];
  return async (q: { merchantKey: string; merchantRaw: string; counterparty: string }) => rankKnowledge(q, F, L);
}
