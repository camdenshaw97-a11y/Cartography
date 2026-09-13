"use client";
import React, { useEffect, useRef, useState } from "react";

export interface SheetProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;            // cancel / backdrop / swipe / Esc
  onDone?: () => void | boolean | Promise<void | boolean>;
  cancelLabel?: string;
  doneLabel?: string;
  noDone?: boolean;
}

/** iOS-style bottom sheet (centered dialog on desktop) with grabber, backdrop, swipe-to-dismiss, and Esc. */
export function Sheet({ title, children, onClose, onDone, cancelLabel = "Cancel", doneLabel = "Done", noDone }: SheetProps) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number | null; dy: number }>({ y0: null, dy: 0 });

  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(id); document.body.style.overflow = ""; document.removeEventListener("keydown", key); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() { setShow(false); setTimeout(onClose, 260); }
  async function done() { if (!onDone) return close(); setBusy(true); const r = await onDone(); if (r === false) setBusy(false); }

  function onTouchStart(e: React.TouchEvent) {
    const body = ref.current?.querySelector(".sbody");
    if (body && body.scrollTop > 0 && body.contains(e.target as Node)) return;
    drag.current = { y0: e.touches[0].clientY, dy: 0 };
    if (ref.current) ref.current.style.transition = "none";
  }
  function onTouchMove(e: React.TouchEvent) {
    if (drag.current.y0 == null || !ref.current) return;
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y0);
    ref.current.style.transform = `translateY(${drag.current.dy}px)`;
  }
  function onTouchEnd() {
    if (drag.current.y0 == null || !ref.current) return;
    ref.current.style.transition = "";
    if (drag.current.dy > 110) close(); else ref.current.style.transform = "";
    drag.current.y0 = null;
  }

  return (
    <>
      <div className={"backdrop" + (show ? " show" : "")} onClick={close} />
      <div ref={ref} className={"sheet" + (show ? " show" : "")} role="dialog" aria-modal="true" aria-label={title} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        <div className="shd">
          <button type="button" onClick={close}>{cancelLabel}</button>
          <h2>{title}</h2>
          <button type="button" className="done" onClick={done} disabled={busy} style={noDone ? { visibility: "hidden" } : undefined}>{doneLabel}</button>
        </div>
        <div className="sbody">{children}</div>
      </div>
    </>
  );
}
