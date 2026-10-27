import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { data, type Doc } from "./data";
import { I, Toast, useTileLight } from "./ui";
import Home from "./pages/Home";
import { DocList, DocView } from "./pages/Documents";
import Editor from "./pages/Editor";
import { CustomerList, CustomerView } from "./pages/Customers";
import RecurringPage from "./pages/Recurring";
import Items from "./pages/Items";
import { Banking, Settings, NotSetUp } from "./pages/Other";

// ── Router: in-memory, so it works inside the private preview frame (which only passes plain #names).
// Links keep href="#/path" for readability; a single click handler turns them into route changes.
let current = "/";
const listeners = new Set<() => void>();
export const routeQuery = () => new URLSearchParams(current.split("?")[1] ?? "");
export const go = (path: string) => { current = path; listeners.forEach((l) => l()); window.scrollTo(0, 0); };
export function useRoute() {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => setPath(current);
    listeners.add(on);
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href^='#/']") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      e.preventDefault(); go(a.getAttribute("href")!.slice(1));
    };
    document.addEventListener("click", click);
    return () => { listeners.delete(on); document.removeEventListener("click", click); };
  }, []);
  return path.split("?")[0].split("/").filter(Boolean);
}

// ── App state: active company + documents created in this session ──
export type Draft = Doc & { kind: "invoice" | "quote"; companyId: string; status: "draft"; message: string | null };
type Ctx = {
  companyId: string; setCompanyId: (id: string) => void;
  drafts: Draft[]; saveDraft: (d: Draft) => void; notify: (t: string) => void;
};
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

const NAV = [
  { path: "/", label: "Home", icon: I.home },
  { path: "/invoices", label: "Invoices", icon: I.invoice },
  { path: "/quotes", label: "Quotes", icon: I.quote },
  { path: "/customers", label: "Customers", icon: I.users },
  { path: "/recurring", label: "Recurring", icon: I.repeat },
  { path: "/items", label: "Items", icon: I.box },
  { path: "/banking", label: "Bank", icon: I.bank, soon: "Next" },
  { path: "/settings", label: "Settings", icon: I.cog },
];
const COMPANY_STYLE: Record<string, string> = {
  "logia-services": "linear-gradient(140deg,#8ff0f6,#5be4ef)",
  "logi-ink": "linear-gradient(140deg,#b3c0ff,#7a92ff)",
};
const initials = (n: string) => n.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

function CompanySwitch() {
  const { companyId, setCompanyId } = useApp();
  const [open, setOpen] = useState(false);
  const co = data.companies.find((c) => c.id === companyId)!;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest(".co-switch")) setOpen(false); };
    addEventListener("mousedown", close); addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div className="co-switch">
      <button className="co-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="co-dot" style={{ background: COMPANY_STYLE[co.id] }}>{initials(co.displayName.replace(/\(Pty\) Ltd/, ""))}</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="co-name" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.displayName.replace(" (Pty) Ltd", "")}</span>
          <span className="co-meta">Switch company</span>
        </span>
        <I.chevrons width={16} height={16} className="faint" />
      </button>
      {open && (
        <div className="co-menu glass" role="menu">
          {data.companies.map((c) => (
            <button key={c.id} role="menuitemradio" aria-checked={c.id === companyId} onClick={() => { setCompanyId(c.id); setOpen(false); go("/"); }}>
              <span className="co-dot" style={{ background: COMPANY_STYLE[c.id] }}>{initials(c.displayName.replace(/\(Pty\) Ltd/, ""))}</span>
              <span style={{ flex: 1 }}>
                <span className="co-name" style={{ display: "block" }}>{c.displayName}</span>
                <span className="co-meta">{c.id === "logi-ink" ? "Not set up yet" : "Imported from Sage"}</span>
              </span>
              {c.id === companyId && <I.check width={16} height={16} style={{ color: "var(--accent)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ children, active }: { children: ReactNode; active: string }) {
  const cur = (p: string) => (p === "/" ? active === "" : active === p.slice(1)) ? "page" : undefined;
  return (
    <div className="shell">
      <aside className="rail" aria-label="Main">
        <div className="wordmark" aria-label="Accounting666">Accounting<b>666</b></div>
        <CompanySwitch />
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={"#" + n.path} aria-current={cur(n.path)}>
              <n.icon />{n.label}{n.soon && <span className="soon">{n.soon}</span>}
            </a>
          ))}
        </nav>
        <div className="rail-foot">Logi-Ink internal · prototype<br />Sage data as at {data.sourceExtractedAt.slice(0, 10)}</div>
      </aside>
      <header className="topbar">
        <div className="wordmark" style={{ padding: 0 }}>A<b>666</b></div>
        <CompanySwitch />
        <a className="icon-btn" href="#/settings" aria-label="Settings"><I.cog /></a>
      </header>
      <main className="main" id="main">{children}</main>
      <nav className="tabbar" aria-label="Main">
        {[NAV[0], NAV[1], NAV[2], NAV[3], { path: "/more", label: "More", icon: I.more }].map((n) => (
          <a key={n.path} href={"#" + n.path} aria-current={n.path === "/more" ? (["recurring", "items", "banking", "settings", "more"].includes(active) ? "page" : undefined) : cur(n.path)}>
            <n.icon />{n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

function More() {
  return (
    <div className="page">
      <div className="page-head"><h1>More</h1></div>
      <div className="stack">
        {NAV.slice(4).map((n) => (
          <a key={n.path} href={"#" + n.path} className="glass tile interactive" style={{ display: "flex", alignItems: "center", gap: 14, padding: 18 }}>
            <n.icon width={20} height={20} style={{ color: "var(--accent)" }} /><span style={{ flex: 1, fontWeight: 560 }}>{n.label}</span><I.arrow width={16} height={16} className="faint" />
          </a>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  useTileLight();
  const route = useRoute();
  const [companyId, setCompanyId] = useState("logia-services");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const saveDraft = useCallback((d: Draft) => setDrafts((all) => [d, ...all.filter((x) => x.number !== d.number)]), []);
  const ctx = useMemo(() => ({ companyId, setCompanyId, drafts, saveDraft, notify: setToast }), [companyId, drafts, saveDraft]);

  const [a, b] = route;
  let page: ReactNode;
  if (companyId === "logi-ink" && !["settings", "more"].includes(a ?? "")) page = <NotSetUp />;
  else if (!a) page = <Home />;
  else if (a === "invoices" && b === "new") page = <Editor kind="invoice" key="new-inv" />;
  else if (a === "quotes" && b === "new") page = <Editor kind="quote" key="new-quo" />;
  else if ((a === "invoices" || a === "quotes") && b) page = <DocView kind={a === "invoices" ? "invoice" : "quote"} id={b} key={a + b} />;
  else if (a === "invoices") page = <DocList kind="invoice" key="li" />;
  else if (a === "quotes") page = <DocList kind="quote" key="lq" />;
  else if (a === "customers" && b) page = <CustomerView id={Number(b)} key={b} />;
  else if (a === "customers") page = <CustomerList />;
  else if (a === "recurring") page = <RecurringPage />;
  else if (a === "items") page = <Items />;
  else if (a === "banking") page = <Banking />;
  else if (a === "settings") page = <Settings />;
  else if (a === "more") page = <More />;
  else page = <div className="page"><h1>Page not found</h1><p className="sub"><a href="#/">Go to Home</a></p></div>;

  return (
    <AppCtx.Provider value={ctx}>
      <Shell active={a ?? ""}>{page}</Shell>
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </AppCtx.Provider>
  );
}
