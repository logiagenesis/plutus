import { useEffect, useMemo, useState } from "react";
import { invoices, quotes, customerName, fmtDate, invoiceStatus, quoteStatus, data, api, mapDoc, todayISO, openCents, type Doc } from "../data";
import { rand } from "../money";
import { parsePrice } from "./Editor";
import { I, Pill, Empty } from "../ui";
import { go, useApp } from "../App";
import Paper from "./Paper";

type Kind = "invoice" | "quote";
const PAGE = 25;

export function DocList({ kind }: { kind: Kind }) {
  useApp();
  const all = kind === "invoice" ? invoices : quotes;
  const years = useMemo(() => [...new Set(all.map((d) => d.date.slice(0, 4)))].sort().reverse(), [all]);
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const statusOf = (d: Doc) => (kind === "invoice" ? invoiceStatus(d) : quoteStatus(d));
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
  const label = kind === "invoice" ? "Invoices" : "Quotes";
  const base = kind === "invoice" ? "invoices" : "quotes";
  const fromSage = all.some((d) => d.sageStatus);
  const owed = kind === "invoice" ? all.filter((d) => d.status === "issued" && d.source === "app") : [];
  const owedCents = owed.reduce((x, d) => x + openCents(d), 0);
  const owedCount = owed.filter((d) => openCents(d) > 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{label}</h1><p className="sub">{all.length} {label.toLowerCase()}{owedCount > 0 && <> · <span style={{ color: "var(--accent)" }}>{owedCount} Plutus invoice{owedCount > 1 ? "s" : ""} owed: {rand(owedCents)}</span></>}</p></div>
        <a className="btn primary" href={`#/${base}/new`}><I.plus />New {kind}</a>
      </div>
      {kind === "invoice" && fromSage && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <I.alert />
          <div><strong>Payments were not recorded in Sage after February 2022.</strong>
            <p>So almost every imported invoice shows “Not checked”. This is not money owed until we match it to your FNB statement.</p></div>
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
              <thead><tr><th>Number</th><th>Customer</th><th className="hide-xs">Date</th><th className="hide-sm">{kind === "invoice" ? "Due" : "Reference"}</th><th className="r">Total</th><th className="hide-sm">Status</th></tr></thead>
              <tbody>
                {shown.map((d) => {
                  const st = statusOf(d);
                  const href = `/${base}/${d.sageId}`;
                  return (
                    <tr key={d.sageId} className="row" tabIndex={0} onClick={() => go(href)} onKeyDown={(e) => e.key === "Enter" && go(href)}>
                      <td className="strong">{d.status === "draft" ? <span className="muted">Draft</span> : d.number}</td>
                      <td><div>{customerName(d.customerSageId)}</div><div className="cell-sub">{d.firstLine}{(d.lineCount ?? 0) > 1 ? ` + ${(d.lineCount ?? 1) - 1} more` : ""}</div></td>
                      <td className="hide-xs muted">{fmtDate(d.date)}</td>
                      <td className="hide-sm muted">{kind === "invoice" ? fmtDate(d.dueDate) : d.reference ?? "—"}</td>
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
  const base = kind === "invoice" ? "invoices" : "quotes";
  const [doc, setDoc] = useState<Doc | null | "missing">(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "issue" | "delete">("");
  const [confirm, setConfirm] = useState<"" | "issue" | "delete">("");
  useEffect(() => {
    let live = true;
    api<any>(`documents/${Number(id)}`).then((d) => live && setDoc(mapDoc(d))).catch((e) => live && (e.status === 404 ? setDoc("missing") : setLoadErr(e.message)));
    return () => { live = false; };
  }, [id]);

  const crumb = <a className="crumb" href={`#/${base}`}><I.back />{kind === "invoice" ? "Invoices" : "Quotes"}</a>;
  if (loadErr) return <div className="page">{crumb}<div className="notice"><I.alert /><div><strong>Couldn’t open this document</strong><p>{loadErr}</p></div></div></div>;
  if (doc === "missing") return <div className="page">{crumb}<Empty title="Not found">This document doesn’t exist.</Empty></div>;
  if (!doc) return <div className="page">{crumb}<div className="skel" style={{ width: 240, height: 34 }} /><div className="detail" style={{ marginTop: 22 }}><div className="skel" style={{ height: 560 }} /><div className="skel" style={{ height: 200 }} /></div></div>;

  const d = doc;
  const isDraft = d.status === "draft";
  const st = kind === "invoice" ? invoiceStatus(d) : quoteStatus(d);
  const c = data.customers.find((x) => x.sageId === d.customerSageId);
  const label = kind === "invoice" ? "invoice" : "quote";

  async function issue() {
    setBusy("issue"); setErr(null);
    try {
      const nd = mapDoc(await api<any>(`documents/${d.sageId}/issue`, { method: "POST", body: { version: d.version } }));
      await reload(); setDoc(nd); notify(`${kind === "invoice" ? "Invoice" : "Quote"} ${nd.number} issued`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); setConfirm(""); }
  }
  async function remove() {
    setBusy("delete"); setErr(null);
    try { await api(`documents/${d.sageId}`, { method: "DELETE" }); await reload(); notify("Draft deleted"); go(`/${base}`, true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(""); setConfirm(""); }
  }

  return (
    <div className="page">
      {crumb}
      <div className="page-head">
        <div>
          <h1 className="num">{isDraft ? `Draft ${label}` : d.number}</h1>
          <p className="sub">{customerName(d.customerSageId)} · {fmtDate(d.date)}</p>
        </div>
        <div className="toolbar">
          <Pill tone={st.tone}>{st.label}</Pill>
          {isDraft ? (
            <>
              <a className="btn" href={`#/${base}/${d.sageId}/edit`}>Edit</a>
              <button className="btn primary" onClick={() => setConfirm("issue")} disabled={!!busy}><I.check />Issue {label}</button>
            </>
          ) : (
            <>
              {kind === "quote" && <a className="btn primary" href={`#/invoices/new?from=${d.sageId}`}><I.invoice />Turn into invoice</a>}
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
      <div className="detail">
        <div><Paper kind={kind} number={isDraft ? "Draft" : d.number} date={d.date} dueDate={d.dueDate} reference={d.reference}
          customerSageId={d.customerSageId} lines={d.lines} exclusiveCents={d.exclusiveCents}
          taxCents={d.taxCents} totalCents={d.totalCents} discountCents={d.discountCents} message={d.message ?? (kind === "invoice" ? data.invoiceMessage : null)} draft={isDraft}
          customerSnapshot={d.customerSnapshot} companySnapshot={d.companySnapshot} /></div>
        <div className="stack">
          <section className="glass">
            <div className="panel-head"><h2>Summary</h2></div>
            <dl className="kv num">
              <dt>Total</dt><dd className="strong">{rand(d.totalCents)}</dd>
              <dt>VAT</dt><dd>{rand(d.taxCents)}</dd>
              <dt>{kind === "invoice" ? "Due date" : "Valid until"}</dt><dd>{fmtDate(d.dueDate)}</dd>
              {d.fromDocument && <><dt>From</dt><dd>{d.fromDocument}</dd></>}
              {d.reference && <><dt>Reference</dt><dd>{d.reference}</dd></>}
            </dl>
          </section>
          {kind === "invoice" && !isDraft && <Payments d={d} onChange={async (nd) => { setDoc(nd); await reload(); }} />}
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
  return (
    <section className="glass">
      <div className="panel-head"><h2>Payments</h2></div>
      <dl className="kv num">
        <dt>Received</dt><dd>{rand(d.paidCents ?? 0)}</dd>
        <dt>Still owed</dt><dd className="strong">{rand(open)}</dd>
      </dl>
      {d.source === "sage" && pays.length === 0 && <p className="muted" style={{ padding: "0 18px" }}>Imported from Sage. Payments after February 2022 were not recorded in Sage, so check your bank statement before chasing this one.</p>}
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
