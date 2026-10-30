import { useState, useEffect } from "react";
import { data, customerName, fmtDate, nextRun, todayISO, api, loadData } from "../data";
import { rand } from "../money";
import { I, Pill } from "../ui";
import { go, useApp } from "../App";

type PreviewResult = {
  period: string;
  runDate: string;
  companyId: string;
  totalTemplates: number;
  dueCount: number;
  alreadyRunCount: number;
  projectedTotalCents: number;
  items: Array<{
    templateId: number;
    customerName: string;
    customerEmail: string | null;
    reference: string | null;
    totalCents: number;
    alreadyRun: boolean;
    invoiceNumber: string | null;
  }>;
};

export default function RecurringPage() {
  const { notify } = useApp();
  const today = todayISO();
  const rows = data.recurring.map((r) => ({ r, next: nextRun(r) })).sort((a, b) => (a.next ?? "9").localeCompare(b.next ?? "9") || customerName(a.r.customerSageId).localeCompare(customerName(b.r.customerSageId)));
  const monthly = data.recurring.filter((r) => r.active && r.frequency === "monthly").reduce((a, r) => a + r.totalCents, 0);
  const annual = data.recurring.filter((r) => r.active && r.frequency === "annually").reduce((a, r) => a + r.totalCents, 0);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api<PreviewResult>(`recurring/preview?company=${encodeURIComponent(data.companyId)}`)
      .then(setPreview)
      .catch((e) => console.warn("Could not load recurring preview", e));
  }, []);

  async function executeBatch() {
    setRunning(true);
    setMsg(null);
    try {
      const res = await api<any>("recurring/run", {
        method: "POST",
        body: { companyId: data.companyId },
      });
      await loadData(data.companyId);
      const updatedPreview = await api<PreviewResult>(`recurring/preview?company=${encodeURIComponent(data.companyId)}`);
      setPreview(updatedPreview);
      notify(`Generated ${res.generatedCount} recurring invoices (${rand(res.totalCents)})`);
      setMsg(`Batch complete: Generated ${res.generatedCount} invoices. ${res.skippedCount} already existed.`);
      setConfirmRun(false);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Recurring invoices</h1>
          <p className="sub">Automated monthly billing engine. Cloudflare cron runs on the 25th of every month.</p>
        </div>
        {preview && preview.dueCount > 0 && (
          <div className="toolbar">
            {!confirmRun ? (
              <button className="btn primary" onClick={() => setConfirmRun(true)}>
                <I.repeat />Run {preview.dueCount} invoices now ({rand(preview.projectedTotalCents)})
              </button>
            ) : (
              <div className="toolbar">
                <button className="btn primary" onClick={executeBatch} disabled={running}>
                  {running ? "Generating invoices…" : `Confirm: Generate ${preview.dueCount} invoices`}
                </button>
                <button className="btn ghost" onClick={() => setConfirmRun(false)} disabled={running}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {msg && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <I.info />
          <div><strong>Recurring Batch Status</strong><p>{msg}</p></div>
        </div>
      )}

      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}>
          <div className="tile-label"><I.repeat />Monthly run total</div>
          <div className="tile-value num">{rand(monthly)}</div>
          <div className="muted">{data.recurring.filter((r) => r.active && r.frequency === "monthly").length} invoices to {new Set(data.recurring.filter((r) => r.active && r.frequency === "monthly").map((r) => r.customerSageId)).size} customers</div>
        </div>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}>
          <div className="tile-label"><I.repeat />Upcoming 25th Batch</div>
          <div className="tile-value num">{preview ? rand(preview.projectedTotalCents) : rand(monthly)}</div>
          <div className="muted">{preview ? `${preview.dueCount} due to generate · ${preview.alreadyRunCount} already generated for ${preview.period}` : "Schedule: 25th at 08:00 SAST"}</div>
        </div>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}>
          <div className="tile-label"><I.repeat />Annual schedules</div>
          <div className="tile-value num">{rand(annual)}</div>
          <div className="muted">{data.recurring.filter((r) => r.active && r.frequency === "annually").length} annual template</div>
        </div>
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
