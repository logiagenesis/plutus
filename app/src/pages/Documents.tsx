import { useMemo, useState } from "react";
import { invoices, quotes, customerName, fmtDate, invoiceStatus, quoteStatus, data, type Doc } from "../data";
import { rand } from "../money";
import { I, Pill, Empty } from "../ui";
import { go, useApp, type Draft } from "../App";
import Paper from "./Paper";

type Kind = "invoice" | "quote";
const PAGE = 25;

export function DocList({ kind }: { kind: Kind }) {
  const { drafts } = useApp();
  const all: (Doc & { draft?: boolean })[] = useMemo(() => [
    ...drafts.filter((d) => d.kind === kind).map((d) => ({ ...d, draft: true })),
    ...(kind === "invoice" ? invoices : quotes),
  ], [drafts, kind]);
  const years = useMemo(() => [...new Set(all.map((d) => d.date.slice(0, 4)))].sort().reverse(), [all]);
  const [q, setQ] = useState("");
  const [year, setYear] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const statusOf = (d: Doc & { draft?: boolean }) => d.draft ? { label: "Draft", tone: "info" as const } : kind === "invoice" ? invoiceStatus(d) : quoteStatus(d);
  const statuses = useMemo(() => [...new Set(all.map((d) => statusOf(d).label))], [all]);

  const rows = all.filter((d) => {
    if (year !== "all" && !d.date.startsWith(year)) return false;
    if (status !== "all" && statusOf(d).label !== status) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return d.number.toLowerCase().includes(s) || customerName(d.customerSageId, d.customerName).toLowerCase().includes(s)
      || (d.reference ?? "").toLowerCase().includes(s) || d.lines.some((l) => l.description.toLowerCase().includes(s));
  });
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const total = rows.reduce((a, d) => a + d.totalCents, 0);
  const label = kind === "invoice" ? "Invoices" : "Quotes";
  const base = kind === "invoice" ? "invoices" : "quotes";

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{label}</h1><p className="sub">{all.length} {label.toLowerCase()} · imported from Sage</p></div>
        <a className="btn primary" href={`#/${base}/new`}><I.plus />New {kind}</a>
      </div>
      {kind === "invoice" && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <I.alert />
          <div><strong>Payments were not recorded in Sage after February 2022.</strong>
            <p>So almost every invoice shows “Not checked”. This is not money owed until we match it to your FNB statement.</p></div>
        </div>
      )}
      <section className="glass panel">
        <div className="panel-head">
          <div className="toolbar" style={{ flex: 1 }}>
            <label className="search" style={{ flex: "1 1 260px", maxWidth: 420 }}>
              <I.search /><input className="input" placeholder={`Search ${label.toLowerCase()}, customers or items`} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={`Search ${label.toLowerCase()}`} />
            </label>
            <select className="select" style={{ width: 130 }} value={year} onChange={(e) => { setYear(e.target.value); setPage(0); }} aria-label="Year">
              <option value="all">All years</option>{years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <select className="select" style={{ width: 210 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Status">
              <option value="all">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="muted num" aria-live="polite">{rows.length} shown · {rand(total)}</div>
        </div>
        {rows.length === 0 ? <Empty title="Nothing matches">Try a different search or clear the filters.</Empty> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Number</th><th>Customer</th><th className="hide-xs">Date</th><th className="hide-sm">{kind === "invoice" ? "Due" : "Reference"}</th><th className="r">Total</th><th className="hide-sm">Status</th></tr></thead>
              <tbody>
                {shown.map((d) => {
                  const st = statusOf(d);
                  const href = `/${base}/${d.draft ? d.number : d.sageId}`;
                  return (
                    <tr key={d.number + (d.draft ? "d" : "")} className="row" tabIndex={0} onClick={() => go(href)} onKeyDown={(e) => e.key === "Enter" && go(href)}>
                      <td className="strong">{d.number}</td>
                      <td><div>{customerName(d.customerSageId, d.customerName)}</div><div className="cell-sub">{d.lines[0]?.description}{d.lines.length > 1 ? ` + ${d.lines.length - 1} more` : ""}</div></td>
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
  const { drafts } = useApp();
  const base = kind === "invoice" ? "invoices" : "quotes";
  const draft = drafts.find((d) => d.kind === kind && d.number === id) as Draft | undefined;
  const doc: Doc | undefined = draft ?? (kind === "invoice" ? invoices : quotes).find((d) => String(d.sageId) === id);
  if (!doc) return <div className="page"><a className="crumb" href={`#/${base}`}><I.back />{kind === "invoice" ? "Invoices" : "Quotes"}</a><Empty title="Not found">This document doesn’t exist.</Empty></div>;
  const st = draft ? { label: "Draft", tone: "info" as const } : kind === "invoice" ? invoiceStatus(doc) : quoteStatus(doc);
  const c = data.customers.find((x) => x.sageId === doc.customerSageId);
  const copyHref = (to: Kind) => `#/${to === "invoice" ? "invoices" : "quotes"}/new?from=${kind}:${draft ? doc.number : doc.sageId}`;

  return (
    <div className="page">
      <a className="crumb" href={`#/${base}`}><I.back />{kind === "invoice" ? "Invoices" : "Quotes"}</a>
      <div className="page-head">
        <div>
          <h1 className="num">{doc.number}</h1>
          <p className="sub">{customerName(doc.customerSageId, doc.customerName)} · {fmtDate(doc.date)}</p>
        </div>
        <div className="toolbar">
          <Pill tone={st.tone}>{st.label}</Pill>
          {kind === "quote" && <a className="btn primary" href={copyHref("invoice")}><I.invoice />Turn into invoice</a>}
          <a className="btn" href={copyHref(kind)}><I.copy />Copy</a>
        </div>
      </div>
      <div className="detail">
        <div><Paper kind={kind} number={doc.number} date={doc.date} dueDate={kind === "invoice" ? doc.dueDate : doc.expiryDate} reference={doc.reference}
          customerSageId={doc.customerSageId} customerName={doc.customerName} lines={doc.lines} exclusiveCents={doc.exclusiveCents}
          taxCents={doc.taxCents} totalCents={doc.totalCents} discountCents={doc.discountCents} message={draft ? draft.message : kind === "invoice" ? data.invoiceMessage : null} draft={!!draft} /></div>
        <div className="stack">
          <section className="glass">
            <div className="panel-head"><h2>Summary</h2></div>
            <dl className="kv num">
              <dt>Total</dt><dd className="strong">{rand(doc.totalCents)}</dd>
              <dt>VAT</dt><dd>{rand(doc.taxCents)}</dd>
              {kind === "invoice" && <><dt>Due date</dt><dd>{fmtDate(doc.dueDate)}</dd></>}
              {doc.fromDocument && <><dt>From quote</dt><dd>{doc.fromDocument}</dd></>}
              {doc.reference && <><dt>Reference</dt><dd>{doc.reference}</dd></>}
            </dl>
          </section>
          {kind === "invoice" && !draft && st.label === "Not checked" && (
            <div className="notice"><I.alert /><div><strong>Payment not checked yet</strong><p>Sage has no payment recorded for this invoice. Matching your FNB statement will show if it was paid.</p></div></div>
          )}
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
