import { useEffect, useRef, type ReactNode, type SVGProps } from "react";
import type { Tone } from "./data";

// ── Icons (original, 1.6px stroke) ──
const P = (p: SVGProps<SVGSVGElement>) => ({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });
export const I = {
  home: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" /></svg>,
  invoice: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>,
  quote: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M5 5h14v10H9l-4 4z" /><path d="M9 9h6M9 12h4" /></svg>,
  repeat: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M17 3l3 3-3 3" /><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3" /><path d="M20 12v3a3 3 0 0 1-3 3H4" /></svg>,
  users: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.2a3 3 0 0 1 0 5.6M17.5 14.2A5.5 5.5 0 0 1 20.5 19" /></svg>,
  box: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" /><path d="M4 7.5 12 11l8-3.5M12 11v9" /></svg>,
  bank: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" /></svg>,
  cog: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></svg>,
  plus: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M12 5v14M5 12h14" /></svg>,
  search: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>,
  back: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M15 18 9 12l6-6" /></svg>,
  arrow: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M9 6l6 6-6 6" /></svg>,
  x: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  check: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>,
  alert: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></svg>,
  info: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.1" /></svg>,
  chevrons: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="m8 10 4-4 4 4M8 14l4 4 4-4" /></svg>,
  more: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></svg>,
  copy: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>,
  trash: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  print: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>,
  mail: (p: SVGProps<SVGSVGElement>) => <svg {...P(p)}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>,
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

// Pointer-tracked illumination for every .tile.interactive on the page (one listener).
export function useTileLight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".tile") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useRef<number>(0);
  useEffect(() => { t.current = window.setTimeout(onDone, 3200); return () => clearTimeout(t.current); }, [text, onDone]);
  return <div className="toast glass" role="status"><I.check />{text}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}
