import { Fragment, useState } from "react";
import { data } from "../data";
import { I } from "../ui";
import { useApp } from "../App";
import { ChangePassword } from "./Login";

export function Banking() {
  return (
    <div className="page">
      <div className="page-head"><div><h1>Bank</h1><p className="sub">Match your FNB payments to invoices so you know who has paid.</p></div></div>
      <div className="tiles">
        <div className="glass tile span-7 tile-pad" style={{ minHeight: 240 }}>
          <div className="tile-label"><I.bank />How it will work</div>
          <ol style={{ margin: "6px 0 0", paddingLeft: 20, lineHeight: 1.9, color: "var(--text-2)" }}>
            <li>Download your statement from FNB Online Banking as a CSV file.</li>
            <li>Drop it here. You check the columns once; it remembers them.</li>
            <li>Plutus suggests which invoice each payment belongs to, and why.</li>
            <li>You click to confirm. Partial and split payments are handled.</li>
          </ol>
          <div className="tile-foot">This is the next thing being built.</div>
        </div>
        <div className="notice span-5" style={{ alignSelf: "start" }}>
          <I.alert />
          <div><strong>What I need from you</strong><p>One or two FNB statement CSV exports for the Logia Services account. They are only used to build and test the matching.</p></div>
        </div>
      </div>
    </div>
  );
}

export function Settings() {
  const { companyId, notify, email } = useApp();
  const co = data.companies.find((c) => c.id === companyId) ?? data.companies[0];
  const rows: [string, string | undefined | null][] = [
    ["Company name", co.displayName], ["Registration number", co.registrationNumber], ["Email", co.email],
    ["Telephone", co.telephone], ["Address", co.address?.join(", ")], ["VAT number", null],
  ];
  const seq = (k: string) => { const s = data.sequences.find((x) => x.kind === k); return s ? s.prefix + String(s.next_value).padStart(s.width, "0") : "—"; };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="sub">{co.displayName}</p></div></div>
      <div className="detail">
        <section className="glass">
          <div className="panel-head"><h2>Company details</h2><span className="faint" style={{ fontSize: 13 }}>Editing comes next</span></div>
          <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v ?? <span style={{ color: "var(--warn)" }}>Not set — please confirm</span>}</dd></Fragment>)}</dl>
        </section>
        <div className="stack">
          <div className="notice"><I.alert /><div><strong>Open questions</strong><p>Is Logia Services VAT-registered? Sage has no VAT number, and no invoice has charged VAT since September 2023.</p></div></div>
          <div className="notice info"><I.info /><div><strong>Numbering</strong><p>The next invoice will be {seq("invoice")} and the next quote {seq("quote")}.</p></div></div>
          <section className="glass"><div className="panel-head"><h2>Your login</h2><span className="faint" style={{ fontSize: 13 }}>{email}</span></div><ChangePassword notify={notify} /></section>
          <section className="glass"><div className="panel-head"><h2>Backup</h2></div><BackupPanel notify={notify} /></section>
          <a className="glass tile interactive" href="#/settings/import" style={{ display: "block", padding: 18 }}><div className="tile-label"><I.copy />Import from Sage</div><div className="muted" style={{ marginTop: 6 }}>Load customers, items, invoices and quotes from the Sage export file.</div></a>
        </div>
      </div>
    </div>
  );
}

export function NotSetUp() {
  const { setCompanyId } = useApp();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Logi-Ink isn’t set up yet</h1><p className="sub">Logi-Ink will have its own customers, numbering and bank account.</p></div></div>
      <div className="tiles">
        <div className="glass tile span-7 tile-pad">
          <div className="tile-label"><I.cog />To switch it on, Dennis needs to send</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20, lineHeight: 1.9, color: "var(--text-2)" }}>
            <li>Registration number, and VAT number or “not registered”</li>
            <li>Bank details for invoices</li>
            <li>Logo (PNG or SVG)</li>
            <li>The email address invoices come from</li>
            <li>The last invoice number, if Logi-Ink has invoiced before</li>
          </ul>
        </div>
        <div className="span-5" style={{ display: "flex", alignItems: "flex-start" }}>
          <button className="btn primary" onClick={() => setCompanyId("logia-services")}>Back to Logia Services</button>
        </div>
      </div>
    </div>
  );
}

export function BackupPanel({ notify }: { notify: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const { buildBackup, saveFile } = await import("../backup");
      const b = await buildBackup(setStatus);
      saveFile(b);
      const total = Object.values(b.counts).reduce((a, n) => a + n, 0);
      setStatus(`Saved ${total} rows from ${b.order.length} tables. Keep the file somewhere safe.`);
      notify("Backup downloaded.");
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); }
    setBusy(false);
  };
  return (
    <div style={{ padding: "4px 18px 18px" }}>
      <p className="muted" style={{ marginTop: 0 }}>Downloads everything in Plutus as one file: customers, items, invoices, quotes, recurring invoices, numbering and settings. Sign-in sessions are left out.</p>
      {status && <p className="faint" role="status">{status}</p>}
      {err && <p className="auth-err" role="alert">{err}</p>}
      <button className="btn" onClick={run} disabled={busy}>{busy ? "Preparing…" : "Download backup"}</button>
    </div>
  );
}
