import { data, customerName, fmtDate, nextRun, todayISO } from "../data";
import { rand } from "../money";
import { I, Pill } from "../ui";
import { go } from "../App";

export default function RecurringPage() {
  const today = todayISO();
  const rows = data.recurring.map((r) => ({ r, next: nextRun(r) })).sort((a, b) => (a.next ?? "9").localeCompare(b.next ?? "9") || customerName(a.r.customerSageId).localeCompare(customerName(b.r.customerSageId)));
  const monthly = data.recurring.filter((r) => r.active && r.frequency === "monthly").reduce((a, r) => a + r.totalCents, 0);
  const annual = data.recurring.filter((r) => r.active && r.frequency === "annually").reduce((a, r) => a + r.totalCents, 0);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Recurring invoices</h1><p className="sub">These go out automatically on the 25th — the same schedule you have in Sage.</p></div>
      </div>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}><div className="tile-label"><I.repeat />Every month</div><div className="tile-value num">{rand(monthly)}</div><div className="muted">{data.recurring.filter((r) => r.active && r.frequency === "monthly").length} invoices to {new Set(data.recurring.filter((r) => r.active && r.frequency === "monthly").map((r) => r.customerSageId)).size} customers</div></div>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}><div className="tile-label"><I.repeat />Every year</div><div className="tile-value num">{rand(annual)}</div><div className="muted">{data.recurring.filter((r) => r.active && r.frequency === "annually").length} invoice</div></div>
        <div className="notice info span-4" style={{ alignSelf: "stretch" }}><I.info /><div><strong>Nothing is sent from here yet</strong><p>Sage still sends these until you switch over. Then Plutus takes over the run.</p></div></div>
      </div>
      <section className="glass panel">
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>Customer</th><th className="hide-sm">What’s billed</th><th>Next invoice</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {rows.map(({ r, next }) => (
                <tr key={r.number} className="row" tabIndex={0} onClick={() => go(`/customers/${r.customerSageId}`)} onKeyDown={(e) => e.key === "Enter" && go(`/customers/${r.customerSageId}`)}>
                  <td><div className="strong">{customerName(r.customerSageId)}</div><div className="cell-sub">{r.frequency === "annually" ? "Every year" : "Every month"} · since {fmtDate(r.startDate)}</div></td>
                  <td className="hide-sm">{r.lines.map((l, i) => <div key={i}>{Number(l.quantity) !== 1 ? `${Number(l.quantity)} × ` : ""}{l.description}{Number(l.discountPercent) ? <span className="faint"> ({Number(l.discountPercent)}% off)</span> : ""}</div>)}</td>
                  <td>{next ? <>{fmtDate(next)}{!r.lastRunDate && <div style={{ marginTop: 4 }}><Pill tone="info">First one</Pill></div>}{next < today && <div style={{ marginTop: 4 }}><Pill tone="warn">Overdue run</Pill></div>}</> : <Pill tone="plain">Paused</Pill>}</td>
                  <td className="r num strong">{rand(r.totalCents)}{r.taxCents > 0 && <div className="cell-sub">incl. VAT</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
