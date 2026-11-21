import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IncomingEmail } from "../pipeline/types";
import { processEmail, type ProcessOutcome } from "../pipeline/process";
import { findDuplicate, type ExistingTxn } from "../pipeline/dedupe";
import { OpenRouterHaiku } from "../ai/openrouter";
import { GuardedDecider } from "../ai/budget";
import { JevDecider } from "../ai/jev";
import type { Decider } from "../ai/types";
import { env } from "../env";
import { fxRate, toBase } from "./fx";

const BODY_LIMIT = 20_000;

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Builds the AI decider for this request, or null when off / no key / over budget. */
export async function makeDecider(db: SupabaseClient, userId: string): Promise<Decider | null> {
  const key = env.openRouterKey();
  if (!key) return null;
  const settings = await db.from("app_settings").select("ai_enabled, ai_monthly_cap_usd").single();
  if (!settings.data?.ai_enabled) return null;
  const usage = await db.from("ai_usage").select("cost_usd").gte("created_at", monthStartIso());
  const spent = (usage.data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
  const cap = Number(settings.data.ai_monthly_cap_usd);
  if (spent >= cap) return null;

  const holder: { current?: GuardedDecider } = {};
  const sink = GuardedDecider.sink(holder, async (c) => {
    await db.from("ai_usage").insert({
      user_id: userId, model: c.model, purpose: c.purpose,
      input_tokens: c.inputTokens, output_tokens: c.outputTokens, cost_usd: c.costUsd,
    });
  });
  // AI_DECIDER: "jev" (default: Jev decides, Haiku only extracts amounts) or "haiku".
  const haiku = new OpenRouterHaiku(key, sink);
  const inner = process.env.AI_DECIDER === "haiku" ? haiku : new JevDecider(key, sink, haiku);
  holder.current = new GuardedDecider(inner, spent, cap, true);
  return holder.current;
}

export interface IngestResult {
  messageId: string;
  status: ProcessOutcome["status"] | "duplicate_email" | "error";
}

/** Processes one email for one user. Safe to call twice for the same message. */
export async function ingestEmail(db: SupabaseClient, userId: string, email: IncomingEmail, ai: Decider | null): Promise<IngestResult> {
  const existing = await db.from("source_emails").select("id").eq("user_id", userId).eq("gmail_message_id", email.messageId).maybeSingle();
  if (existing.data) return { messageId: email.messageId, status: "duplicate_email" };

  const [catRes, profileRes, ownHh, memberHh] = await Promise.all([
    db.from("categories").select("id, name").eq("user_id", userId).order("sort_order"),
    db.from("profiles").select("base_currency").eq("id", userId).single(),
    db.from("households").select("id").eq("owner_id", userId).limit(1),
    db.from("household_members").select("household_id").eq("user_id", userId).limit(1),
  ]);
  const householdId: string | null = ownHh.data?.[0]?.id ?? memberHh.data?.[0]?.household_id ?? null;
  const categories = catRes.data ?? [];
  const catByName = new Map(categories.map((c) => [c.name as string, c.id as string]));
  const catById = new Map(categories.map((c) => [c.id as string, c.name as string]));
  const base = (profileRes.data?.base_currency as string) ?? "SGD";

  const ctx = {
    categories: categories.map((c) => c.name as string),
    ai,
    memory: async (key: string) => {
      const r = await db.from("merchant_rules").select("category_id, kind, allocation, auto_accept").eq("user_id", userId).eq("merchant_key", key).maybeSingle();
      if (!r.data) return null;
      return {
        categoryName: r.data.category_id ? catById.get(r.data.category_id) ?? null : null,
        kind: r.data.kind,
        allocation: r.data.allocation,
        autoAccept: !!r.data.auto_accept,
      };
    },
  };

  let outcome: ProcessOutcome;
  try {
    outcome = await processEmail(email, ctx);
  } catch (err) {
    // AI failure or budget reached mid-way: retry with rules only.
    console.error("processEmail with AI failed", err);
    outcome = await processEmail(email, { ...ctx, ai: null });
  }

  const src = await db.from("source_emails").insert({
    user_id: userId,
    gmail_message_id: email.messageId,
    gmail_thread_id: email.threadId ?? null,
    from_address: email.from.slice(0, 300),
    subject: email.subject.slice(0, 500),
    received_at: email.date,
    body_text: email.text.slice(0, BODY_LIMIT),
    gmail_labels: email.labels,
    status: outcome.status,
    parser: outcome.parser,
    reason: outcome.reason,
  }).select("id").single();
  if (src.error) {
    // Unique violation = a parallel request already stored it.
    if (src.error.code === "23505") return { messageId: email.messageId, status: "duplicate_email" };
    throw src.error;
  }

  for (const [i, d] of outcome.drafts.entries()) {
    const t = new Date(d.occurredAt).getTime();
    const windowStart = new Date(t - 3 * 3600e3).toISOString();
    const windowEnd = new Date(t + 3 * 3600e3).toISOString();
    const near = await db.from("transactions")
      .select("id, occurred_at, amount, currency, source_role, merchant_key, status")
      .eq("user_id", userId).is("duplicate_of", null)
      .gte("occurred_at", windowStart).lte("occurred_at", windowEnd);
    const candidates: ExistingTxn[] = (near.data ?? [])
      .filter((r) => r.source_role !== "manual")
      .map((r) => ({
        id: r.id, occurredAt: r.occurred_at, amount: Number(r.amount), currency: r.currency,
        role: r.source_role, merchantKey: r.merchant_key ?? "", status: r.status,
      }));
    const dup = findDuplicate({ occurredAt: d.occurredAt, amount: d.amount, currency: d.currency, role: d.role, merchantKey: d.merchantKey }, candidates);

    const rate = await fxRate(db, d.currency, base, d.occurredAt);
    let allocation = d.allocation ?? "personal";
    if (allocation === "household" && !householdId) allocation = "personal";
    if (allocation === "shared") allocation = "personal";
    const isDup = dup.action === "candidate_is_duplicate";
    const row = {
      user_id: userId,
      source_email_id: src.data.id,
      client_ref: `${email.messageId}:${i}`,
      occurred_at: d.occurredAt,
      amount: d.amount,
      currency: d.currency,
      fx_rate: rate,
      base_currency: base,
      base_amount: toBase(d.amount, rate),
      kind: d.kind,
      merchant_raw: d.merchantRaw.slice(0, 200),
      merchant: d.merchant,
      merchant_key: d.merchantKey,
      counterparty_type: d.counterpartyType,
      payment_method: d.paymentMethod ?? null,
      source_role: d.role,
      category_id: d.categoryName ? catByName.get(d.categoryName) ?? null : null,
      description: d.description ?? null,
      status: isDup ? "rejected" : d.autoAccept ? "confirmed" : "pending",
      duplicate_of: isDup ? dup.of : null,
      allocation,
      claim_status: allocation === "work" ? "to_claim" : null,
      household_id: allocation === "household" ? householdId : null,
      confidence: d.confidence,
      classifier: d.classifier,
      needs_manual_amount: d.needsManualAmount,
    };
    const ins = await db.from("transactions").upsert(row, { onConflict: "user_id,client_ref", ignoreDuplicates: true }).select("id").maybeSingle();
    if (ins.error) throw ins.error;

    if (dup.action === "existing_is_duplicate" && ins.data) {
      // The new receipt replaces an earlier pending bank alert; carry its payment method over.
      const rail = await db.from("transactions").select("payment_method").eq("id", dup.id).single();
      await db.from("transactions").update({ status: "rejected", duplicate_of: ins.data.id }).eq("id", dup.id).eq("user_id", userId);
      if (rail.data?.payment_method) {
        await db.from("transactions").update({ payment_method: rail.data.payment_method }).eq("id", ins.data.id);
      }
    } else if (dup.action === "candidate_is_duplicate" && d.role === "rail" && d.paymentMethod) {
      // The bank alert says how the money actually moved; prefer it over the receipt's label.
      await db.from("transactions").update({ payment_method: d.paymentMethod }).eq("id", dup.of).eq("user_id", userId);
    }
  }

  return { messageId: email.messageId, status: outcome.status };
}
