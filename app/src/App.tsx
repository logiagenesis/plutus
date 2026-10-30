import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { data, loadData, ApiError } from "./data";
import { I, Toast, useTileLight } from "./ui";
import Home from "./pages/Home";
import { DocList, DocView } from "./pages/Documents";
import Editor from "./pages/Editor";
import { CustomerList, CustomerView } from "./pages/Customers";
import CustomerStatement from "./pages/Statement";
import RecurringPage from "./pages/Recurring";
import Items from "./pages/Items";
import Banking from "./pages/Banking";
import { Settings, NotSetUp } from "./pages/Other";
import { CustomerForm, ItemForm } from "./pages/Forms";
import ImportPage from "./pages/Import";
import { api } from "./data";
import { LoginScreen, SetupScreen, NoAccess, RestoreScreen, type AuthState } from "./pages/Login";

// ── Router: in-memory, so it works inside the private preview frame (which only passes plain #names).
// Links keep href="#/path" for readability; a single click handler turns them into route changes.
const fromHash = () => (location.hash.startsWith("#/") ? location.hash.slice(1) : "/");
let current = fromHash();
const listeners = new Set<() => void>();
export const routeQuery = () => new URLSearchParams(current.split("?")[1] ?? "");
export const go = (path: string, replace = false) => {
  current = path;
  try { if (replace) history.replaceState(null, "", "#" + path); else history.pushState(null, "", "#" + path); } catch { /* preview frame: in-memory only */ }
  listeners.forEach((l) => l()); window.scrollTo(0, 0);
};
export function useRoute() {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => setPath(current);
    const pop = () => { current = fromHash(); on(); };
    listeners.add(on); addEventListener("popstate", pop);
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href^='#/']") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      e.preventDefault(); go(a.getAttribute("href")!.slice(1));
    };
    document.addEventListener("click", click);
    return () => { listeners.delete(on); removeEventListener("popstate", pop); document.removeEventListener("click", click); };
  }, []);
  return path.split("?")[0].split("/").filter(Boolean);
}

// ── App state: active company; data lives in the store (src/data.ts) and reloads after each change ──
type Ctx = { companyId: string; setCompanyId: (id: string) => void; reload: () => Promise<void>; notify: (t: string) => void; rev: number; email: string; signOut: () => void };
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

const NAV = [
  { path: "/", label: "Home", icon: I.home },
  { path: "/invoices", label: "Invoices", icon: I.invoice },
  { path: "/quotes", label: "Quotes", icon: I.quote },
  { path: "/customers", label: "Customers", icon: I.users },
  { path: "/recurring", label: "Recurring", icon: I.repeat },
  { path: "/items", label: "Items", icon: I.box },
  { path: "/banking", label: "Bank", icon: I.bank },
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
  const co = data.companies.find((c) => c.id === companyId) ?? { id: companyId, displayName: companyId === "logi-ink" ? "Logi-Ink (Pty) Ltd" : "Logia Services (Pty) Ltd", setUp: true };
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
                <span className="co-meta">{c.setUp ? "Ready" : "Not set up yet"}</span>
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
  const app = useApp();
  const cur = (p: string) => (p === "/" ? active === "" : active === p.slice(1)) ? "page" : undefined;
  return (
    <div className="shell">
      <aside className="rail" aria-label="Main">
        <div className="wordmark"><img className="logo-word" src="./plutus-wordmark.png" alt="Plutus" width="128" height="19" /></div>
        <CompanySwitch />
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={"#" + n.path} aria-current={cur(n.path)}>
              <n.icon />{n.label}{n.soon && <span className="soon">{n.soon}</span>}
            </a>
          ))}
        </nav>
        <div className="rail-foot rail-user"><span>Signed in as<br />{app.email}</span><button className="btn small ghost" onClick={app.signOut}>Sign out</button></div>
      </aside>
      <header className="topbar">
        <div className="wordmark" style={{ padding: 0 }}><img className="logo-word" src="./plutus-wordmark.png" alt="Plutus" width="104" height="15" /></div>
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
  const app = useApp();
  return (
    <div className="page">
      <div className="page-head"><h1>More</h1></div>
      <div className="stack">
        {NAV.slice(4).map((n) => (
          <a key={n.path} href={"#" + n.path} className="glass tile interactive" style={{ display: "flex", alignItems: "center", gap: 14, padding: 18 }}>
            <n.icon width={20} height={20} style={{ color: "var(--accent)" }} /><span style={{ flex: 1, fontWeight: 560 }}>{n.label}</span><I.arrow width={16} height={16} className="faint" />
          </a>
        ))}
        <button className="btn" style={{ alignSelf: "flex-start", marginTop: 8 }} onClick={app.signOut}>Sign out ({app.email})</button>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="page" aria-busy="true">
      <div className="page-head"><div><div className="skel" style={{ width: 280, height: 34 }} /><div className="skel" style={{ width: 180, height: 14, marginTop: 10 }} /></div></div>
      <div className="tiles">{[7, 5, 4, 4, 4].map((n, i) => <div key={i} className={`glass tile span-${n} skel-tile`} />)}</div>
    </div>
  );
}

export default function App() {
  useTileLight();
  const route = useRoute();
  const [companyId, setCompanyIdState] = useState(() => { try { return localStorage.getItem("plutus.company") || "logia-services"; } catch { return "logia-services"; } });
  const [state, setState] = useState<"loading" | "ready" | { error: string; status: number }>("loading");
  const [rev, setRev] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authErr, setAuthErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const checkAuth = useCallback(async () => {
    try {
      setAuthErr(null);
      // A brand-new, empty Plutus (restore switched on) shows the restore screen instead of sign-in.
      const r = await api<{ enabled: boolean; blank: boolean }>("restore/state").catch(() => ({ enabled: false, blank: false }));
      setRestoring(r.enabled && r.blank);
      if (r.enabled && r.blank) return;
      setAuth(await api<AuthState>("auth/state"));
    }
    catch (e) { setAuthErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { checkAuth(); }, [checkAuth]);
  useEffect(() => { const h = () => checkAuth(); window.addEventListener("plutus:signed-out", h); return () => window.removeEventListener("plutus:signed-out", h); }, [checkAuth]);
  const signOut = useCallback(async () => { try { await api("auth/logout", { method: "POST", body: {} }); } catch { /* ignore */ } setState("loading"); checkAuth(); }, [checkAuth]);
  const signedIn = !!auth?.signedIn;

  const reload = useCallback(async () => {
    try { await loadData(companyId); setState("ready"); setRev((r) => r + 1); }
    catch (e) { setState({ error: e instanceof Error ? e.message : String(e), status: e instanceof ApiError ? e.status : 0 }); }
  }, [companyId]);
  useEffect(() => { if (signedIn) { setState("loading"); reload(); } }, [reload, signedIn]);
  const setCompanyId = useCallback((id: string) => { try { localStorage.setItem("plutus.company", id); } catch { /* ignore */ } setCompanyIdState(id); }, []);
  const ctx = useMemo(() => ({ companyId, setCompanyId, reload, notify: setToast, rev, email: auth?.email ?? "", signOut }), [companyId, setCompanyId, reload, rev, auth, signOut]);

  if (restoring) return <RestoreScreen onDone={checkAuth} />;
  if (!auth) return authErr
    ? <div className="auth-wrap"><div className="notice" style={{ maxWidth: 480 }}><I.alert /><div><strong>Can't reach Plutus</strong><p>{authErr}</p><button className="btn small" style={{ marginTop: 10 }} onClick={checkAuth}>Try again</button></div></div></div>
    : <div className="auth-wrap" aria-busy="true" />;
  if (!auth.signedIn) {
    if (auth.setupNeeded && auth.setupAllowed && auth.setupEmail) return <SetupScreen email={auth.setupEmail} onDone={checkAuth} />;
    if (auth.setupNeeded) return <NoAccess />;
    return <LoginScreen onDone={checkAuth} />;
  }

  const [a, b, c] = route;
  const co = data.companies.find((x) => x.id === companyId);
  let page: ReactNode;
  if (state === "loading") page = <Loading />;
  else if (state !== "ready") page = (
    <div className="page"><div className="notice" style={{ maxWidth: 680 }}><I.alert /><div>
      <strong>Couldn’t load your data</strong>
      <p>{state.error}</p>
      <button className="btn small" style={{ marginTop: 10 }} onClick={() => { setState("loading"); reload(); }}>Try again</button>
    </div></div></div>
  );
  else if (co && !co.setUp && !["settings", "more"].includes(a ?? "")) page = <NotSetUp />;
  else if (!a) page = <Home />;
  else if ((a === "invoices" || a === "quotes") && b === "new") page = <Editor kind={a === "invoices" ? "invoice" : "quote"} key={"new" + a} />;
  else if ((a === "invoices" || a === "quotes") && b && c === "edit") page = <Editor kind={a === "invoices" ? "invoice" : "quote"} editId={Number(b)} key={"edit" + b} />;
  else if ((a === "invoices" || a === "quotes") && b) page = <DocView kind={a === "invoices" ? "invoice" : "quote"} id={b} key={a + b} />;
  else if (a === "invoices") page = <DocList kind="invoice" key="li" />;
  else if (a === "quotes") page = <DocList kind="quote" key="lq" />;
  else if (a === "customers" && b === "new") page = <CustomerForm key="cn" />;
  else if (a === "customers" && b && c === "edit") page = <CustomerForm id={Number(b)} key={"ce" + b} />;
  else if (a === "customers" && b && c === "statement") page = <CustomerStatement id={Number(b)} key={"cs" + b} />;
  else if (a === "customers" && b) page = <CustomerView id={Number(b)} key={b} />;
  else if (a === "customers") page = <CustomerList />;
  else if (a === "recurring") page = <RecurringPage />;
  else if (a === "items" && b === "new") page = <ItemForm key="in" />;
  else if (a === "items" && b) page = <ItemForm id={Number(b)} key={"ie" + b} />;
  else if (a === "items") page = <Items />;
  else if (a === "banking") page = <Banking />;
  else if (a === "settings" && b === "import") page = <ImportPage />;
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
