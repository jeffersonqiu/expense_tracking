import { getContext } from "@/lib/server/context";
import { addCategory, addHouseholdMember, inviteEmail, removeInvite, revokeIngestKey, saveHousehold, setAutoAccept, updateAiSettings } from "../actions";
import { money, sgtDateTime } from "@/lib/format";
import { Flash } from "@/app/Flash";
import { Nav } from "../Nav";
import { CreateKey } from "./CreateKey";
import Link from "next/link";

export const metadata = { title: "Settings · Expense Tracker" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const flash = await searchParams;
  const { db, uid, profile, categories, households, pendingCount } = await getContext();
  const isOwner = !!profile?.is_owner;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const hh = households.find((h) => h.owner_id === uid) ?? null;

  const [keys, hb, settings, usage, invites, rules, members] = await Promise.all([
    db.from("ingest_keys").select("id, label, key_prefix, created_at, last_used_at, revoked_at").eq("user_id", uid).order("created_at"),
    db.from("script_heartbeats").select("*").eq("user_id", uid).maybeSingle(),
    db.from("app_settings").select("ai_enabled, ai_monthly_cap_usd").single(),
    db.from("ai_usage").select("model, cost_usd").gte("created_at", monthStart),
    isOwner ? db.from("allowed_emails").select("email").order("created_at") : Promise.resolve({ data: [] as { email: string }[] }),
    db.from("merchant_rules").select("merchant_key, auto_accept, category_id, allocation").eq("user_id", uid).order("merchant_key"),
    hh ? db.from("household_members").select("user_id").eq("household_id", hh.id) : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]);
  const byModel = new Map<string, number>();
  for (const u of usage.data ?? []) byModel.set(u.model, (byModel.get(u.model) ?? 0) + Number(u.cost_usd));
  const spent = [...byModel.values()].reduce((a, b) => a + b, 0);
  const cap = Number(settings.data?.ai_monthly_cap_usd ?? 1);
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <>
      <Nav pending={pendingCount} />
      <main className="wrap">
        <Flash error={flash.error} ok={flash.ok} />
        <h1>Settings</h1>

        <h2>Gmail connector</h2>
        <div className="card">
          <p className="small">
            {hb.data ? <>Last seen <strong>{sgtDateTime(hb.data.last_seen_at)}</strong> · scanned {hb.data.scanned} · sent {hb.data.sent} · script v{hb.data.script_version ?? "?"}</> : "Not connected yet."}
            {hb.data?.last_error && <span className="error"> · last error: {hb.data.last_error}</span>}
          </p>
          <p className="small muted">Install guide: <code>apps-script/README.md</code> in the repository. Endpoint: <code>/api/ingest</code> on this site.</p>
          <CreateKey />
          <table style={{ marginTop: 10 }}>
            <tbody>
              {(keys.data ?? []).map((k) => (
                <tr key={k.id}>
                  <td>{k.label}<div className="small muted"><code>{k.key_prefix}…</code></div></td>
                  <td className="small muted">{k.last_used_at ? `used ${sgtDateTime(k.last_used_at)}` : "never used"}</td>
                  <td className="num">{k.revoked_at ? <span className="pill">revoked</span> : (
                    <form action={revokeIngestKey} className="inline"><input type="hidden" name="id" value={k.id} /><button className="btn danger small">Revoke</button></form>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small"><Link href="/missed">Emails the app skipped (check for anything missed)</Link></p>
        </div>

        <h2>AI cost control</h2>
        <div className="card">
          <p>This month: <strong>{money(spent, "USD")}</strong> of {money(cap, "USD")} cap</p>
          <div className="bar" style={{ marginBottom: 8 }}><span style={{ width: `${Math.min(100, (spent / Math.max(0.01, cap)) * 100)}%` }} /></div>
          {[...byModel.entries()].map(([m, v]) => <div key={m} className="small muted">{m}: {money(v, "USD")}</div>)}
          <p className="small muted">When the cap is reached or AI is off, emails still arrive and wait in Review untagged. The hard ceiling is your OpenRouter balance and key limit.</p>
          {isOwner && (
            <form action={updateAiSettings} className="row">
              <label className="check"><input type="checkbox" name="enabled" defaultChecked={!!settings.data?.ai_enabled} /> AI enabled</label>
              <label>Monthly cap (USD)<input name="cap" type="number" step="0.05" min="0" max="50" defaultValue={cap} style={{ width: 110 }} /></label>
              <button className="btn">Save</button>
            </form>
          )}
        </div>

        <h2>Household</h2>
        <div className="card">
          {households.filter((h) => h.owner_id !== uid).map((h) => <p key={h.id} className="small">Member of <strong>{h.name}</strong>.</p>)}
          {(isOwner || hh) && (
            <form action={saveHousehold} className="row">
              <input type="hidden" name="id" value={hh?.id ?? ""} />
              <label>Name<input name="name" defaultValue={hh?.name ?? "Household"} /></label>
              <label>Monthly budget<input name="budget" type="number" step="1" min="0" defaultValue={hh?.monthly_budget ?? 800} style={{ width: 120 }} /></label>
              <button className="btn">{hh ? "Save" : "Create household"}</button>
            </form>
          )}
          {hh && (
            <>
              <p className="small muted">Members: {(members.data ?? []).length}. To add your spouse, invite them below with "Add to household" ticked; they join on first sign-in.</p>
              <form action={addHouseholdMember} className="row">
                <input type="hidden" name="household_id" value={hh.id} />
                <input name="email" type="email" placeholder="Member's Gmail (already invited)" required style={{ maxWidth: 260 }} />
                <button className="btn">Add member</button>
              </form>
            </>
          )}
        </div>

        {isOwner && (
          <>
            <h2>Who can sign in</h2>
            <div className="card">
              {(invites.data ?? []).map((i) => (
                <div key={i.email} className="row" style={{ justifyContent: "space-between" }}>
                  <span>{i.email}</span>
                  {i.email !== profile?.email && (
                    <form action={removeInvite} className="inline"><input type="hidden" name="email" value={i.email} /><button className="btn link small">Remove</button></form>
                  )}
                </div>
              ))}
              <form action={inviteEmail} className="row" style={{ marginTop: 8 }}>
                <input name="email" type="email" placeholder="Invite by Gmail address" required style={{ maxWidth: 260 }} />
                {hh && <label className="check small"><input type="checkbox" name="household" defaultChecked /> Add to {hh.name}</label>}
                <button className="btn">Invite</button>
              </form>
            </div>
          </>
        )}

        <h2>Merchant rules</h2>
        <div className="card table-wrap">
          <p className="small muted">Learned from your reviews. Auto-accept records future spends from that merchant without review.</p>
          <table>
            <thead><tr><th>Merchant</th><th>Category</th><th>Allocation</th><th>Auto-accept</th></tr></thead>
            <tbody>
              {(rules.data ?? []).map((r) => (
                <tr key={r.merchant_key}>
                  <td>{r.merchant_key}</td>
                  <td>{catName.get(r.category_id) ?? "—"}</td>
                  <td>{r.allocation ?? "—"}</td>
                  <td>
                    <form action={setAutoAccept} className="inline">
                      <input type="hidden" name="merchant_key" value={r.merchant_key} />
                      <input type="hidden" name="on" value={r.auto_accept ? "0" : "1"} />
                      <button className="btn small">{r.auto_accept ? "On · turn off" : "Off · turn on"}</button>
                    </form>
                  </td>
                </tr>
              ))}
              {(rules.data ?? []).length === 0 && <tr><td colSpan={4} className="muted">No rules yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <h2>Categories</h2>
        <div className="card">
          <p className="small">{categories.map((c) => c.name).join(" · ")}</p>
          <form action={addCategory} className="row">
            <input name="name" placeholder="New category" maxLength={40} required style={{ maxWidth: 220 }} />
            <button className="btn">Add</button>
          </form>
        </div>
      </main>
    </>
  );
}
