import { useEffect, useMemo, useState } from "react";
import { invoices, quotes, creditNotes, customerName, fmtDate, invoiceStatus, quoteStatus, creditNoteStatus, data, api, mapDoc, todayISO, openCents, parseBankDetails, type Doc } from "../data";
import { rand } from "../money";
import { parsePrice, type Kind } from "./Editor";
import { I, Pill, Empty } from "../ui";
import { go, useApp } from "../App";
import Paper from "./Paper";

const PAGE = 25;
const baseFor = (kind: Kind) => kind === "invoice" ? "invoices" : kind === "quote" ? "quotes" : "credit-notes";
const pluralFor = (kind: Kind) => kind === "invoice" ? "Invoices" : kind === "quote" ? "Quotes" : "Credit Notes";
const labelFor = (kind: Kind) => kind === "invoice" ? "invoice" : kind === "quote" ? "quote" : "credit note";

export function DocList({ kind }: { kind: Kind }) {
  useApp();
  const all = kind === "invoice" ? invoices : kind === "quote" ? quotes : creditNotes;
  const years = useMemo(() => [...new Set(all.map((d) => d.date.slice(0, 4)))].sort().reverse(), [all]);
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const statusOf = (d: Doc) => (kind === "invoice" ? invoiceStatus(d) : kind === "quote" ? quoteStatus(d) : creditNoteStatus(d));
  const statuses = useMemo(() => [...new Set(all.map((d) => statusOf(d).label))], [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = all.filter((d) => {
    if (year !== "all" && !d.date.startsWith(year)) return false;
    if (status !== "all" && statusOf(d).label !== status) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return d.number.toLowerCase().includes(s) || customerName(d.customerSageId).toLowerCase().includes(s)
      || (d.reference ?? "").toLowerCase().includes(s) || (d.firstLine ?? "").toLowerCase().includes(s);
  });
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const total = rows.reduce((a, d) => a + d.totalCents, 0);
  const label = pluralFor(kind);
  const base = baseFor(kind);
  const fromSage = kind === "invoice" && all.some((d) => d.source === "sage" && d.sageStatus !== "Paid" && openCents(d) > 0);
  const owed = kind === "invoice" ? all.filter((d) => d.status === "issued" && d.source === "app") : [];
  const owedCents = owed.reduce((x, d) => x + openCents(d), 0);
  const owedCount = owed.filter((d) => openCents(d) > 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{label}</h1><p className="sub">{all.length} {label.toLowerCase()}{owedCount > 0 && <> · <span style={{ color: "var(--accent)" }}>{owedCount} Plutus invoice{owedCount > 1 ? "s" : ""} owed: {rand(owedCents)}</span></>}</p></div>
        <div className="toolbar">
          {kind === "invoice" && <a className="btn" href="#/credit-notes">Credit notes ({creditNotes.length})</a>}
          {kind === "credit_note" && <a className="btn" href="#/invoices"><I.back />Back to Invoices</a>}
          <a className="btn primary" href={`#/${base}/new`}><I.plus />New {labelFor(kind)}</a>
        </div>
      </div>
      {kind === "invoice" && fromSage && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <I.alert />
          <div><strong>Historical Sage invoices before cutover show “Not checked”.</strong>
            <p>Payments after February 2022 were not exported from Sage. You can settle pre-cutover historical Sage invoices in <a href="#/settings" style={{ color: "var(--accent)", textDecoration: "underline" }}>Settings</a> so only active open balances remain.</p></div>
        </div>
      )}
      <section className="glass panel">
        <div className="panel-head">
          <div className="toolbar" style={{ flex: 1 }}>
            <label className="search" style={{ flex: "1 1 260px", maxWidth: 420 }}>
              <I.search /><input className="input" id={`search-${kind}`} placeholder={`Search ${label.toLowerCase()}, customers or items`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={`Search ${label.toLowerCase()}`} />
            </label>
            <select className="select" id={`year-${kind}`} style={{ width: 130 }} value={year} onChange={(e) => { setYear(e.target.value); setPage(0); }} aria-label="Year">
              <option value="all">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <select className="select" id={`status-${kind}`} style={{ width: 210 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Status">
              <option value="all">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="muted num" aria-live="polite">{rows.length} shown · {rand(total)}</div>
        </div>
        {all.length === 0 ? <Empty title={`No ${label.toLowerCase()} yet`}><p><a className="btn primary small" href={`#/${base}/new`}>Create the first one</a></p></Empty>
          : rows.length === 0 ? <Empty title="Nothing matches">Try a different search or clear the filters.</Empty> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Number</th><th>Customer</th><th className="hide-xs">Date</th><th className="hide-sm">{kind === "invoice" ? "Due" : kind === "credit_note" ? "Credits / Ref" : "Reference"}</th><th className="r">Total</th><th className="hide-sm">Status</th></tr></thead>
              <tbody>
                {shown.map((d) => {
                  const st = statusOf(d);
                  const href = `/${base}/${d.sageId}`;
                  return (
                    <tr key={d.sageId} className="row" tabIndex={0} onClick={() => go(href)} onKeyDown={(e) => e.key === "Enter" && go(href)}>
                      <td className="strong">{d.status === "draft" ? <span className="muted">Draft</span> : d.number}</td>
                      <td><div>{customerName(d.customerSageId)}</div><div className="cell-sub">{d.firstLine}{(d.lineCount ?? 0) > 1 ? ` + ${(d.lineCount ?? 1) - 1} more` : ""}</div></td>
                      <td className="hide-xs muted">{fmtDate(d.date)}</td>
                      <td className="hide-sm muted">{kind === "invoice" ? fmtDate(d.dueDate) : (d.fromDocument ?? d.reference ?? "—")}</td>
                      <td className="r num strong">{rand(d.totalCents)}</td>
                      <td className="hide-sm"><Pill tone={st.tone}>{st.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > PAGE && (
          <div className="pager">
            <span className="num">{page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}</span>
            <div className="toolbar">
              <button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn small" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function DocView({ kind, id }: { kind: Kind; id: string }) {
  const { reload, notify } = useApp();
  const base = baseFor(kind);
  const [doc, setDoc] = useState<Doc | null | "missing">(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "issue" | "delete">("");
  const [confirm, setConfirm] = useState<"" | "issue" | "delete">("");
  const [emailing, setEmailing] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api<any>(`documents/${Number(id)}`).then((d) => live && setDoc(mapDoc(d))).catch((e) => live && (e.status === 404 ? setDoc("missing") : setLoadErr(e.message)));
    return () => { live = false; };
  }, [id]);

  const crumb = <a className="crumb" href={`#/${base}`}><I.back />{pluralFor(kind)}</a>;
  if (loadErr) return <div className="page">{crumb}<div className="notice"><I.alert /><div><strong>Couldn’t open this document</strong><p>{loadErr}</p></div></div></div>;
  if (doc === "missing") return <div className="page">{crumb}<Empty title="Not found">This document doesn’t exist.</Empty></div>;
  if (!doc) return <div className="page">{crumb}<div className="skel" style={{ width: 240, height: 34 }} /><div className="detail" style={{ marginTop: 22 }}><div className="skel" style={{ height: 560 }} /><div className="skel" style={{ height: 200 }} /></div></div>;

  const d = doc;
  const isDraft = d.status === "draft";
  const st = kind === "invoice" ? invoiceStatus(d) : kind === "quote" ? quoteStatus(d) : creditNoteStatus(d);
  const c = data.customers.find((x) => x.sageId === d.customerSageId);
  const label = labelFor(kind);
  const titleCap = kind === "invoice" ? "Invoice" : kind === "quote" ? "Quote" : "Credit note";
  const displayCustomerName = d.customerSnapshot?.name ?? customerName(d.customerSageId, d.customerName);

  async function issue() {
    setBusy("issue"); setErr(null);
    try {
      const nd = mapDoc(await api<any>(`documents/${d.sageId}/issue`, { method: "POST", body: { version: d.version } }));
      await reload(); setDoc(nd); notify(`${titleCap} ${nd.number} issued`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); setConfirm(""); }
  }
  async function remove() {
    setBusy("delete"); setErr(null);
    try { await api(`documents/${d.sageId}`, { method: "DELETE" }); await reload(); notify("Draft deleted"); go(`/${base}`, true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(""); setConfirm(""); }
  }

  async function downloadPdf() {
    setPdfBusy(true); setErr("");
    try { const { downloadDocumentPdf } = await import("../pdf"); await downloadDocumentPdf({ kind, number: isDraft ? "Draft" : d.number, date: d.date, dueDate: d.dueDate, reference: d.reference, fromDocument: d.fromDocument, customerSageId: d.customerSageId, customerName: displayCustomerName, lines: d.lines, exclusiveCents: d.exclusiveCents, taxCents: d.taxCents, totalCents: d.totalCents, discountCents: d.discountCents, message: d.message ?? (kind === "invoice" ? data.invoiceMessage : null), draft: isDraft, customerSnapshot: d.customerSnapshot, companySnapshot: d.companySnapshot }); notify("PDF downloaded"); }
    catch (e) { setErr("Could not create the PDF: " + (e instanceof Error ? e.message : String(e))); }
    finally { setPdfBusy(false); }
  }

  return (
    <div className="page">
      {crumb}
      <div className="page-head">
        <div>
          <h1 className="num">{isDraft ? `Draft ${label}` : d.number}</h1>
          <p className="sub">{displayCustomerName} · {fmtDate(d.date)}</p>
        </div>
        <div className="toolbar">
          <Pill tone={st.tone}>{st.label}</Pill>
          <button className="btn primary" type="button" disabled={!!busy || pdfBusy} onClick={downloadPdf} title="Download this document as a PDF file"><I.print />{pdfBusy ? "Preparing PDF..." : "Download PDF"}</button>
          <button className="btn" type="button" onClick={() => window.print()} title="Print"><I.print />Print</button>
          {isDraft ? (
            <>
              <a className="btn" href={`#/${base}/${d.sageId}/edit`}>Edit</a>
              <button className="btn primary" onClick={() => setConfirm("issue")} disabled={!!busy}><I.check />Issue {label}</button>
            </>
          ) : (
            <>
              <button className="btn" type="button" onClick={() => setEmailing(true)} title={`Email ${label} to customer`}><I.mail />Email {label}</button>
              {kind === "quote" && <a className="btn primary" href={`#/invoices/new?from=${d.sageId}`}><I.invoice />Turn into invoice</a>}
              {kind === "invoice" && <a className="btn" href={`#/credit-notes/new?from=${d.sageId}`} title="Create a credit note to reverse or adjust this invoice">Credit note</a>}
              <a className="btn" href={`#/${base}/new?from=${d.sageId}`}><I.copy />Copy</a>
            </>
          )}
        </div>
      </div>
      {confirm === "issue" && (
        <div className="notice info" style={{ marginBottom: 16 }} role="alertdialog" aria-labelledby="iss-h">
          <I.info /><div style={{ flex: 1 }}>
            <strong id="iss-h">Issue this {label} for {rand(d.totalCents)}?</strong>
            <p>It gets the next number and is locked, so it can’t be edited afterwards. Nothing is emailed.</p>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn primary small" onClick={issue} disabled={!!busy}>{busy === "issue" ? "Issuing…" : `Yes, issue ${label}`}</button>
              <button className="btn ghost small" onClick={() => setConfirm("")}>Not yet</button>
            </div>
          </div>
        </div>
      )}
      {confirm === "delete" && (
        <div className="notice" style={{ marginBottom: 16 }} role="alertdialog" aria-labelledby="del-h">
          <I.alert /><div style={{ flex: 1 }}>
            <strong id="del-h">Delete this draft?</strong><p>This can’t be undone.</p>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="btn small" onClick={remove} disabled={!!busy}>{busy === "delete" ? "Deleting…" : "Yes, delete draft"}</button>
              <button className="btn ghost small" onClick={() => setConfirm("")}>Keep it</button>
            </div>
          </div>
        </div>
      )}
      {err && <div className="notice" style={{ marginBottom: 16 }}><I.alert /><div><strong>That didn’t work</strong><p>{err}</p></div></div>}
      {emailing && (
        <EmailModal d={d} kind={kind} onClose={() => setEmailing(false)} onSent={async (nd) => { setDoc(nd); await reload(); }} />
      )}
      <div className="detail">
        <div><Paper kind={kind} number={isDraft ? "Draft" : d.number} date={d.date} dueDate={d.dueDate} reference={d.reference}
          fromDocument={d.fromDocument}
          customerSageId={d.customerSageId} customerName={displayCustomerName} lines={d.lines} exclusiveCents={d.exclusiveCents}
          taxCents={d.taxCents} totalCents={d.totalCents} discountCents={d.discountCents} message={d.message ?? (kind === "invoice" ? data.invoiceMessage : null)} draft={isDraft}
          customerSnapshot={d.customerSnapshot} companySnapshot={d.companySnapshot} /></div>
        <div className="stack">
          <section className="glass">
            <div className="panel-head"><h2>Summary</h2></div>
            <dl className="kv num">
              <dt>{kind === "credit_note" ? "Total credit" : "Total"}</dt><dd className="strong">{rand(d.totalCents)}</dd>
              <dt>VAT</dt><dd>{rand(d.taxCents)}</dd>
              {kind !== "credit_note" && <><dt>{kind === "invoice" ? "Due date" : "Valid until"}</dt><dd>{fmtDate(d.dueDate)}</dd></>}
              {d.fromDocument && <><dt>{kind === "credit_note" ? "Credits invoice" : "From"}</dt><dd>{d.fromDocument}</dd></>}
              {d.reference && <><dt>Reference</dt><dd>{d.reference}</dd></>}
            </dl>
          </section>
          {kind === "invoice" && !isDraft && <Payments d={d} onChange={async (nd) => { setDoc(nd); await reload(); }} />}
          {d.emails && d.emails.length > 0 && (
            <section className="glass">
              <div className="panel-head"><h2>Email History</h2></div>
              <ul className="pay-list" style={{ listStyle: "none", margin: 0, padding: "0 18px 14px" }}>
                {d.emails.map((e) => (
                  <li key={e.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--hair-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{e.recipientEmail}</span>
                      <Pill tone={e.status === "sent" ? "ok" : "warn"}>{e.status}</Pill>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      {fmtDate(e.createdAt.slice(0, 10))} by {e.createdBy}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {isDraft && <button className="btn ghost" onClick={() => setConfirm("delete")} style={{ alignSelf: "flex-start" }}><I.trash />Delete draft</button>}
          {c && (
            <a className="glass tile interactive" href={`#/customers/${c.sageId}`} style={{ display: "block", padding: 18 }}>
              <div className="tile-label"><I.users />Customer</div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>{c.name}</div>
              <div className="muted">{c.email ?? "No email on file"}</div>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Payments({ d, onChange }: { d: Doc; onChange: (d: Doc) => Promise<void> }) {
  const { notify } = useApp();
  const open = openCents(d);
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("EFT");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const start = () => { setAdding(true); setErr(null); setAmount((open / 100).toFixed(2)); setKey(crypto.randomUUID()); };
  async function save() {
    const cents = parsePrice(amount);
    if (cents === null || cents <= 0) return setErr("Enter the amount received, for example 1250.00");
    if (cents > open) return setErr(`That is more than the ${rand(open)} still owed.`);
    setBusy(true); setErr(null);
    try {
      const nd = mapDoc(await api<any>(`documents/${d.sageId}/payments`, { method: "POST", body: { date, amountCents: cents, method, reference: reference || null, clientKey: key } }));
      setAdding(false); setReference(""); await onChange(nd); notify(`Payment of ${rand(cents)} recorded`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    if (!confirm("Remove this payment? The invoice will show as owed again.")) return;
    try { const nd = mapDoc(await api<any>(`documents/${d.sageId}/payments/${id}`, { method: "DELETE" })); await onChange(nd); notify("Payment removed"); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }
  const pays = (d.payments ?? []).filter((p) => !p.voidedAt);
  const creds = d.creditNotes ?? [];
  return (
    <section className="glass">
      <div className="panel-head"><h2>Payments &amp; Credits</h2></div>
      <dl className="kv num">
        <dt>Settled / Credited</dt><dd>{rand(d.paidCents ?? 0)}</dd>
        <dt>Still owed</dt><dd className="strong">{rand(open)}</dd>
      </dl>
      {d.source === "sage" && pays.length === 0 && creds.length === 0 && d.sageStatus !== "Paid" && (
        <p className="muted" style={{ padding: "0 18px" }}>Imported from Sage. Payments after February 2022 were not recorded in Sage, so check your bank statement before chasing this one.</p>
      )}
      {creds.length > 0 && (
        <ul className="pay-list" style={{ listStyle: "none", margin: 0, padding: "0 18px" }}>
          {creds.map((cn) => (
            <li key={cn.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
              <span className="num strong" style={{ color: "var(--ok)" }}>−{rand(cn.total_cents)}</span>
              <span className="muted"><a href={`#/credit-notes/${cn.id}`} style={{ color: "var(--accent)", textDecoration: "underline" }}>{cn.number ?? "Draft Credit Note"}</a> · {fmtDate(cn.date)}</span>
              <Pill tone={cn.status === "issued" ? "ok" : "info"}>{cn.status}</Pill>
            </li>
          ))}
        </ul>
      )}
      {pays.length > 0 && (
        <ul className="pay-list" style={{ listStyle: "none", margin: 0, padding: "0 18px" }}>
          {pays.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
              <span className="num strong">{rand(p.amountCents)}</span>
              <span className="muted">{fmtDate(p.date)}{p.method ? ` · ${p.method}` : ""}{p.reference ? ` · ${p.reference}` : ""}</span>
              <button className="btn ghost small" style={{ marginLeft: "auto" }} onClick={() => remove(p.id)} aria-label={`Remove payment of ${rand(p.amountCents)}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ padding: 18 }}>
        {!adding ? (open > 0 && <button className="btn primary small" onClick={start}><I.check />Record payment</button>) : (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
            <label className="field"><span>Date received</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            <label className="field"><span>Amount (R)</span><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label className="field"><span>How</span>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}><option>EFT</option><option>Cash</option><option>Card</option><option>Other</option></select></label>
            <label className="field"><span>Bank reference (optional)</span><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></label>
            {err && <p className="auth-err" role="alert">{err}</p>}
            <div className="toolbar">
              <button className="btn primary small" type="submit" disabled={busy}>{busy ? "Saving…" : "Save payment"}</button>
              <button className="btn ghost small" type="button" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}


function EmailModal({ d, kind, onClose, onSent }: { d: Doc; kind: Kind; onClose: () => void; onSent: (d: Doc) => Promise<void> }) {
  const { notify } = useApp();
  const co = d.companySnapshot ?? data.companies.find((c) => c.id === data.companyId) ?? data.companies[0];
  const c = d.customerSageId ? data.customers.find((x) => x.sageId === d.customerSageId) : undefined;
  const label = kind === "invoice" ? "Invoice" : kind === "quote" ? "Quotation" : "Credit Note";
  const defSubject = `${label} ${d.number} from ${co.displayName}`;
  const totalStr = rand(d.totalCents);
  const bank = parseBankDetails(co, d.message);
  const lineSummary = d.lines.map((l) => `- ${Number(l.quantity) !== 1 ? `${Number(l.quantity)} x ` : ""}${l.description}: ${rand(l.totalCents)}`).join("\n");
  const bankSection = kind === "invoice"
    ? `\n\nBanking Details:\nBank: ${bank.bank}\nAccount Name: ${bank.accountName}\nAccount Number: ${bank.accountNumber}\nBranch Code: ${bank.branchCode}\nPayment Reference: ${d.number}\nProof of Payment: ${bank.proofEmail}`
    : "";
  const defBody = `Dear ${d.customerSnapshot?.name ?? c?.name ?? "Customer"},\n\nHere are the details for ${label} ${d.number} (${fmtDate(d.date)}${d.dueDate ? `, due ${fmtDate(d.dueDate)}` : ""}) for ${totalStr}:\n\n${lineSummary}\n\nTotal: ${totalStr}${bankSection}\n\nPlease contact us should you have any queries.\n\nRegards,\n${co.displayName}`;

  const [toEmail, setToEmail] = useState(d.customerSnapshot?.email ?? c?.email ?? "");
  const [ccEmail, setCcEmail] = useState(co.email ?? "accounts@logia.co.za");
  const [subject, setSubject] = useState(defSubject);
  const [message, setMessage] = useState(defBody);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function makePdf(): Promise<string | undefined> {
    try {
      const { buildDocumentPdf } = await import("../pdf");
      const { doc } = await buildDocumentPdf({ kind, number: d.number, date: d.date, dueDate: d.dueDate, reference: d.reference, fromDocument: d.fromDocument, customerSageId: d.customerSageId, customerName: d.customerSnapshot?.name ?? c?.name, lines: d.lines, exclusiveCents: d.exclusiveCents, taxCents: d.taxCents, totalCents: d.totalCents, discountCents: d.discountCents, message: d.message ?? (kind === "invoice" ? data.invoiceMessage : null), draft: false, customerSnapshot: d.customerSnapshot, companySnapshot: d.companySnapshot });
      const buf = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(bin);
    } catch { return undefined; }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!toEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim())) {
      setErr("Enter a valid recipient email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api<any>(`documents/${d.sageId}/send`, {
        method: "POST",
        body: { toEmail: toEmail.trim(), ccEmail: ccEmail.trim() || null, subject, message, pdfBase64: await makePdf() },
      });
      const nd = mapDoc(res);
      notify(`${label} ${d.number} sent to ${toEmail.trim()}`);
      onClose();
      await onSent(nd);
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x));
      setBusy(false);
    }
  }

  return (
    <div className="notice info" style={{ marginBottom: 18 }} role="dialog" aria-labelledby="em-h">
      <I.mail />
      <div style={{ flex: 1 }}>
        <strong id="em-h">Email {label} {d.number} to Customer</strong>
        <p className="muted" style={{ marginTop: 2 }}>Sends the email with the invoice attached as a PDF, from {co.email ?? "accounts@logia.co.za"} with delivery logged in history.</p>
        <form className="stack" onSubmit={send} style={{ marginTop: 14 }}>
          <div className="form-row">
            <label className="field"><span>Recipient Email</span><input className="input" type="email" required value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="customer@example.com" /></label>
            <label className="field"><span>CC Email</span><input className="input" type="email" value={ccEmail} onChange={(e) => setCcEmail(e.target.value)} placeholder="accounts@logia.co.za" /></label>
          </div>
          <label className="field"><span>Subject</span><input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field"><span>Message Body</span><textarea className="input" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} style={{ height: "auto" }} /></label>
          {err && <p className="auth-err" role="alert">{err}</p>}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button className="btn primary small" type="submit" disabled={busy}>{busy ? "Sending…" : `Send ${label}`}</button>
            <button className="btn ghost small" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
