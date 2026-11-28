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
import { keywordCategory, merchantKey, displayMerchant, isHouseholdUtility } from "@/lib/pipeline/categorize";
import { knowledgeFor } from "@/lib/server/knowledge";
import { learnForUser } from "@/lib/server/learn";
import { sgtWhen } from "@/lib/pipeline/process";
import { makeDecider } from "@/lib/server/ingest";

const KINDS = ["spend", "refund", "investment", "transfer", "income"] as const;
const ALLOCATIONS = ["personal", "work", "shared", "household"] as const;
const CLAIM = ["to_claim", "submitted", "reimbursed"] as const;

/** Send the user back to a page with a readable message (server actions must not crash the page). */
function back(path: string, msg: string, kind: "error" | "ok" = "error"): never {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path.split("?")[0]! : "/";
  redirect(`${safe}?${kind}=${encodeURIComponent(msg)}`);
}

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

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optId = z.string().regex(ID).optional().or(z.literal(""));

const TxnForm = z.object({
  id: optId,
  decision: z.enum(["accept", "reject", "save"]).default("accept"),
  occurred_at: z.string(),
  // numeric(14,2) holds up to 999,999,999,999.99 (large IDR/JPY amounts are normal)
  amount: z.coerce.number().min(0).max(999_999_999_999),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  kind: z.enum(KINDS),
  merchant: z.string().trim().transform((v) => v.slice(0, 120)),
  category_id: optId,
  allocation: z.enum(ALLOCATIONS),
  claim_status: z.enum(CLAIM).optional().or(z.literal("")),
  household_id: optId,
  household_pot: z.enum(["allowance", "bills", "project"]).optional().or(z.literal("")),
  project_id: z.string().regex(ID).optional().or(z.literal("")).or(z.literal("__new")),
  new_project_name: z.string().trim().max(80).optional(),
  description: z.string().transform((v) => v.slice(0, 500)).optional(),
  shares: z.string().max(2000).optional(),
  return_to: z.string().optional(),
});

const FIELD_LABELS: Record<string, string> = {
  amount: "Amount", currency: "Currency (3 letters, e.g. SGD)", kind: "Type", merchant: "Merchant",
  category_id: "Category", allocation: "Allocation", claim_status: "Claim status", household_id: "Household",
  household_pot: "Household pot", project_id: "Project", new_project_name: "Project name",
  occurred_at: "Date", shares: "Who owes you", id: "Transaction", decision: "Action",
};

/** Accept / reject / save one transaction (also creates manual ones when id is empty). */
export async function saveTransaction(fd: FormData) {
  const { db, uid, profile, categories, projects } = await getContext();
  const returnTo = str(fd, "return_to") || "/review";
  const parsed = TxnForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => FIELD_LABELS[String(i.path[0])] ?? String(i.path[0])))];
    console.error("saveTransaction validation", parsed.error.issues);
    back(returnTo, `Please check: ${fields.join(", ")}.`);
  }
  const f = parsed.data;
  const occurred = fromLocalInput(f.occurred_at);
  if (!occurred) back(returnTo, "Please enter a valid date and time.");
  const base = profile?.base_currency ?? "SGD";
  const rate = await fxRate(adminClient(), f.currency, base, occurred);
  const allocation = f.allocation;
  const key = merchantKey(f.merchant || "manual");

  if (allocation === "household" && !f.household_id) back(returnTo, "Choose a household (create one in Settings first).");

  // Household pot and project (a new project can be started right from the card)
  const pot = allocation === "household" ? f.household_pot || "allowance" : null;
  let projectId: string | null = null;
  if (pot === "project") {
    if (f.project_id && f.project_id !== "__new") projectId = f.project_id;
    else {
      if (!f.new_project_name) back(returnTo, "Name the new project (or pick an existing one).");
      const np = await db.from("household_projects")
        .insert({ household_id: f.household_id, name: f.new_project_name, created_by: uid }).select("id").single();
      if (np.error) {
        console.error("create project", np.error);
        back(returnTo, "Couldn't create that project.");
      }
      projectId = np.data.id;
    }
  }

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
    household_pot: pot,
    project_id: projectId,
    description: f.description || null,
    needs_manual_amount: false,
    status: f.decision === "reject" ? "rejected" : f.decision === "accept" ? "confirmed" : undefined,
    reviewed_at: f.decision === "save" ? undefined : new Date().toISOString(),
  };

  let id = f.id || "";
  const before = id
    ? (await db.from("transactions")
        .select("suggestion, merchant_raw, merchant, counterparty_type, payment_method, occurred_at, category_id, allocation, household_pot, classifier, confidence, source_emails(body_text)")
        .eq("id", id).eq("user_id", uid).maybeSingle()).data
    : null;
  if (id) {
    const { error } = await db.from("transactions").update(fields).eq("id", id).eq("user_id", uid);
    if (error) {
      console.error("saveTransaction update", error);
      back(returnTo, "Could not save that transaction.");
    }
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
    if (ins.error) {
      console.error("saveTransaction insert", ins.error);
      back(returnTo, "Could not save that transaction.");
    }
    id = ins.data.id;
  }

  // Shares for "shared, I paid first"
  await db.from("shared_shares").delete().eq("transaction_id", id).eq("user_id", uid).is("settled_at", null);
  if (allocation === "shared" && f.shares) {
    const shares = parseShares(f.shares).map((s) => ({ ...s, transaction_id: id, user_id: uid }));
    if (shares.length) await db.from("shared_shares").insert(shares);
  }

  // Log the decision for the learning loop (what was suggested vs what you chose).
  if (before || !f.id) {
    const catName = (cid: string | null | undefined) => categories.find((c) => c.id === cid)?.name ?? null;
    type Sug = { category?: string | null; allocation?: string | null; pot?: string | null; confidence?: Record<string, number>; source?: string };
    const suggested: Sug = (before?.suggestion as Sug | null) ?? (before ? {
      category: catName(before.category_id), allocation: before.allocation, pot: before.household_pot,
      confidence: { category: Number(before.confidence ?? 0) }, source: before.classifier ?? "unknown",
    } : {});
    const finalCategory = catName(f.category_id || null);
    const finalAllocation = allocation;
    const finalPot = pot;
    const email = before?.source_emails as unknown as { body_text?: string } | null;
    const { error: logErr } = await db.from("decision_log").insert({
      user_id: uid,
      transaction_id: id,
      decision: f.decision,
      merchant: (before?.merchant_raw ?? before?.merchant ?? f.merchant) || null,
      merchant_key: key,
      amount: f.amount,
      currency: f.currency,
      occurred_at: occurred,
      local_time: sgtWhen(occurred),
      counterparty_type: before?.counterparty_type ?? null,
      payment_method: before?.payment_method ?? null,
      snippet: email?.body_text?.replace(/\s+/g, " ").slice(0, 400) ?? f.description ?? null,
      suggested,
      final_category: finalCategory,
      final_kind: f.kind,
      final_allocation: finalAllocation,
      final_pot: finalPot,
      final_project: projectId ? projects.find((p) => p.id === projectId)?.name ?? f.new_project_name ?? null : null,
      corrected_category: !!f.id && f.decision !== "reject" && (suggested.category ?? null) !== finalCategory,
      corrected_allocation: !!f.id && f.decision !== "reject" && (suggested.allocation ?? "personal") !== finalAllocation,
      corrected_pot: !!f.id && f.decision !== "reject" && finalAllocation === "household" && (suggested.pot ?? null) !== finalPot,
    });
    if (logErr) console.error("decision_log", logErr);
  }

  revalidatePath("/", "layout");
  // From the review queue: come back with a short-lived Undo toast for this decision.
  if (returnTo === "/review" && f.decision !== "save") redirect(`/review?done=${id}`);
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
  const st = z.enum(CLAIM).safeParse(str(fd, "status"));
  if (!st.success) back("/balances", "Unknown claim status.");
  const status = st.data;
  const ids = fd.getAll("id").filter((x): x is string => typeof x === "string");
  if (ids.length) await db.from("transactions").update({ claim_status: status }).in("id", ids).eq("user_id", uid).eq("allocation", "work");
  revalidatePath("/balances");
}

export async function settleShare(fd: FormData) {
  const { db, uid } = await getContext();
  const id = str(fd, "id");
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
  const id = str(fd, "id");
  await db.from("ingest_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", uid);
  revalidatePath("/settings");
}

export async function updateAiSettings(fd: FormData) {
  const { db, profile } = await getContext();
  if (!profile?.is_owner) back("/settings", "Only the owner can change AI settings.");
  const capRes = z.coerce.number().min(0).max(50).safeParse(str(fd, "cap"));
  if (!capRes.success) back("/settings", "The monthly cap must be between 0 and 50 USD.");
  const cap = capRes.data;
  await db.from("app_settings").update({ ai_enabled: fd.get("enabled") === "on", ai_monthly_cap_usd: cap, updated_at: new Date().toISOString() }).eq("id", true);
  revalidatePath("/settings");
}

export async function inviteEmail(fd: FormData) {
  const { db, uid, profile, households } = await getContext();
  if (!profile?.is_owner) back("/settings", "Only the owner can invite people.");
  const emailRes = z.string().email().safeParse(str(fd, "email").toLowerCase());
  if (!emailRes.success) back("/settings", "That doesn't look like an email address.");
  const email = emailRes.data;
  const hh = fd.get("household") === "on" ? households.find((h) => h.owner_id === uid) ?? null : null;
  const { error } = await db.from("allowed_emails").upsert({ email, invited_by: uid, household_id: hh?.id ?? null });
  if (error) {
    console.error("inviteEmail", error);
    back("/settings", "Could not save the invite.");
  }
  if (hh) {
    // Already signed in before? Add them to the household now.
    const p = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    if (p.data) await db.from("household_members").upsert({ household_id: hh.id, user_id: p.data.id });
  }
  revalidatePath("/settings");
  back("/settings", `Invited ${email}. They can now sign in with Google${hh ? ` and will join ${hh.name}` : ""}.`, "ok");
}

export async function removeInvite(fd: FormData) {
  const { db, profile } = await getContext();
  if (!profile?.is_owner) back("/settings", "Only the owner can remove invites.");
  await db.from("allowed_emails").delete().eq("email", str(fd, "email"));
  revalidatePath("/settings");
}

export async function saveHousehold(fd: FormData) {
  const { db, uid } = await getContext();
  const name = str(fd, "name").slice(0, 60) || "Household";
  const budgetRes = z.coerce.number().min(0).max(1_000_000).safeParse(str(fd, "budget") || "800");
  if (!budgetRes.success) back("/settings", "Budget must be a number.");
  const id = str(fd, "id");
  const { error } = id
    ? await db.from("households").update({ name, monthly_budget: budgetRes.data }).eq("id", id).eq("owner_id", uid)
    : await db.from("households").insert({ name, monthly_budget: budgetRes.data, owner_id: uid });
  if (error) {
    console.error("saveHousehold", error);
    back("/settings", "Could not save the household.");
  }
  revalidatePath("/", "layout");
  back("/settings", "Household saved.", "ok");
}

export async function addHouseholdMember(fd: FormData) {
  const { db, uid } = await getContext();
  const hid = str(fd, "household_id");
  const emailRes = z.string().email().safeParse(str(fd, "email").toLowerCase());
  if (!emailRes.success) back("/settings", "That doesn't look like an email address.");
  const email = emailRes.data;
  const owns = await db.from("households").select("id, name").eq("id", hid).eq("owner_id", uid).maybeSingle();
  if (!owns.data) back("/settings", "You can only add members to your own household.");
  const p = await db.from("profiles").select("id").eq("email", email).maybeSingle();
  if (p.data) {
    await db.from("household_members").upsert({ household_id: hid, user_id: p.data.id });
    revalidatePath("/settings");
    back("/settings", `${email} added to ${owns.data.name}.`, "ok");
  }
  // Not signed in yet: attach the household to their invite so they join on first sign-in.
  const inv = await db.from("allowed_emails").update({ household_id: hid }).eq("email", email).select("email");
  if (!inv.data?.length) back("/settings", `Invite ${email} first (under "Who can sign in"), ticking "Add to household".`);
  revalidatePath("/settings");
  back("/settings", `${email} will join ${owns.data.name} when they first sign in.`, "ok");
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
  const id = str(fd, "id");
  const src = await db.from("source_emails").select("id, received_at, from_address, subject").eq("id", id).eq("user_id", uid).single();
  if (src.error) back("/missed", "That email could not be found.");
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
  if (tx.error) back("/missed", "A draft for this email already exists, or it could not be created.");
  redirect(`/transactions/${tx.data.id}`);
}

/** Fill in categories for pending spends that don't have one yet (memory -> rules -> AI). */
export async function suggestCategories() {
  const { db, uid, categories, households } = await getContext();
  const { data } = await db.from("transactions")
    .select("id, merchant, merchant_raw, merchant_key, amount, currency, occurred_at, counterparty_type, payment_method, kind, source_emails(body_text)")
    .eq("user_id", uid).eq("status", "pending").is("duplicate_of", null).is("category_id", null)
    .neq("kind", "transfer").order("occurred_at").limit(20);
  const rows = data ?? [];
  if (rows.length === 0) back("/review", "Every waiting spend already has a category.", "ok");

  const admin = adminClient();
  const ai = await makeDecider(admin, uid).catch(() => null);
  if (!ai) back("/review", "AI is off or over budget: check Settings → AI and cost.");
  const knowledge = await knowledgeFor(admin, uid);
  const byName = new Map(categories.map((c) => [c.name, c.id]));
  const hasHousehold = households.length > 0;
  let filled = 0;
  let aiFailed = false;

  const one = async (t: (typeof rows)[number]) => {
    const raw = t.merchant_raw ?? t.merchant ?? "";
    try {
      const email = t.source_emails as unknown as { body_text: string } | null;
      const d = await ai.decide({
        merchant: raw, amount: Number(t.amount), currency: t.currency, snippet: email?.body_text?.slice(0, 1500) ?? "",
        counterparty: t.counterparty_type ?? undefined, when: sgtWhen(t.occurred_at), paymentMethod: t.payment_method ?? undefined,
        keywordHint: keywordCategory(raw), utilityHint: isHouseholdUtility(raw), hasHousehold,
        knowledge: await knowledge({ merchantKey: t.merchant_key ?? merchantKey(raw), merchantRaw: raw, counterparty: t.counterparty_type ?? "unknown" }),
      }, categories.map((c) => c.name));
      const catId = d.category ? byName.get(d.category) : undefined;
      if (!catId) return;
      const allocation = d.allocation === "household" && !hasHousehold ? "personal" : d.allocation ?? "personal";
      const pot = allocation === "household" ? (d.pot === "project" ? "allowance" : d.pot ?? "allowance") : null;
      const suggestion = {
        category: d.category, allocation, pot, source: ai.name,
        confidence: { category: d.categoryConfidence, allocation: d.allocationConfidence, pot: d.potConfidence },
      };
      await db.from("transactions").update({
        category_id: catId, allocation, household_pot: pot,
        household_id: allocation === "household" ? households[0]!.id : null,
        claim_status: allocation === "work" ? "to_claim" : null,
        classifier: ai.name, confidence: d.categoryConfidence, suggestion,
      }).eq("id", t.id).eq("user_id", uid);
      filled++;
    } catch (err) {
      console.error("suggestCategories AI", err);
      aiFailed = true;
    }
  };

  for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map(one));
  revalidatePath("/review");
  back("/review", `Suggested categories for ${filled} of ${rows.length} spends.${aiFailed ? " Some AI calls failed or hit the monthly cap." : ""}`, filled ? "ok" : "error");
}

/** Put an accepted/rejected spend back into the review queue. */
export async function undoReview(fd: FormData) {
  const { db, uid } = await getContext();
  const id = str(fd, "id");
  const { data, error } = await db.from("transactions")
    .update({ status: "pending", reviewed_at: null })
    .eq("id", id).eq("user_id", uid).in("status", ["confirmed", "rejected"]).is("duplicate_of", null)
    .select("merchant").maybeSingle();
  if (error || !data) back("/review", "Couldn't undo that one.");
  // The decision was reverted: don't let the learning loop learn from it.
  const last = await adminClient().from("decision_log").select("id").eq("user_id", uid).eq("transaction_id", id)
    .order("decided_at", { ascending: false }).limit(1).maybeSingle();
  if (last.data) await adminClient().from("decision_log").delete().eq("id", last.data.id).eq("user_id", uid);
  revalidatePath("/", "layout");
  back("/review", `${data.merchant ?? "Spend"} is back in Review.`, "ok");
}

/** Create or update a household project (name + optional budget). */
export async function saveProject(fd: FormData) {
  const { db, uid, households } = await getContext();
  const hid = str(fd, "household_id");
  if (!households.some((h) => h.id === hid)) back("/settings", "Choose a household first.");
  const name = str(fd, "name").slice(0, 80);
  if (!name) back("/settings", "Give the project a name.");
  const budgetRaw = str(fd, "budget");
  const budget = budgetRaw ? Number(budgetRaw.replace(/,/g, "")) : null;
  if (budget != null && (!Number.isFinite(budget) || budget < 0)) back("/settings", "Budget must be a positive number.");
  const id = str(fd, "id");
  const { error } = id
    ? await db.from("household_projects").update({ name, budget }).eq("id", id).eq("household_id", hid)
    : await db.from("household_projects").insert({ household_id: hid, name, budget, created_by: uid });
  if (error) {
    console.error("saveProject", error);
    back("/settings", "Couldn't save the project.");
  }
  revalidatePath("/", "layout");
  back("/settings", `Project "${name}" saved.`, "ok");
}

export async function setProjectStatus(fd: FormData) {
  const { db } = await getContext();
  const status = str(fd, "status") === "closed" ? "closed" : "open";
  await db.from("household_projects").update({ status }).eq("id", str(fd, "id"));
  revalidatePath("/", "layout");
  back("/settings", status === "closed" ? "Project closed." : "Project reopened.", "ok");
}

/** Settings → "Learn now": run the learning loop for the signed-in user. */
export async function learnNow() {
  const { uid } = await getContext();
  const r = await learnForUser(adminClient(), uid);
  revalidatePath("/settings");
  back("/settings", r.ok ? `${r.summary} (${r.added} new, ${r.updated} refined, ${r.retired} retired)` : r.summary, r.ok ? "ok" : "error");
}

/** Switch off a learned fact the user says is wrong. */
export async function retireFact(fd: FormData) {
  const { db, uid } = await getContext();
  await db.from("knowledge_facts").update({ active: false, updated_at: new Date().toISOString() }).eq("id", str(fd, "id")).eq("user_id", uid);
  revalidatePath("/settings");
  back("/settings", "Removed. The app won't use that fact any more.", "ok");
}
