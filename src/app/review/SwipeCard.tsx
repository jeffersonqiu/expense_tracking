"use client";

import { useRef, useState } from "react";

/**
 * Tinder-style swipe for a review card: right = Accept, left = Reject.
 * Touch/pen only (mouse users keep the buttons). Vertical scrolling is left to
 * the browser via `touch-action: pan-y`; we only take over once the gesture is
 * clearly horizontal.
 */
export function SwipeCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiping = useRef(false);
  const swiped = useRef(false);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0);
  const [hidden, setHidden] = useState(false);
  const [dragging, setDragging] = useState(false);

  const threshold = () => Math.max(90, (ref.current?.offsetWidth ?? 300) * 0.3);

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" || leaving) return;
    const t = e.target as HTMLElement;
    if (t.closest("input[type=text], input[type=number], input[type=datetime-local], input:not([type]), select, textarea, pre")) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiping.current = false;
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!swiping.current) {
      if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5) {
        swiping.current = true;
        setDragging(true);
        ref.current?.setPointerCapture(e.pointerId);
      } else if (Math.abs(my) > 12) {
        start.current = null; // vertical scroll: let it go
        return;
      } else return;
    }
    const crossed = Math.abs(mx) > threshold() !== Math.abs(dx) > threshold();
    if (crossed && "vibrate" in navigator) navigator.vibrate?.(8);
    setDx(mx);
  }

  function finish() {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || !swiping.current) return;
    swiped.current = true; // swallow the click that follows the swipe
    setTimeout(() => (swiped.current = false), 50);
    if (Math.abs(dx) < threshold()) {
      setDx(0);
      return;
    }
    const dir = dx > 0 ? 1 : -1;
    const form = ref.current?.querySelector("form");
    const btn = form?.querySelector<HTMLButtonElement>(`button[name="decision"][value="${dir > 0 ? "accept" : "reject"}"]`);
    if (!form || !btn) {
      setDx(0);
      return;
    }
    if (dir > 0 && !form.checkValidity()) {
      setDx(0);
      form.reportValidity();
      return;
    }
    setLeaving(dir);
    setTimeout(() => {
      setHidden(true);
      form.requestSubmit(btn);
    }, 220);
  }

  const width = ref.current?.offsetWidth ?? 360;
  const x = leaving ? leaving * width * 1.3 : dx;
  const p = Math.min(1, Math.abs(dx) / threshold());

  return (
    <div className="swipe-wrap" style={{ display: hidden ? "none" : undefined }}>
      <div className={`swipe-hint accept ${dx > 0 ? "show" : ""}`} style={{ opacity: dx > 0 ? p : 0 }} aria-hidden="true">✓ Accept</div>
      <div className={`swipe-hint reject ${dx < 0 ? "show" : ""}`} style={{ opacity: dx < 0 ? p : 0 }} aria-hidden="true">Reject ✕</div>
      <div
        ref={ref}
        className="swipe-card"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={() => { start.current = null; setDragging(false); setDx(0); }}
        onClickCapture={(e) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); } }}
        style={{
          transform: x ? `translateX(${x}px) rotate(${x / 28}deg)` : undefined,
          transition: dragging ? "none" : "transform 0.22s ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
