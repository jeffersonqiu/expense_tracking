import Link from "next/link";
import { getContext } from "@/lib/server/context";
import { addCategory, inviteEmail, saveProject, setProjectStatus, learnNow, retireFact, removeInvite, revokeIngestKey, saveHousehold, updateAiSettings } from "../actions";
import { money, sgtDateTime } from "@/lib/format";
import { Shell, Header } from "../ui/Shell";
import { IconChevronRight, IconMail } from "../ui/Icons";
import { Flash } from "../Flash";
import { CreateKey } from "./CreateKey";

export const metadata = { title: "Settings · Expenses" };
export const maxDuration = 60;

const LATEST_SCRIPT = "1.1.0";

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return sgtDateTime(iso);
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, profile, categories, households, projects, pendingCount } = await getContext();
  const isOwner = !!profile?.is_owner;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const hh = households.find((h) => h.owner_id === uid) ?? null;
  const memberOf = households.filter((h) => h.owner_id !== uid);

  const [keys, hb, settings, usage, invites, facts, members, runs, log] = await Promise.all([
    db.from("ingest_keys").select("id, label, key_prefix, created_at, last_used_at, revoked_at").eq("user_id", uid).order("created_at"),
    db.from("script_heartbeats").select("*").eq("user_id", uid).maybeSingle(),
    db.from("app_settings").select("ai_enabled, ai_monthly_cap_usd").single(),
    db.from("ai_usage").select("model, cost_usd").gte("created_at", monthStart),
    isOwner ? db.from("allowed_emails").select("email, household_id").order("created_at") : Promise.resolve({ data: [] as { email: string; household_id: string | null }[] }),
    db.from("knowledge_facts").select("id, subject_type, subject, statement, conditions, support, contradictions, source, updated_at")
      .eq("user_id", uid).eq("active", true).order("support", { ascending: false }).limit(60),
    hh ? db.from("household_members").select("user_id").eq("household_id", hh.id) : Promise.resolve({ data: [] as { user_id: string }[] }),
    db.from("learn_runs").select("started_at, summary, error, facts_added, facts_updated, facts_retired, decisions_seen, corrections_seen, cost_usd")
      .eq("user_id", uid).order("started_at", { ascending: false }).limit(1),
    db.from("decision_log").select("decided_at, corrected_category, corrected_allocation")
      .eq("user_id", uid).in("decision", ["accept", "save"]).gte("decided_at", new Date(Date.now() - 28 * 86400e3).toISOString()).limit(2000),
  ]);
  // Accuracy: share of decisions where you kept the AI's suggestion, per week (most recent first)
  const weeks = [0, 1, 2, 3].map((w) => {
    const to = Date.now() - w * 7 * 86400e3;
    const from = to - 7 * 86400e3;
    const rows = (log.data ?? []).filter((r) => { const t = new Date(r.decided_at).getTime(); return t >= from && t < to; });
    const pct = (k: "corrected_category" | "corrected_allocation") => rows.length ? Math.round((rows.filter((r) => !r[k]).length / rows.length) * 100) : null;
    return { label: w === 0 ? "This week" : w === 1 ? "Last week" : `${w} weeks ago`, n: rows.length, cat: pct("corrected_category"), alloc: pct("corrected_allocation") };
  });
  const lastRun = runs.data?.[0];
  const byModel = new Map<string, number>();
  for (const u of usage.data ?? []) byModel.set(u.model, (byModel.get(u.model) ?? 0) + Number(u.cost_usd));
  const spent = [...byModel.values()].reduce((a, b) => a + b, 0);
  const cap = Number(settings.data?.ai_monthly_cap_usd ?? 1);
  const activeKeys = (keys.data ?? []).filter((k) => !k.revoked_at);
  const connected = hb.data && Date.now() - new Date(hb.data.last_seen_at).getTime() < 24 * 3600e3;

  return (
    <Shell active="settings" pending={pendingCount}>
      <Header title="Settings" sub={profile?.email} />
      <Flash error={flash.error} ok={flash.ok} />

      {/* Gmail connector */}
      <div className="section-label">Gmail connector</div>
      <div className="list">
        <div className="row">
          <div className={`avatar ${connected ? "good" : ""}`}><IconMail /></div>
          <div className="main">
            <div className="title">{hb.data ? (connected ? "Connected" : "Not checking in") : "Not set up"}</div>
            <div className="subtitle">
              {hb.data ? <>Last sync {ago(hb.data.last_seen_at)} · {hb.data.sent} sent · v{hb.data.script_version ?? "?"}</> : "Install the Apps Script in your Google account"}
            </div>
          </div>
          {connected && <span className="pill good">Active</span>}
        </div>
        {hb.data?.last_error && <div className="row"><div className="main small bad">Last error: {hb.data.last_error}</div></div>}
        {hb.data && (hb.data.script_version ?? "0") < LATEST_SCRIPT && (
          <div className="row"><div className="main small">
            <span className="pill warn">Update available</span> Script v{LATEST_SCRIPT} adds the &ldquo;Expense Tracker&rdquo; Gmail label. Paste the new apps-script/Code.gs, save, then run <strong>labelPast</strong> once.
          </div></div>
        )}
        {activeKeys.map((k) => (
          <div className="row" key={k.id}>
            <div className="main">
              <div className="title" style={{ fontWeight: 400 }}>{k.label}</div>
              <div className="subtitle"><span className="key">{k.key_prefix}…</span> · {k.last_used_at ? `used ${ago(k.last_used_at)}` : "never used"}</div>
            </div>
            <form action={revokeIngestKey} className="inline"><input type="hidden" name="id" value={k.id} /><button className="btn plain destructive">Revoke</button></form>
          </div>
        ))}
        <div className="row"><CreateKey /></div>
        <Link className="row" href="/missed">
          <div className="main"><div className="title" style={{ fontWeight: 400 }}>Skipped emails</div></div>
          <IconChevronRight className="chev" />
        </Link>
      </div>
      <div className="section-foot">The connector runs in your own Google account every 5 minutes. Setup guide: apps-script/README.md in the repository.</div>

      {/* Household */}
      <div className="section-label">Household</div>
      <div className="list">
        {memberOf.map((h) => (
          <div className="row" key={h.id}><div className="main"><div className="title" style={{ fontWeight: 400 }}>Member of {h.name}</div></div></div>
        ))}
        {(isOwner || hh) && (
          <form action={saveHousehold} className="row">
            <input type="hidden" name="id" value={hh?.id ?? ""} />
            <label className="field" style={{ flex: 2 }}><span>Name</span><input name="name" defaultValue={hh?.name ?? "Household"} /></label>
            <label className="field" style={{ flex: 1 }}><span>Monthly budget</span><input name="budget" type="number" inputMode="decimal" min="0" defaultValue={hh?.monthly_budget ?? 800} /></label>
            <button className="btn" style={{ alignSelf: "flex-end" }}>{hh ? "Save" : "Create"}</button>
          </form>
        )}
        {hh && <div className="row"><div className="main subtitle">{(members.data ?? []).length} {(members.data ?? []).length === 1 ? "member" : "members"} besides you</div></div>}
      </div>
      {hh && <div className="section-foot">To add your spouse, invite them below with &ldquo;Add to {hh.name}&rdquo; ticked. They join when they first sign in.</div>}

      {households.length > 0 && (
        <>
          <div className="section-label">Household projects</div>
          <div className="list">
            {projects.map((pr) => (
              <div className="row" key={pr.id} style={{ flexWrap: "wrap" }}>
                <form action={saveProject} style={{ display: "flex", gap: 8, flex: "1 1 260px", flexWrap: "wrap" }}>
                  <input type="hidden" name="id" value={pr.id} />
                  <input type="hidden" name="household_id" value={pr.household_id} />
                  <input name="name" defaultValue={pr.name} aria-label="Project name" style={{ flex: "2 1 140px" }} />
                  <input name="budget" type="number" inputMode="decimal" min="0" defaultValue={pr.budget ?? ""} placeholder="Budget" aria-label="Project budget" style={{ flex: "1 1 90px" }} />
                  <button className="btn">Save</button>
                </form>
                <form action={setProjectStatus} className="inline">
                  <input type="hidden" name="id" value={pr.id} />
                  <input type="hidden" name="status" value={pr.status === "open" ? "closed" : "open"} />
                  <button className="btn plain">{pr.status === "open" ? "Close" : "Reopen"}</button>
                </form>
              </div>
            ))}
            <form action={saveProject} className="row" style={{ flexWrap: "wrap" }}>
              <input type="hidden" name="household_id" value={households[0]!.id} />
              <input name="name" placeholder="New project, e.g. Renovation 2026" required maxLength={80} aria-label="New project name" style={{ flex: "2 1 160px" }} />
              <input name="budget" type="number" inputMode="decimal" min="0" placeholder="Budget (optional)" aria-label="Budget" style={{ flex: "1 1 120px" }} />
              <button className="btn primary">Add</button>
            </form>
          </div>
          <div className="section-foot">Projects track one-off home spending (renovation, furniture) outside the monthly allowance. They don&apos;t reset monthly.</div>
        </>
      )}
      {/* People */}
      {isOwner && (
        <>
          <div className="section-label">Who can sign in</div>
          <div className="list">
            {(invites.data ?? []).map((i) => (
              <div className="row" key={i.email}>
                <div className="avatar">{i.email.charAt(0).toUpperCase()}</div>
                <div className="main">
                  <div className="title" style={{ fontWeight: 400 }}>{i.email}</div>
                  <div className="subtitle">{i.email === profile?.email ? "You · owner" : i.household_id ? "Invited · household member" : "Invited"}</div>
                </div>
                {i.email !== profile?.email && (
                  <form action={removeInvite} className="inline"><input type="hidden" name="email" value={i.email} /><button className="btn plain destructive">Remove</button></form>
                )}
              </div>
            ))}
            <form action={inviteEmail} className="row" style={{ flexWrap: "wrap" }}>
              <input name="email" type="email" placeholder="Gmail address to invite" required aria-label="Email to invite" style={{ flex: "1 1 220px" }} />
              {hh && <label className="check small"><input type="checkbox" name="household" defaultChecked /> Add to {hh.name}</label>}
              <button className="btn primary">Invite</button>
            </form>
          </div>
        </>
      )}

      {/* AI */}
      <div className="section-label">AI and cost</div>
      <div className="list">
        <div className="row">
          <div className="main">
            <div className="title" style={{ fontWeight: 400 }}>AI status</div>
            <div className="subtitle">
              {!process.env.OPENROUTER_API_KEY ? "Not connected: add OPENROUTER_API_KEY in Vercel, then redeploy"
                : !settings.data?.ai_enabled ? "Turned off below"
                : spent >= cap ? "Paused: monthly cap reached"
                : `On · ${process.env.AI_DECIDER === "haiku" ? "Claude Haiku 5.5" : "Jev decides, Claude Haiku 5.5 reads amounts"}`}
            </div>
          </div>
          <span className={`pill ${process.env.OPENROUTER_API_KEY && settings.data?.ai_enabled && spent < cap ? "good" : "warn"}`}>
            {process.env.OPENROUTER_API_KEY && settings.data?.ai_enabled && spent < cap ? "Active" : "Off"}
          </span>
        </div>
        <div className="row bars" style={{ flexWrap: "wrap" }}>
          <div className="main"><div className="title" style={{ fontWeight: 400 }}>This month</div></div>
          <div className="trail num"><strong>{money(spent, "USD")}</strong> <span className="muted">of {money(cap, "USD")}</span></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (spent / Math.max(0.01, cap)) * 100)}%` }} /></div>
        </div>
        {[...byModel.entries()].map(([m, v]) => (
          <div className="row" key={m}><div className="main subtitle">{m}</div><div className="trail small num">{money(v, "USD")}</div></div>
        ))}
        {isOwner && (
          <form action={updateAiSettings} className="row" style={{ flexWrap: "wrap" }}>
            <label className="check"><input type="checkbox" name="enabled" defaultChecked={!!settings.data?.ai_enabled} /> Use AI for unknown emails</label>
            <label className="field" style={{ marginLeft: "auto", width: 140 }}><span>Monthly cap (USD)</span><input name="cap" type="number" step="0.05" min="0" max="50" defaultValue={cap} /></label>
            <button className="btn" style={{ alignSelf: "flex-end" }}>Save</button>
          </form>
        )}
      </div>
      <div className="section-foot">When the cap is reached, emails still arrive and wait in Review untagged. Your OpenRouter balance is the hard ceiling.</div>

      {/* Learning */}
      <div className="section-label">Learning</div>
      <div className="list">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <div className="main">
            <div className="title" style={{ fontWeight: 400 }}>{lastRun ? `Last learned ${sgtDateTime(lastRun.started_at)}` : "Hasn't learned yet"}</div>
            <div className="subtitle" style={{ whiteSpace: "normal" }}>
              {lastRun?.error ? <span className="bad">Last run failed: {lastRun.error}</span>
                : lastRun ? `${lastRun.summary ?? ""} · ${lastRun.decisions_seen} decisions, ${lastRun.corrections_seen} corrections`
                : "Learns automatically once a week from your decisions, especially the ones you corrected."}
            </div>
          </div>
          <form action={learnNow} className="inline"><button className="btn">Learn now</button></form>
        </div>
      </div>
      <div className="section-foot">Runs weekly with Claude Sonnet 5.5 (about $0.05–0.15 per run, within your AI cap).</div>

      <div className="section-label">How often you kept the AI&apos;s suggestion</div>
      <div className="list">
        {weeks.map((w) => (
          <div className="row" key={w.label}>
            <div className="main"><div className="title" style={{ fontWeight: 400 }}>{w.label}</div><div className="subtitle">{w.n} decisions</div></div>
            <div className="trail small num">
              {w.n ? <>Category <strong>{w.cat}%</strong> · Allocation <strong>{w.alloc}%</strong></> : <span className="faint">—</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="section-label">What it has learned</div>
      <div className="list">
        {(facts.data ?? []).length === 0 && <div className="row empty">Nothing yet. Review some spends, then tap Learn now.</div>}
        {(facts.data ?? []).map((f) => (
          <div className="row" key={f.id}>
            <div className="main">
              <div className="title" style={{ fontWeight: 400, whiteSpace: "normal" }}>{f.statement}</div>
              <div className="subtitle" style={{ whiteSpace: "normal" }}>
                {f.conditions ? `When ${f.conditions} · ` : ""}seen {f.support}×{f.contradictions ? `, ${f.contradictions} exceptions` : ""}
                {f.source === "imported" ? " · from your old remembered choices" : ""}
              </div>
            </div>
            <form action={retireFact} className="inline">
              <input type="hidden" name="id" value={f.id} />
              <button className="btn plain destructive" aria-label="Remove this fact">Remove</button>
            </form>
          </div>
        ))}
      </div>
      <div className="section-foot">Remove anything that&apos;s wrong; the app stops using it immediately.</div>

      {/* Categories */}
      <div className="section-label">Categories</div>
      <div className="list">
        <div className="row"><div className="tags">{categories.map((c) => <span className="pill" key={c.id}>{c.name}</span>)}</div></div>
        <form action={addCategory} className="row">
          <input name="name" placeholder="New category" maxLength={40} required aria-label="New category" />
          <button className="btn">Add</button>
        </form>
      </div>
    </Shell>
  );
}
