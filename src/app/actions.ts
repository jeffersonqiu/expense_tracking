"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/server/context";
import { adminClient } from "@/lib/supabase/admin";
import { fxRate, toBase } from "@/lib/server/fx";
import { newIngestKey } from "@/lib/server/security";
import { fromLocalInput } from "@/lib/format";
import { keywordCategory, merchantKey, displayMerchant } from "@/lib/pipeline/categorize";

const KINDS = ["spend", "refund", "investment", "transfer", "income"] as const;
const ALLOCATIONS = ["personal", "work", "shared", "household"] as const;
const CLAIM = ["to_claim", "submitted", "reimbursed"] as const;

function str(fd: FormData, k: string): string {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
}

/** "Alice: 12.50" per line -> shares. */
function parseShares(text: string): { person_name: string; amount: number }[] {
  return text
    .split(/\n/)
    .map((l) => /^(.+?)[:=]\s*([\d.,]+)\s*$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ person_name: m[1]!.trim().slice(0, 60), amount: Number(m[2]!.replace(/,/g, "")) }))
    .filter((s) => s.amount > 0);
}

const TxnForm = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  decision: z.enum(["accept", "reject", "save"]),
  occurred_at: z.string(),
  amount: z.coerce.number().min(0).max(10_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  kind: z.enum(KINDS),
  merchant: z.string().max(120),
  category_id: z.string().uuid().optional().or(z.literal("")),
  allocation: z.enum(ALLOCATIONS),
  claim_status: z.enum(CLAIM).optional().or(z.literal("")),
  household_id: z.string().uuid().optional().or(z.literal("")),
  description: z.string().max(500).optional(),
  shares: z.string().max(2000).optional(),
  remember: z.string().optional(),
  auto_accept: z.string().optional(),
  return_to: z.string().optional(),
});

/** Accept / reject / save one transaction (also creates manual ones when id is empty). */
export async function saveTransaction(fd: FormData) {
  const { db, uid, profile } = await getContext();
  const f = TxnForm.parse(Object.fromEntries(fd));
  const occurred = fromLocalInput(f.occurred_at);
  if (!occurred) throw new Error("Invalid date");
  const base = profile?.base_currency ?? "SGD";
  const rate = await fxRate(adminClient(), f.currency, base, occurred);
  const allocation = f.allocation;
  const key = merchantKey(f.merchant || "manual");

  if (allocation === "household" && !f.household_id) throw new Error("Choose a household");

  const fields = {
    occurred_at: occurred,
    amount: f.amount,
    currency: f.currency,
    fx_rate: rate,
    base_currency: base,
    base_amount: toBase(f.amount, rate),
    kind: f.kind,
    merchant: f.merchant ? displayMerchant(f.merchant) : null,
    merchant_key: key,
    category_id: f.category_id || null,
    allocation,
    claim_status: allocation === "work" ? f.claim_status || "to_claim" : null,
    household_id: allocation === "household" ? f.household_id || null : null,
    description: f.description || null,
    needs_manual_amount: false,
    status: f.decision === "reject" ? "rejected" : f.decision === "accept" ? "confirmed" : undefined,
    reviewed_at: f.decision === "save" ? undefined : new Date().toISOString(),
  };

  let id = f.id || "";
  if (id) {
    const { error } = await db.from("transactions").update(fields).eq("id", id).eq("user_id", uid);
    if (error) throw new Error("Could not save");
  } else {
    const ins = await db.from("transactions").insert({
      ...fields,
      status: f.decision === "reject" ? "rejected" : "confirmed",
      user_id: uid,
      client_ref: `manual:${randomUUID()}`,
      source_role: "manual",
      merchant_raw: f.merchant || null,
      classifier: "manual",
    }).select("id").single();
    if (ins.error) throw new Error("Could not save");
    id = ins.data.id;
  }

  // Shares for "shared, I paid first"
  await db.from("shared_shares").delete().eq("transaction_id", id).eq("user_id", uid).is("settled_at", null);
  if (allocation === "shared" && f.shares) {
    const shares = parseShares(f.shares).map((s) => ({ ...s, transaction_id: id, user_id: uid }));
    if (shares.length) await db.from("shared_shares").insert(shares);
  }

  // Learn from the decision (merchant memory)
  if (f.decision === "accept" && f.remember && f.merchant) {
    await db.from("merchant_rules").upsert({
      user_id: uid,
      merchant_key: key,
      category_id: f.category_id || null,
      kind: f.kind,
      allocation: allocation === "shared" ? "personal" : allocation,
      auto_accept: !!f.auto_accept,
      updated_at: new Date().toISOString(),
    });
  }

  revalidatePath("/", "layout");
  if (f.return_to?.startsWith("/") && !f.return_to.startsWith("//")) redirect(f.return_to);
}

/** "lunch 12.50 grab" or "12 kopi" -> confirmed manual spend (cash etc.). */
export async function quickAdd(fd: FormData) {
  const { db, uid, profile, categories } = await getContext();
  const text = str(fd, "text").slice(0, 200);
  const m = /(\d+(?:\.\d{1,2})?)/.exec(text);
  if (!m) return;
  const amount = Number(m[1]);
  const words = text.replace(m[0], " ").replace(/\s+/g, " ").trim();
  const catName = keywordCategory(words);
  const cat = categories.find((c) => c.name === catName) ?? null;
  const base = profile?.base_currency ?? "SGD";
  await db.from("transactions").insert({
    user_id: uid,
    client_ref: `quick:${randomUUID()}`,
    occurred_at: new Date().toISOString(),
    amount,
    currency: base,
    fx_rate: 1,
    base_currency: base,
    base_amount: amount,
    kind: "spend",
    merchant: words || "Cash",
    merchant_raw: words || "Cash",
    merchant_key: merchantKey(words || "cash"),
    source_role: "manual",
    payment_method: str(fd, "payment") || "Cash",
    category_id: cat?.id ?? null,
    status: cat ? "confirmed" : "pending",
    classifier: "manual",
  });
  revalidatePath("/", "layout");
}

export async function setClaimStatus(fd: FormData) {
  const { db, uid } = await getContext();
  const status = z.enum(CLAIM).parse(str(fd, "status"));
  const ids = fd.getAll("id").filter((x): x is string => typeof x === "string");
  if (ids.length) await db.from("transactions").update({ claim_status: status }).in("id", ids).eq("user_id", uid).eq("allocation", "work");
  revalidatePath("/balances");
}

export async function settleShare(fd: FormData) {
  const { db, uid } = await getContext();
  const id = z.string().uuid().parse(str(fd, "id"));
  const undo = str(fd, "undo") === "1";
  await db.from("shared_shares").update({ settled_at: undo ? null : new Date().toISOString() }).eq("id", id).eq("user_id", uid);
  revalidatePath("/balances");
}

export async function markReimbursed(fd: FormData) {
  const { db } = await getContext();
  const ids = fd.getAll("id").filter((x): x is string => typeof x === "string");
  const undo = str(fd, "undo") === "1";
  if (ids.length) await db.rpc("mark_household_reimbursed", { tx_ids: ids, reimbursed: !undo });
  revalidatePath("/household");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function createIngestKey(_prev: unknown, fd: FormData): Promise<{ key?: string; error?: string }> {
  const { db, uid } = await getContext();
  const label = str(fd, "label").slice(0, 60) || "Apps Script";
  const k = newIngestKey();
  const { error } = await adminClient().from("ingest_keys").insert({ user_id: uid, label, key_hash: k.hash, key_prefix: k.prefix });
  void db;
  if (error) return { error: "Could not create key" };
  revalidatePath("/settings");
  return { key: k.key };
}

export async function revokeIngestKey(fd: FormData) {
  const { db, uid } = await getContext();
  const id = z.string().uuid().parse(str(fd, "id"));
  await db.from("ingest_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", uid);
  revalidatePath("/settings");
}

export async function updateAiSettings(fd: FormData) {
  const { db, profile } = await getContext();
  if (!profile?.is_owner) throw new Error("Only the owner can change AI settings");
  const cap = z.coerce.number().min(0).max(50).parse(str(fd, "cap"));
  await db.from("app_settings").update({ ai_enabled: fd.get("enabled") === "on", ai_monthly_cap_usd: cap, updated_at: new Date().toISOString() }).eq("id", true);
  revalidatePath("/settings");
}

export async function inviteEmail(fd: FormData) {
  const { db, uid, profile } = await getContext();
  if (!profile?.is_owner) throw new Error("Only the owner can invite");
  const email = z.string().email().parse(str(fd, "email").toLowerCase());
  await db.from("allowed_emails").upsert({ email, invited_by: uid });
  revalidatePath("/settings");
}

export async function removeInvite(fd: FormData) {
  const { db, profile } = await getContext();
  if (!profile?.is_owner) throw new Error("Only the owner can remove invites");
  await db.from("allowed_emails").delete().eq("email", str(fd, "email"));
  revalidatePath("/settings");
}

export async function saveHousehold(fd: FormData) {
  const { db, uid } = await getContext();
  const name = str(fd, "name").slice(0, 60) || "Household";
  const budget = z.coerce.number().min(0).max(1_000_000).parse(str(fd, "budget") || "800");
  const id = str(fd, "id");
  if (id) await db.from("households").update({ name, monthly_budget: budget }).eq("id", id).eq("owner_id", uid);
  else await db.from("households").insert({ name, monthly_budget: budget, owner_id: uid });
  revalidatePath("/", "layout");
}

export async function addHouseholdMember(fd: FormData) {
  const { db, uid } = await getContext();
  const hid = z.string().uuid().parse(str(fd, "household_id"));
  const email = z.string().email().parse(str(fd, "email").toLowerCase());
  const p = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!p.data) throw new Error("That person needs to sign in once first");
  const owns = await db.from("households").select("id").eq("id", hid).eq("owner_id", uid).maybeSingle();
  if (!owns.data) throw new Error("Not your household");
  await db.from("household_members").upsert({ household_id: hid, user_id: p.data.id });
  revalidatePath("/settings");
}

export async function addCategory(fd: FormData) {
  const { db, uid } = await getContext();
  const name = str(fd, "name").slice(0, 40);
  if (name) await db.from("categories").insert({ user_id: uid, name });
  revalidatePath("/settings");
}

export async function setAutoAccept(fd: FormData) {
  const { db, uid } = await getContext();
  await db.from("merchant_rules").update({ auto_accept: str(fd, "on") === "1" }).eq("user_id", uid).eq("merchant_key", str(fd, "merchant_key"));
  revalidatePath("/settings");
}

/** Turn an email the app skipped into a pending draft to fill in. */
export async function promoteEmail(fd: FormData) {
  const { db, uid, profile } = await getContext();
  const id = z.string().uuid().parse(str(fd, "id"));
  const src = await db.from("source_emails").select("id, received_at, from_address, subject").eq("id", id).eq("user_id", uid).single();
  if (src.error) throw new Error("Not found");
  const base = profile?.base_currency ?? "SGD";
  const tx = await db.from("transactions").insert({
    user_id: uid,
    source_email_id: id,
    client_ref: `promoted:${id}`,
    occurred_at: src.data.received_at,
    amount: 0,
    currency: base,
    base_currency: base,
    kind: "spend",
    merchant: displayMerchant(src.data.from_address.replace(/<.*>/, "").trim() || src.data.from_address),
    merchant_key: merchantKey(src.data.from_address),
    source_role: "receipt",
    status: "pending",
    classifier: "manual",
    needs_manual_amount: true,
  }).select("id").single();
  if (tx.error) throw new Error("Could not create draft");
  redirect(`/transactions/${tx.data.id}`);
}
