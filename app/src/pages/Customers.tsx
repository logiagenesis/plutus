import { useMemo, useState } from "react";
import { data, invoices, quotes, customersById, fmtDate, invoiceStatus, nextRun } from "../data";
import { rand } from "../money";
import { I, Pill, Empty } from "../ui";
import { go, useApp } from "../App";

export function CustomerList() {
  const { rev } = useApp();
  const [q, setQ] = useState("");
  const stats = useMemo(() => {
    const m = new Map<number, { count: number; last: string; recurring: number }>();
    for (const d of invoices) {
      const s = m.get(d.customerSageId) ?? { count: 0, last: "", recurring: 0 };
      s.count++; if (d.date > s.last) s.last = d.date; m.set(d.customerSageId, s);
    }
    for (const r of data.recurring) if (r.active) { const s = m.get(r.customerSageId) ?? { count: 0, last: "", recurring: 0 }; s.recurring += r.totalCents; m.set(r.customerSageId, s); }
    return m;
  }, [rev]);
  const rows = data.customers
    .filter((c) => !q || [c.name, c.contactName, c.email, c.category].some((v) => (v ?? "").toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (stats.get(b.sageId)?.last ?? "").localeCompare(stats.get(a.sageId)?.last ?? "") || a.name.localeCompare(b.name));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Customers</h1><p className="sub">{data.customers.length} customers · most recently invoiced first</p></div>
        <a className="btn primary" href="#/customers/new"><I.plus />Add customer</a>
      </div>
      <section className="glass panel">
        <div className="panel-head">
          <label className="search" style={{ flex: "1 1 260px", maxWidth: 420 }}><I.search /><input className="input" placeholder="Search by name, contact or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" /></label>
          <span className="muted">{rows.length} shown</span>
        </div>
        {rows.length === 0 ? <Empty title="No customers match" /> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Customer</th><th className="hide-sm">Contact</th><th className="hide-xs">Last invoice</th><th className="r hide-xs">Monthly recurring</th><th className="r">Invoices</th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const s = stats.get(c.sageId);
                  return (
                    <tr key={c.sageId} className="row" tabIndex={0} onClick={() => go(`/customers/${c.sageId}`)} onKeyDown={(e) => e.key === "Enter" && go(`/customers/${c.sageId}`)}>
                      <td><div className="strong">{c.name}</div><div className="cell-sub">{c.category ?? ""}</div></td>
                      <td className="hide-sm"><div>{c.contactName ?? "—"}</div><div className="cell-sub">{c.email ?? "No email"}</div></td>
                      <td className="hide-xs muted">{s?.last ? fmtDate(s.last) : "Never"}</td>
                      <td className="r num hide-xs">{s?.recurring ? rand(s.recurring) : <span className="faint">—</span>}</td>
                      <td className="r num">{s?.count ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export function CustomerView({ id }: { id: number }) {
  useApp();
  const c = customersById.get(id);
  if (!c) return <div className="page"><a className="crumb" href="#/customers"><I.back />Customers</a><Empty title="Customer not found" /></div>;
  const inv = invoices.filter((d) => d.customerSageId === id);
  const quo = quotes.filter((d) => d.customerSageId === id);
  const rec = data.recurring.filter((r) => r.customerSageId === id);
  const total = inv.reduce((a, d) => a + d.totalCents, 0);
  return (
    <div className="page">
      <a className="crumb" href="#/customers"><I.back />Customers</a>
      <div className="page-head">
        <div><h1>{c.name}</h1><p className="sub">{c.category ?? "No category"} · {inv.length} invoices · {rand(total)} invoiced in total</p></div>
        <div className="toolbar">
          <a className="btn" href={`#/quotes/new`}>New quote</a>
          <a className="btn" href={`#/customers/${c.sageId}/edit`}>Edit</a>
          <a className="btn primary" href={inv.find((d) => d.status === "issued") ? `#/invoices/new?from=${inv.find((d) => d.status === "issued")!.sageId}` : "#/invoices/new"}><I.plus />New invoice</a>
        </div>
      </div>
      <div className="detail">
        <div className="stack">
          {rec.length > 0 && (
            <section className="glass panel">
              <div className="panel-head"><h2>Recurring invoices</h2></div>
              <div className="table-wrap"><table className="grid"><tbody>
                {rec.map((r) => (
                  <tr key={r.number}>
                    <td><div className="strong">{r.lines.map((l) => l.description).join(", ")}</div><div className="cell-sub">{r.frequency === "annually" ? "Every year" : "Every month"} on the {Number(r.startDate.slice(8))}th · next {fmtDate(nextRun(r))}</div></td>
                    <td className="r num strong">{rand(r.totalCents)}</td>
                  </tr>
                ))}
              </tbody></table></div>
            </section>
          )}
          <section className="glass panel">
            <div className="panel-head"><h2>Invoices</h2><span className="muted">{inv.length}</span></div>
            {inv.length === 0 ? <Empty title="No invoices yet" /> : (
              <div className="table-wrap"><table className="grid">
                <thead><tr><th>Number</th><th className="hide-xs">Date</th><th className="r">Total</th><th className="hide-sm">Status</th></tr></thead>
                <tbody>{inv.slice(0, 30).map((d) => { const st = invoiceStatus(d); return (
                  <tr key={d.sageId} className="row" tabIndex={0} onClick={() => go(`/invoices/${d.sageId}`)} onKeyDown={(e) => e.key === "Enter" && go(`/invoices/${d.sageId}`)}>
                    <td><div className="strong">{d.status === "draft" ? "Draft" : d.number}</div><div className="cell-sub">{d.firstLine}</div></td>
                    <td className="hide-xs muted">{fmtDate(d.date)}</td><td className="r num strong">{rand(d.totalCents)}</td>
                    <td className="hide-sm"><Pill tone={st.tone}>{st.label}</Pill></td>
                  </tr>); })}</tbody>
              </table></div>
            )}
            {inv.length > 30 && <div className="pager"><span>Showing the latest 30 of {inv.length}</span><a className="btn small" href="#/invoices">Search all invoices</a></div>}
          </section>
          {quo.length > 0 && <p className="muted" style={{ margin: 0 }}>{quo.length} quotes for this customer are on the <a href="#/quotes" style={{ color: "var(--accent)" }}>Quotes</a> page.</p>}
        </div>
        <section className="glass">
          <div className="panel-head"><h2>Contact details</h2></div>
          <dl className="kv">
            <dt>Contact</dt><dd>{c.contactName ?? "—"}</dd>
            <dt>Email</dt><dd>{c.email ?? <span className="faint">None on file</span>}</dd>
            <dt>Mobile</dt><dd>{c.mobile ?? "—"}</dd>
            <dt>Telephone</dt><dd>{c.telephone ?? "—"}</dd>
            <dt>VAT number</dt><dd>{c.vatNumber ?? "—"}</dd>
            <dt>Address</dt><dd>{(c.postalAddress ?? c.deliveryAddress)?.map((a) => <div key={a}>{a}</div>) ?? "—"}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
