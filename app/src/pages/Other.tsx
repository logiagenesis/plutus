import { useEffect, useState } from "react";
import { data, invoices, openCents, api } from "../data";
import { I } from "../ui";
import { go, useApp } from "../App";
import { ChangePassword } from "./Login";

export function Settings() {
  const { companyId, notify, email, reload } = useApp();
  const co = data.companies.find((c) => c.id === companyId) ?? data.companies[0];

  const [displayName, setDisplayName] = useState(co.displayName ?? "");
  const [registeredName, setRegisteredName] = useState(co.registeredName ?? co.displayName ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(co.registrationNumber ?? "");
  const [vatNumber, setVatNumber] = useState(co.vatNumber ?? "");
  const [coEmail, setCoEmail] = useState(co.email ?? "");
  const [telephone, setTelephone] = useState(co.telephone ?? "");
  const [addressText, setAddressText] = useState((co.address ?? []).join("\n"));
  const [defaultMessage, setDefaultMessage] = useState(co.defaultMessage ?? "");
  const [setUp, setSetUp] = useState(co.setUp);
  const [savingCo, setSavingCo] = useState(false);
  const [coErr, setCoErr] = useState<string | null>(null);

  // Sync when switching companies
  useEffect(() => {
    setDisplayName(co.displayName ?? "");
    setRegisteredName(co.registeredName ?? co.displayName ?? "");
    setRegistrationNumber(co.registrationNumber ?? "");
    setVatNumber(co.vatNumber ?? "");
    setCoEmail(co.email ?? "");
    setTelephone(co.telephone ?? "");
    setAddressText((co.address ?? []).join("\n"));
    setDefaultMessage(co.defaultMessage ?? "");
    setSetUp(co.setUp);
    setCoErr(null);
  }, [co]);

  // Historical Sage cutover settlement state
  const uncheckedSageCount = invoices.filter((d) => d.status === "issued" && d.source === "sage" && d.sageStatus !== "Paid" && openCents(d) > 0).length;
  const [cutoverDate, setCutoverDate] = useState("2026-10-31");
  const [settling, setSettling] = useState(false);
  const [settleMsg, setSettleMsg] = useState<string | null>(null);

  // Test email state
  const [testTo, setTestTo] = useState(email || co.email || "");
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailMsg, setTestEmailMsg] = useState<string | null>(null);
  const [testEmailErr, setTestEmailErr] = useState<string | null>(null);

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    setSavingCo(true);
    setCoErr(null);
    try {
      const address = addressText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api(`companies/${encodeURIComponent(co.id)}`, {
        method: "PUT",
        body: {
          displayName: displayName.trim(),
          registeredName: registeredName.trim() || null,
          registrationNumber: registrationNumber.trim() || null,
          vatNumber: vatNumber.trim() || null,
          email: coEmail.trim() || null,
          telephone: telephone.trim() || null,
          address: address.length ? address : null,
          defaultMessage: defaultMessage.trim() || null,
          setUp,
        },
      });
      await reload();
      notify(`${displayName.trim()} settings saved`);
    } catch (err) {
      setCoErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCo(false);
    }
  }

  async function runSageSettle(action: "settle" | "unsettle") {
    if (action === "settle" && !confirm(`Mark all imported Sage invoices dated on or before ${cutoverDate} as Paid? You can undo this at any time.`)) return;
    setSettling(true);
    setSettleMsg(null);
    try {
      const res = await api<{ updatedCount: number; beforeDate: string }>(`companies/${encodeURIComponent(co.id)}/settle-sage`, {
        method: "POST",
        body: { beforeDate: cutoverDate, action },
      });
      await reload();
      const text = action === "settle"
        ? `Marked ${res.updatedCount} historical Sage invoices (on or before ${res.beforeDate}) as Paid.`
        : `Reverted ${res.updatedCount} historical Sage invoices back to unchecked.`;
      setSettleMsg(text);
      notify(text);
    } catch (err) {
      setSettleMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSettling(false);
    }
  }

  async function handleTestEmail(e: React.FormEvent) {
    e.preventDefault();
    setTestingEmail(true);
    setTestEmailMsg(null);
    setTestEmailErr(null);
    try {
      const res = await api<{ recipient: string; providerId: string | null }>("settings/test-email", {
        method: "POST",
        body: { companyId: co.id, toEmail: testTo.trim() },
      });
      setTestEmailMsg(`Test email sent to ${res.recipient}${res.providerId ? ` (ID: ${res.providerId})` : ""}.`);
      notify(`Test email sent to ${res.recipient}`);
    } catch (err) {
      setTestEmailErr(err instanceof Error ? err.message : String(err));
    } finally {
      setTestingEmail(false);
    }
  }

  const seq = (k: string) => { const s = data.sequences.find((x) => x.kind === k); return s ? s.prefix + String(s.next_value).padStart(s.width, "0") : "—"; };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="sub">{co.displayName}</p></div></div>
      <div className="detail">
        <section className="glass">
          <div className="panel-head"><h2>Company details &amp; banking</h2></div>
          <form className="stack" onSubmit={saveCompany} style={{ padding: "4px 18px 18px" }}>
            <div className="form-row">
              <label className="field"><span>Display name</span><input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
              <label className="field"><span>Registered name</span><input className="input" value={registeredName} onChange={(e) => setRegisteredName(e.target.value)} /></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Registration number</span><input className="input" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} placeholder="e.g. 2019/516462/07" /></label>
              <label className="field"><span>VAT number <span className="faint">(blank if non-VAT)</span></span><input className="input" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder="Not VAT-registered (0%)" /></label>
            </div>
            <div className="form-row">
              <label className="field"><span>Accounts email</span><input className="input" type="email" value={coEmail} onChange={(e) => setCoEmail(e.target.value)} placeholder="accounts@logia.co.za" /></label>
              <label className="field"><span>Telephone</span><input className="input" value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="+27 82 553 6035" /></label>
            </div>
            <label className="field">
              <span>Address <span className="faint">(one line per row)</span></span>
              <textarea className="input" rows={3} value={addressText} onChange={(e) => setAddressText(e.target.value)} style={{ height: "auto" }} />
            </label>
            <label className="field">
              <span>Default invoice &amp; banking details <span className="faint">(Bank:, Account Name:, Account Number:, Branch Code:, Proof of payment:)</span></span>
              <textarea className="input" rows={6} value={defaultMessage} onChange={(e) => setDefaultMessage(e.target.value)} style={{ height: "auto" }} />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={setUp} onChange={(e) => setSetUp(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
              <span>Company is active and ready for invoicing</span>
            </label>
            {coErr && <p className="auth-err" role="alert">{coErr}</p>}
            <div>
              <button className="btn primary" type="submit" disabled={savingCo}>
                <I.check />{savingCo ? "Saving…" : "Save company details"}
              </button>
            </div>
          </form>
        </section>

        <div className="stack">
          <div className="notice info"><I.info /><div><strong>Numbering</strong><p>Next invoice: <strong>{seq("invoice")}</strong> · Next quote: <strong>{seq("quote")}</strong> · Next credit note: <strong>{seq("credit_note")}</strong>.</p></div></div>

          <section className="glass">
            <div className="panel-head"><h2>Historical Sage Cutover Settlement</h2></div>
            <div className="stack" style={{ padding: "4px 18px 18px" }}>
              <p className="muted" style={{ marginTop: 0 }}>
                Sage exports after Feb 2022 did not include payment records ({uncheckedSageCount} historical Sage invoice{uncheckedSageCount === 1 ? "" : "s"} currently show “Not checked”). Settle historical Sage invoices on or before your cutover date so only current unpaid invoices appear in Customer Statements and Bank Matching.
              </p>
              <label className="field">
                <span>Settle imported Sage invoices dated on or before</span>
                <input className="input" type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} style={{ maxWidth: 220 }} />
              </label>
              {settleMsg && <p className="faint" role="status">{settleMsg}</p>}
              <div className="toolbar">
                <button className="btn primary small" type="button" onClick={() => runSageSettle("settle")} disabled={settling}>
                  <I.check />{settling ? "Updating…" : "Mark pre-cutover Sage invoices Paid"}
                </button>
                <button className="btn ghost small" type="button" onClick={() => runSageSettle("unsettle")} disabled={settling}>
                  Undo cutover settlement
                </button>
              </div>
            </div>
          </section>

          <section className="glass">
            <div className="panel-head"><h2>Verify Outbound Email (Resend)</h2></div>
            <form className="stack" onSubmit={handleTestEmail} style={{ padding: "4px 18px 18px" }}>
              <p className="muted" style={{ marginTop: 0 }}>Send a test email to confirm your Resend API key and sender domain are ready before the 25th billing run.</p>
              <div className="toolbar">
                <input className="input" type="email" required value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="dennis@logia.co.za" style={{ flex: 1 }} />
                <button className="btn small" type="submit" disabled={testingEmail}><I.mail />{testingEmail ? "Sending…" : "Send test email"}</button>
              </div>
              {testEmailMsg && <p style={{ color: "var(--ok)", fontSize: 13, margin: 0 }}>{testEmailMsg}</p>}
              {testEmailErr && <p className="auth-err" role="alert" style={{ margin: 0 }}>{testEmailErr}</p>}
            </form>
          </section>

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
      <div className="page-head"><div><h1>Logi-Ink isn’t set up yet</h1><p className="sub">Logi-Ink has its own customers, numbering and bank account.</p></div></div>
      <div className="tiles">
        <div className="glass tile span-7 tile-pad">
          <div className="tile-label"><I.cog />Configure Logi-Ink in Settings</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20, lineHeight: 1.9, color: "var(--text-2)" }}>
            <li>Registration number, and VAT number or “not registered”</li>
            <li>Bank details for invoices</li>
            <li>The email address invoices come from</li>
            <li>Check “Company is active and ready for invoicing” in Settings</li>
          </ul>
        </div>
        <div className="span-5" style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={() => go("/settings")}>Set up Logi-Ink in Settings</button>
          <button className="btn ghost" onClick={() => setCompanyId("logia-services")}>Back to Logia Services</button>
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
