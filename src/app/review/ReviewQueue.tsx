"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { reviewInline, undoInline } from "../actions";
import { SwipeCard } from "./SwipeCard";

export interface QueueItem { id: string; merchant: string; amount: string; node: ReactNode }
export interface RecentItem { id: string; merchant: string; amount: string; status: "confirmed" | "rejected" }
interface ToastState { key: number; text: string; undoId?: string; error?: boolean }

/**
 * The review queue, decided on the phone first: a card disappears the moment you
 * accept/reject it and the server catches up in the background. Undo is just as
 * instant: the card comes back where it was and scrolls into view.
 */
export function ReviewQueue({ items, recent, empty }: { items: QueueItem[]; recent: RecentItem[]; empty: ReactNode }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [gen, setGen] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<RecentItem[]>(recent);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [sheet, setSheet] = useState(false);
  const inFlight = useRef(new Map<string, Promise<unknown>>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Server-side history arrives with each refresh; keep this session's decisions on top.
  useEffect(() => {
    setHistory((h) => [...h, ...recent.filter((r) => !h.some((x) => x.id === r.id))].slice(0, 10));
  }, [recent]);

  // Bring counts and the tab badge up to date once you pause.
  const refreshSoon = () => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 8000);
  };
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const setShown = (id: string, show: boolean) => setHidden((s) => {
    const n = new Set(s);
    if (show) n.delete(id); else n.add(id);
    return n;
  });

  function onSubmit(e: FormEvent<HTMLDivElement>) {
    const form = e.target as HTMLFormElement;
    const btn = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (btn?.name !== "decision") return;
    e.preventDefault();
    const fd = new FormData(form);
    fd.set("decision", btn.value);
    const id = String(fd.get("id") ?? "");
    const item = items.find((i) => i.id === id);
    if (!id || !item) return;
    const status: RecentItem["status"] = btn.value === "reject" ? "rejected" : "confirmed";

    setShown(id, false);
    setHistory((h) => [{ id, merchant: item.merchant, amount: item.amount, status }, ...h.filter((x) => x.id !== id)].slice(0, 10));
    setToast({ key: Date.now(), text: `${status === "confirmed" ? "Accepted" : "Rejected"} · ${item.merchant}`, undoId: id });

    const p = reviewInline(fd).then((r) => {
      if (r.ok) return refreshSoon();
      setShown(id, true);
      setGen((g) => ({ ...g, [id]: (g[id] ?? 0) + 1 }));
      setHistory((h) => h.filter((x) => x.id !== id));
      setToast({ key: Date.now(), text: r.error, error: true });
    });
    inFlight.current.set(id, p);
  }

  async function undo(id: string) {
    const entry = history.find((x) => x.id === id);
    const here = items.some((i) => i.id === id);
    setHistory((h) => h.filter((x) => x.id !== id));
    setSheet(false);
    if (here) {
      setGen((g) => ({ ...g, [id]: (g[id] ?? 0) + 1 })); // fresh card, back to its original state
      setShown(id, true);
      requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    setToast({ key: Date.now(), text: `${entry?.merchant ?? "Spend"} is back in Review` });
    await inFlight.current.get(id); // the decision must land before it can be undone
    const r = await undoInline(id);
    if (!r.ok) {
      if (here) setShown(id, false);
      setToast({ key: Date.now(), text: r.error ?? "Couldn't undo that one.", error: true });
      return;
    }
    if (here) refreshSoon();
    else router.refresh(); // decided before this page loaded: fetch the card back
  }

  const visible = items.filter((i) => !hidden.has(i.id));

  return (
    <>
      <div className="queue-bar">
        <span />
        {history.length > 0 && (
          <button type="button" className="btn queue-recent" onClick={() => setSheet(true)} aria-haspopup="dialog">
            <span aria-hidden="true">↺</span> Undo
          </button>
        )}
      </div>

      <div onSubmit={onSubmit}>
        {items.map((i) => hidden.has(i.id) ? null : (
          <div id={`card-${i.id}`} key={`${i.id}:${gen[i.id] ?? 0}`} className="queue-item">
            <SwipeCard>{i.node}</SwipeCard>
          </div>
        ))}
      </div>
      {visible.length === 0 && empty}

      {toast && <QueueToast key={toast.key} t={toast} onUndo={undo} onDone={() => setToast(null)} />}

      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-label="Recently reviewed" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-head">
              <strong>Recently reviewed</strong>
              <button type="button" className="btn plain" onClick={() => setSheet(false)}>Done</button>
            </div>
            <div className="list">
              {history.map((r) => (
                <div className="row" key={r.id}>
                  <div className="main">
                    <div className="title">{r.merchant}</div>
                    <div className="subtitle">
                      <span className={r.status === "confirmed" ? "good" : "bad"}>{r.status === "confirmed" ? "Accepted" : "Rejected"}</span> · {r.amount}
                    </div>
                  </div>
                  <button type="button" className="btn" onClick={() => undo(r.id)}>Undo</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QueueToast({ t, onUndo, onDone }: { t: ToastState; onUndo: (id: string) => void; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), t.undoId ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [t]);
  return (
    <div className={`toast${t.error ? " error" : ""}`} role="status" aria-live="polite">
      <span className="toast-msg">{t.text}</span>
      {t.undoId && <button type="button" className="toast-undo" onClick={() => { onUndo(t.undoId!); }}>Undo</button>}
    </div>
  );
}
