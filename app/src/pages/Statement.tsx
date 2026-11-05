import { useCallback, useEffect, useState } from "react";
import { useApp } from "../App";
import { api, fmtDate, parseBankDetails, todayISO, type StatementData } from "../data";
import { rand } from "../money";
import { I } from "../ui";

export default function CustomerStatement({ id }: { id: number }) {
  const { notify } = useApp();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stmt, setStmt] = useState<StatementData | null>(null);

  // Date range (local SAST date)
  const today = todayISO();
  const [preset, setPreset] = useState<"30" | "60" | "90" | "month" | "ytd" | "all">("90");
  const [onlyApp, setOnlyApp] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(today);

  // Email modal
  const [showEmail, setShowEmail] = useState(false);
  const [toEmail, setToEmail] = useState("");
  const [ccEmail, setCcEmail] = useState("accounts@logia.co.za");
  const [sending, setSending] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const applyPreset = (p: "30" | "60" | "90" | "month" | "ytd" | "all") => {
    setPreset(p);
    const end = todayISO();
    const d = new Date(end + "T00:00:00Z");
    setToDate(end);
    if (p === "30") {
      d.setUTCDate(d.getUTCDate() - 30);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (p === "60") {
      d.setUTCDate(d.getUTCDate() - 60);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (p === "90") {
      d.setUTCDate(d.getUTCDate() - 90);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (p === "month") {
      setFromDate(`${end.slice(0, 7)}-01`);
    } else if (p === "ytd") {
      setFromDate(`${end.slice(0, 4)}-01-01`);
    } else if (p === "all") {
      setFromDate("2020-01-01");
    }
  };

  const loadStatement = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api<StatementData>(
        `customers/${id}/statement?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}${onlyApp ? "&onlyApp=1" : ""}`
      );
      setStmt(res);
      if (res.customer.email) {
        setToEmail(res.customer.email);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, fromDate, toDate, onlyApp]);

  useEffect(() => {
    loadStatement();
  }, [loadStatement]);

  const handleDownloadPdf = async () => {
    if (!stmt) return;
    try {
      setPdfBusy(true);
      const { downloadStatementPdf } = await import("../pdf");
      await downloadStatementPdf(stmt);
      notify("Statement PDF downloaded.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to generate statement PDF.");
    } finally {
      setPdfBusy(false);
    }
  };

  const handleSendEmail = async () => {
    if (!toEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      notify("Please provide a valid recipient email address.");
      return;
    }
    if (!stmt) return;
    try {
      setSending(true);
      let pdfBase64: string | undefined;
      try {
        const { buildStatementPdf } = await import("../pdf");
        const { doc } = await buildStatementPdf(stmt);
        const buf = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        pdfBase64 = btoa(bin);
      } catch (err) {
        console.warn("Could not compile client PDF for statement; server will fall back to HTML", err);
      }

      await api(`customers/${id}/statement/send`, {
        method: "POST",
        body: {
          fromDate,
          toDate,
          onlyApp,
          toEmail: toEmail.trim(),
          ccEmail: ccEmail.trim() || undefined,
          pdfBase64,
        },
      });
      notify("Statement emailed successfully.");
      setShowEmail(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Failed to email statement.");
    } finally {
      setSending(false);
    }
  };

  if (loading && !stmt) {
    return <div className="page"><div className="glass tile-pad" style={{ textAlign: "center", padding: 50, color: "var(--text-3)" }}>Loading customer statement...</div></div>;
  }

  if (error || !stmt) {
    return (
      <div className="page">
        <a className="crumb" href={`#/customers/${id}`}><I.back />Back to Customer</a>
        <div className="notice"><I.alert /><div><strong>Error loading statement</strong><p>{error ?? "Statement not found."}</p></div></div>
      </div>
    );
  }

  const co = stmt.company;
  const cust = stmt.customer;
  const addr = (cust.postal && cust.postal.length > 0 ? cust.postal : cust.delivery) ?? [];
  const bank = parseBankDetails(co);

  return (
    <div className="page">
      <div className="no-print">
        <a className="crumb" href={`#/customers/${id}`}><I.back />Customer</a>
        <div className="page-head">
          <div>
            <h1>Statement of Account</h1>
            <p className="sub">{cust.name} · {fmtDate(stmt.fromDate)} to {fmtDate(stmt.toDate)}</p>
          </div>
          <div className="toolbar">
            <button className="btn primary" onClick={handleDownloadPdf} disabled={pdfBusy} title="Download vector PDF statement">
              <I.print />{pdfBusy ? "Preparing PDF..." : "Download PDF"}
            </button>
            <button className="btn" onClick={() => window.print()} title="Print statement">
              <I.print />Print
            </button>
            <button className="btn" onClick={() => setShowEmail(true)}>
              <I.mail />Email Statement
            </button>
          </div>
        </div>

        {(stmt.uncheckedSageCount ?? 0) > 0 && (
          <div className="notice" style={{ marginBottom: 16 }}>
            <I.alert />
            <div style={{ flex: 1 }}>
              <strong>{stmt.uncheckedSageCount} historical Sage invoice{stmt.uncheckedSageCount === 1 ? "" : "s"} had no payment recorded in Sage after Feb 2022.</strong>
              <p>
                {onlyApp
                  ? "Currently showing only verified Plutus transactions (excluding unverified pre-cutover Sage invoices)."
                  : "Unverified Sage invoices are currently included in the opening/closing balance. Toggle below to exclude pre-Plutus Sage history before emailing."}
              </p>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <button className={`btn small ${onlyApp ? "primary" : "ghost"}`} onClick={() => setOnlyApp(true)}>
                  Plutus only (verified)
                </button>
                <button className={`btn small ${!onlyApp ? "primary" : "ghost"}`} onClick={() => setOnlyApp(false)}>
                  All history (incl. Sage)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Date Filter Bar */}
        <section className="glass panel" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
            <span style={{ fontSize: 13, fontWeight: 550, color: "var(--text-2)" }}>Period:</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["month", "30", "60", "90", "ytd", "all"] as const).map((p) => {
                const labels: Record<string, string> = {
                  month: "This Month",
                  "30": "Last 30 Days",
                  "60": "Last 60 Days",
                  "90": "Last 90 Days",
                  ytd: "Year to Date",
                  all: "All Time",
                };
                return (
                  <button
                    key={p}
                    className={`btn small ${preset === p ? "primary" : "ghost"}`}
                    onClick={() => applyPreset(p)}
                  >
                    {labels[p]}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--text-3)" }}>
                From:
                <input
                  type="date"
                  className="input"
                  style={{ marginLeft: 6, padding: "4px 8px", fontSize: 12, width: "auto" }}
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setPreset("custom" as any); }}
                />
              </label>
              <label style={{ fontSize: 12, color: "var(--text-3)" }}>
                To:
                <input
                  type="date"
                  className="input"
                  style={{ marginLeft: 6, padding: "4px 8px", fontSize: 12, width: "auto" }}
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setPreset("custom" as any); }}
                />
              </label>
            </div>
          </div>
        </section>
      </div>

      {/* Printable Paper Statement */}
      <div className="paper-wrap">
        <article className="paper" aria-label="Customer Account Statement">
          {/* Header */}
          <div className="p-top">
            <div>
              <div className="p-co">{co.displayName}</div>
              <div className="p-muted">{(co.address ?? []).join(", ")}</div>
              <div className="p-muted">
                {co.registrationNumber ? `Reg. ${co.registrationNumber}` : ""}
                {co.registrationNumber && co.email ? " · " : ""}
                {co.email ? co.email : ""}
                {co.telephone ? ` · Tel: ${co.telephone}` : ""}
              </div>
              {co.vatNumber && <div className="p-muted">VAT Reg. {co.vatNumber}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="p-title" style={{ fontSize: 20 }}>Statement of Account</div>
              <div className="p-muted" style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>
                Date: {fmtDate(stmt.toDate)}
              </div>
            </div>
          </div>

          {/* Customer and Period Details */}
          <div className="p-top" style={{ marginTop: 20 }}>
            <div style={{ minWidth: 0 }}>
              <div className="p-muted" style={{ fontSize: 10.5, fontWeight: 600, textTransform: "uppercase" }}>Bill to</div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{cust.name}</div>
              {cust.contact && cust.contact !== cust.name && <div>{cust.contact}</div>}
              {addr.map((a) => <div key={a} className="p-muted">{a}</div>)}
              {cust.vat && <div className="p-muted">VAT {cust.vat}</div>}
            </div>
            <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <div><span className="p-muted">Account Ref: </span>{cust.name}</div>
              <div><span className="p-muted">Period: </span>{fmtDate(stmt.fromDate)} – {fmtDate(stmt.toDate)}</div>
              <div><span className="p-muted">Currency: </span>ZAR (R)</div>
            </div>
          </div>

          {/* Ledger Table */}
          <table style={{ marginTop: 22 }}>
            <thead>
              <tr>
                <th style={{ width: 95 }}>Date</th>
                <th>Transaction</th>
                <th>Reference</th>
                <th className="r" style={{ width: 110 }}>Debit</th>
                <th className="r" style={{ width: 110 }}>Credit</th>
                <th className="r" style={{ width: 120 }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening balance */}
              <tr style={{ background: "#f8fafc", fontWeight: 600 }}>
                <td>{fmtDate(stmt.fromDate)}</td>
                <td colSpan={2}>Opening Balance</td>
                <td className="r num">—</td>
                <td className="r num">—</td>
                <td className="r num">{rand(stmt.openingBalanceCents)}</td>
              </tr>

              {/* Ledger lines */}
              {stmt.lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-muted" style={{ textAlign: "center", padding: "16px 0" }}>
                    No transactions recorded during this period
                  </td>
                </tr>
              ) : (
                stmt.lines.map((l, idx) => (
                  <tr key={`${l.date}-${l.kind}-${idx}`}>
                    <td className="num">{fmtDate(l.date)}</td>
                    <td>
                      <span style={{ fontWeight: 550 }}>
                        {l.kind === "invoice" ? `Invoice ${l.number}` : l.kind === "credit_note" ? `Credit Note ${l.number}` : l.number}
                      </span>
                    </td>
                    <td className="p-muted">{l.reference || l.description}</td>
                    <td className="r num">{l.debitCents > 0 ? rand(l.debitCents) : "—"}</td>
                    <td className="r num">{l.creditCents > 0 ? rand(l.creditCents) : "—"}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{rand(l.balanceCents)}</td>
                  </tr>
                ))
              )}

              {/* Closing balance */}
              <tr style={{ borderTop: "2px solid #16202b", background: "#f4f6f9", fontWeight: 700, fontSize: 13 }}>
                <td>{fmtDate(stmt.toDate)}</td>
                <td colSpan={4}>Closing Balance Outstanding</td>
                <td className="r num" style={{ color: stmt.closingBalanceCents > 0 ? "#0f172a" : "#16a34a" }}>
                  {rand(stmt.closingBalanceCents)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Aging Analysis Table */}
          <div className="p-aging">
            <div className="p-bank-head">Aging Breakdown (Days Outstanding)</div>
            <div className="p-aging-grid">
              <div>
                <div className="p-aging-cell-lbl">Current (0-30)</div>
                <div className="p-aging-cell-val num">{rand(stmt.aging.currentCents)}</div>
              </div>
              <div>
                <div className="p-aging-cell-lbl">30 Days</div>
                <div className="p-aging-cell-val num">{rand(stmt.aging.days30Cents)}</div>
              </div>
              <div>
                <div className="p-aging-cell-lbl">60 Days</div>
                <div className="p-aging-cell-val num">{rand(stmt.aging.days60Cents)}</div>
              </div>
              <div>
                <div className="p-aging-cell-lbl">90+ Days</div>
                <div className="p-aging-cell-val num">{rand(stmt.aging.days90Cents)}</div>
              </div>
              <div>
                <div className="p-aging-cell-lbl" style={{ color: "#0f172a", fontWeight: 700 }}>Total Due</div>
                <div className="p-aging-cell-val num" style={{ color: "#0f172a", fontSize: 13 }}>
                  {rand(stmt.aging.totalDueCents)}
                </div>
              </div>
            </div>
          </div>

          {/* Banking Details Box */}
          <div className="p-bank">
            <div className="p-bank-head">Banking &amp; Remittance Details</div>
            <div className="p-bank-grid">
              <div><span className="p-bank-lbl">Bank:</span> <strong>{bank.bank}</strong></div>
              <div><span className="p-bank-lbl">Account Name:</span> <strong>{bank.accountName}</strong></div>
              <div><span className="p-bank-lbl">Account Number:</span> <strong className="num">{bank.accountNumber}</strong></div>
              <div><span className="p-bank-lbl">Account Type:</span> <strong>{bank.accountType}</strong></div>
              <div><span className="p-bank-lbl">Branch Code:</span> <strong className="num">{bank.branchCode}</strong></div>
              <div><span className="p-bank-lbl">Payment Ref:</span> <strong>{cust.name}</strong></div>
            </div>
            <div className="p-bank-foot">Please email proof of payment to <strong>{bank.proofEmail}</strong></div>
          </div>
        </article>
      </div>

      {/* Email Modal */}
      {showEmail && (
        <div className="modal-backdrop no-print" onClick={() => !sending && setShowEmail(false)}>
          <div className="modal glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-head">
              <h2>Email Statement of Account</h2>
              <button className="icon-btn" onClick={() => setShowEmail(false)} disabled={sending}><I.x /></button>
            </div>
            <div className="modal-body stack" style={{ gap: 14 }}>
              <p className="sub" style={{ margin: 0 }}>
                Send this account statement directly to the customer as an attached PDF, with an itemized summary, aging analysis, and banking details.
              </p>
              <div>
                <label className="field-lbl">Recipient Email</label>
                <input
                  type="email"
                  className="input"
                  style={{ width: "100%" }}
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="accounts@customer.co.za"
                  disabled={sending}
                />
              </div>
              <div>
                <label className="field-lbl">CC Email</label>
                <input
                  type="email"
                  className="input"
                  style={{ width: "100%" }}
                  value={ccEmail}
                  onChange={(e) => setCcEmail(e.target.value)}
                  placeholder="accounts@logia.co.za"
                  disabled={sending}
                />
              </div>
              <div className="notice" style={{ fontSize: 12 }}>
                <I.info />
                <div>
                  <strong>Statement Period:</strong> {fmtDate(stmt.fromDate)} to {fmtDate(stmt.toDate)}<br />
                  <strong>Closing Balance:</strong> {rand(stmt.closingBalanceCents)}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setShowEmail(false)} disabled={sending}>Cancel</button>
              <button className="btn primary" onClick={handleSendEmail} disabled={sending || !toEmail}>
                {sending ? "Sending..." : "Send Statement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
