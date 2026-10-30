import { useMemo } from "react";
import { data, invoices, quotes, nextRun, dateParts, fmtDate, todayISO, customerName, invoiceStatus, quoteStatus } from "../data";
import { rand } from "../money";
import { I, Pill } from "../ui";
import { go, useApp } from "../App";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  useApp();
  const today = todayISO();
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);

  const run = useMemo(() => {
    const upcoming = data.recurring.map((r) => ({ r, next: nextRun(r) })).filter((x) => x.next && x.next >= today);
    const first = upcoming.map((x) => x.next!).sort()[0];
    const batch = upcoming.filter((x) => x.next === first);
    return { date: first, batch, total: batch.reduce((a, x) => a + x.r.totalCents, 0) };
  }, [today]);

  const issued = invoices.filter((d) => d.status === "issued");
  const thisMonth = issued.filter((d) => d.date.startsWith(month));
  const thisYear = issued.filter((d) => d.date.startsWith(year));
  const waiting = quotes.filter((q) => q.sageStatus === "Pending");
  const unchecked = invoices.filter((d) => invoiceStatus(d).label === "Not checked");
  const sum = (ds: { totalCents: number }[]) => ds.reduce((a, d) => a + d.totalCents, 0);
  const p = run.date ? dateParts(run.date) : null;

  const recent = [...invoices.slice(0, 8), ...quotes.slice(0, 4)]
    .sort((a, b) => (a.status === "draft" ? -1 : b.status === "draft" ? 1 : b.date.localeCompare(a.date) || b.number.localeCompare(a.number))).slice(0, 8);
  const drafts = [...invoices, ...quotes].filter((d) => d.status === "draft");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="greet">{greeting()}, Dennis</h1>
          <p className="sub">{data.companies.find((c) => c.id === data.companyId)?.displayName.replace(" (Pty) Ltd", "")} · {fmtDate(today)}{drafts.length > 0 && <> · <a href="#/invoices" style={{ color: "var(--accent)" }}>{drafts.length} draft{drafts.length > 1 ? "s" : ""} waiting</a></>}</p>
        </div>
        <div className="toolbar">
          <a className="btn" href="#/quotes/new"><I.plus />New quote</a>
          <a className="btn primary" href="#/invoices/new"><I.plus />New invoice</a>
        </div>
      </div>

      <div className="tiles">
        {p && (
          <a href="#/recurring" className="glass tile interactive span-7 run" aria-label={`Next recurring run on ${fmtDate(run.date)}: ${run.batch.length} invoices`}>
            <div className="dayglass" aria-hidden>
              <span className="m">{p.monthShort}</span><span className="d num">{p.d}</span><span className="w">{p.weekday}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="tile-label"><I.repeat />Next recurring invoices</div>
              <div className="tile-value num" style={{ marginTop: 8 }}>{rand(run.total)}</div>
              <div className="muted" style={{ marginTop: 4 }}>{run.batch.length} invoices on the schedule · Sage still sends these until automatic sending is switched on in Plutus</div>
              <div className="run-list">
                {run.batch.slice(0, 8).map((x) => <span className="chip" key={x.r.number}>{customerName(x.r.customerSageId)}</span>)}
                {run.batch.length > 8 && <span className="chip">+{run.batch.length - 8} more</span>}
              </div>
            </div>
          </a>
        )}

        <a href="#/invoices" className="glass tile interactive span-5 tile-pad">
          <div className="tile-label"><I.invoice />Invoiced in {dateParts(today).month}</div>
          <div className="tile-value num">{rand(sum(thisMonth))}</div>
          <div className="muted">{thisMonth.length} invoices</div>
          <div className="tile-foot">This year so far: <span className="num">{rand(sum(thisYear))}</span></div>
        </a>

        <a href="#/quotes" className="glass tile interactive span-4 tile-pad">
          <div className="tile-label"><I.quote />Quotes waiting for a yes</div>
          <div className="tile-value num">{waiting.length}</div>
          <div className="muted num">{rand(sum(waiting))} in total</div>
          <div className="tile-foot">Open quotes<I.arrow /></div>
        </a>

        <a href="#/banking" className="glass tile interactive span-4 tile-pad">
          <div className="tile-label"><I.bank />Payments to check</div>
          <div className="tile-value num">{unchecked.length}</div>
          <div className="muted">invoices with no payment recorded in Sage</div>
          <div className="tile-foot">Upload your FNB statement<I.arrow /></div>
        </a>

        <a href="#/customers" className="glass tile interactive span-4 tile-pad">
          <div className="tile-label"><I.users />Customers</div>
          <div className="tile-value num">{data.customers.length}</div>
          <div className="muted">{data.items.filter((i) => i.active).length} items and services on your price list</div>
          <div className="tile-foot">View customers<I.arrow /></div>
        </a>

        <section className="glass panel span-12" aria-labelledby="recent-h">
          <div className="panel-head"><h2 id="recent-h">Recent activity</h2><a className="btn ghost small" href="#/invoices">All invoices<I.arrow /></a></div>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Document</th><th>Customer</th><th className="hide-xs">Date</th><th className="r">Amount</th><th className="hide-sm">Status</th></tr></thead>
              <tbody>
                {recent.map((d) => {
                  const kind = d.kind;
                  const st = kind === "invoice" ? invoiceStatus(d) : quoteStatus(d);
                  const href = `/${kind === "invoice" ? "invoices" : "quotes"}/${d.sageId}`;
                  return (
                    <tr key={d.sageId} className="row" tabIndex={0} onClick={() => go(href)} onKeyDown={(e) => e.key === "Enter" && go(href)}>
                      <td><div className="strong">{d.number}</div><div className="cell-sub">{kind === "invoice" ? "Invoice" : "Quote"}</div></td>
                      <td>{customerName(d.customerSageId, d.customerName)}</td>
                      <td className="hide-xs muted">{fmtDate(d.date)}</td>
                      <td className="r num strong">{rand(d.totalCents)}</td>
                      <td className="hide-sm"><Pill tone={st.tone}>{st.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
