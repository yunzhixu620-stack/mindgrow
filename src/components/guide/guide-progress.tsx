"use client";

import { useEffect, useState } from "react";

export function GuideProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-guide-scroll]");
    if (!scroller) return;
    const update = () => {
      const distance = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      setProgress(Math.min(100, Math.max(0, (scroller.scrollTop / distance) * 100)));
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 bg-white/5" aria-hidden="true">
      <div data-testid="guide-progress" className="h-full bg-[var(--primary)] shadow-[0_0_10px_rgba(34,211,167,0.55)] transition-[width] duration-100" style={{ width: `${progress}%` }} />
    </div>
  );
}
