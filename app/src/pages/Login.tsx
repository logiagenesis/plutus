import { useState, type FormEvent } from "react";
import { api, ApiError } from "../data";

export type AuthState = { signedIn: boolean; email: string | null; setupNeeded: boolean; setupEmail: string | null; setupAllowed: boolean };
const MIN = 12;
const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

function Frame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="glass auth-card">
        <img className="auth-logo" src="./plutus-wordmark.png" alt="Plutus" width="176" height="26" />
        <h1>{title}</h1>
        <p className="sub">{sub}</p>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api("auth/login", { method: "POST", body: { email, password } }); setPassword(""); onDone(); }
    catch (x) { setErr(msg(x)); setBusy(false); }
  };
  return (
    <Frame title="Sign in" sub="Logi-Ink accounting">
      <form className="auth-form" onSubmit={submit}>
        <label className="field" htmlFor="l-email"><span>Email</span>
          <input id="l-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label className="field" htmlFor="l-pass"><span>Password</span>
          <input id="l-pass" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <p className="auth-err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </Frame>
  );
}

export function SetupScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (p1.length < MIN) return setErr(`Use at least ${MIN} characters.`);
    if (p1 !== p2) return setErr("The two passwords are not the same.");
    setBusy(true);
    try { await api("auth/setup", { method: "POST", body: { password: p1 } }); onDone(); }
    catch (x) { setErr(msg(x)); setBusy(false); }
  };
  return (
    <Frame title="Set your password" sub={`This is your own Plutus login. You'll sign in with ${email} and this password.`}>
      <form className="auth-form" onSubmit={submit}>
        <label className="field"><span>Email</span><input className="input" value={email} readOnly autoComplete="username" /></label>
        <label className="field" htmlFor="s-p1"><span>New password <span className="faint">(at least {MIN} characters)</span></span>
          <input id="s-p1" className="input" type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} autoFocus /></label>
        <label className="field" htmlFor="s-p2"><span>Type it again</span>
          <input id="s-p2" className="input" type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} /></label>
        {err && <p className="auth-err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password and sign in"}</button>
      </form>
    </Frame>
  );
}

export function NoAccess() {
  return (
    <Frame title="Not set up yet" sub="The first password for Plutus hasn't been set, and it can only be set from the owner's setup link.">
      <div />
    </Frame>
  );
}

export function ChangePassword({ notify }: { notify: (t: string) => void }) {
  const [cur, setCur] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (p1.length < MIN) return setErr(`Use at least ${MIN} characters.`);
    if (p1 !== p2) return setErr("The two new passwords are not the same.");
    setBusy(true);
    try { await api("auth/password", { method: "POST", body: { current: cur, next: p1 } }); setCur(""); setP1(""); setP2(""); notify("Password changed. Other devices are signed out."); }
    catch (x) { setErr(msg(x)); }
    setBusy(false);
  };
  return (
    <form className="auth-form" onSubmit={submit} style={{ padding: "4px 18px 18px" }}>
      <label className="field" htmlFor="c-cur"><span>Current password</span><input id="c-cur" className="input" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className="field" htmlFor="c-p1"><span>New password <span className="faint">(at least {MIN} characters)</span></span><input id="c-p1" className="input" type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} /></label>
      <label className="field" htmlFor="c-p2"><span>Type the new one again</span><input id="c-p2" className="input" type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} /></label>
      {err && <p className="auth-err" role="alert">{err}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
    </form>
  );
}

/** Shown only on a brand-new, empty Plutus while restore is switched on (moving to a new Cloudflare account). */
export function RestoreScreen({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!file) return setErr("Choose the backup file first.");
    setBusy(true);
    try {
      const { restoreBackup } = await import("../backup");
      const b = JSON.parse(await file.text());
      await restoreBackup(b, email, password, code, setStatus);
      setPassword(""); setCode(""); setStatus("Done. Every table matches the backup. Sign in with your usual Plutus password.");
      setTimeout(onDone, 1500);
    } catch (x) { setErr(x instanceof SyntaxError ? "That file is not a Plutus backup." : msg(x)); setBusy(false); }
  };
  return (
    <Frame title="Restore Plutus" sub="This Plutus is empty. Load the backup file from the old Plutus. Your email and Plutus password from the backup are needed to prove it is yours.">
      <form className="auth-form" onSubmit={submit}>
        <label className="field" htmlFor="r-file"><span>Backup file (plutus-backup-….json)</span>
          <input id="r-file" className="input" type="file" accept="application/json,.json" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="field" htmlFor="r-email"><span>Email</span>
          <input id="r-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field" htmlFor="r-pass"><span>Plutus password</span>
          <input id="r-pass" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className="field" htmlFor="r-code"><span>Restore code (the RESTORE_CODE secret you set in Cloudflare)</span>
          <input id="r-code" className="input" type="password" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
        {status && <p className="faint" role="status">{status}</p>}
        {err && <p className="auth-err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Restoring…" : "Restore"}</button>
      </form>
    </Frame>
  );
}
