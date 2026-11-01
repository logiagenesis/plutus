import { useState, useEffect, useMemo } from "react";
import { data, customersById, itemsById, customerName, fmtDate, nextRun, todayISO, api, type Recurring, type Customer, type Item } from "../data";
import { calcDocument, rand } from "../money";
import { I, Pill } from "../ui";
import { go, useApp } from "../App";
import { Combo, blank, centsToStr, fromDocLines, okDisc, okQty, parsePrice, type EditLine } from "./Editor";

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
    frequency?: string;
    totalCents: number;
    alreadyRun: boolean;
    invoiceNumber: string | null;
  }>;
};

export default function RecurringPage() {
  const { notify, reload, companyId, rev } = useApp();
  const today = todayISO();
  const rows = data.recurring
    .map((r) => ({ r, next: nextRun(r) }))
    .sort((a, b) => (a.next ?? "9").localeCompare(b.next ?? "9") || customerName(a.r.customerSageId).localeCompare(customerName(b.r.customerSageId)));
  const monthly = data.recurring.filter((r) => r.active && r.frequency === "monthly").reduce((a, r) => a + r.totalCents, 0);
  const annual = data.recurring.filter((r) => r.active && r.frequency === "annually").reduce((a, r) => a + r.totalCents, 0);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editingTpl, setEditingTpl] = useState<Recurring | "new" | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    api<PreviewResult>(`recurring/preview?company=${encodeURIComponent(companyId)}`)
      .then(setPreview)
      .catch((e) => console.warn("Could not load recurring preview", e));
  }, [companyId, rev]);

  async function executeBatch() {
    setRunning(true);
    setMsg(null);
    try {
      const res = await api<any>("recurring/run", {
        method: "POST",
        body: { companyId },
      });
      await reload();
      const updatedPreview = await api<PreviewResult>(`recurring/preview?company=${encodeURIComponent(companyId)}`);
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

  async function handleToggle(r: Recurring) {
    setTogglingId(r.sageId);
    try {
      await api(`recurring/${r.sageId}/toggle`, { method: "POST", body: { active: !r.active } });
      await reload();
      notify(`${customerName(r.customerSageId)} recurring schedule ${!r.active ? "resumed" : "paused"}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingId(null);
    }
  }

  if (editingTpl) {
    return (
      <RecurringEditor
        tpl={editingTpl === "new" ? null : editingTpl}
        onClose={() => setEditingTpl(null)}
        onSaved={async (summary) => {
          setEditingTpl(null);
          await reload();
          notify(summary);
        }}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Recurring invoices</h1>
          <p className="sub">Automated monthly &amp; annual billing engine. Scheduled run on the 25th of every month.</p>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={() => setEditingTpl("new")}>
            <I.plus />New recurring invoice
          </button>
          {preview && preview.dueCount > 0 && (
            !confirmRun ? (
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
            )
          )}
        </div>
      </div>

      {msg && (
        <div className="notice info" style={{ marginBottom: 16 }}>
          <I.info />
          <div><strong>Recurring Status</strong><p>{msg}</p></div>
        </div>
      )}

      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}>
          <div className="tile-label"><I.repeat />Monthly run total</div>
          <div className="tile-value num">{rand(monthly)}</div>
          <div className="muted">{data.recurring.filter((r) => r.active && r.frequency === "monthly").length} active monthly templates across {new Set(data.recurring.filter((r) => r.active && r.frequency === "monthly").map((r) => r.customerSageId)).size} customers</div>
        </div>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}>
          <div className="tile-label"><I.repeat />Upcoming 25th Batch</div>
          <div className="tile-value num">{preview ? rand(preview.projectedTotalCents) : rand(monthly)}</div>
          <div className="muted">{preview ? `${preview.dueCount} due to generate · ${preview.alreadyRunCount} already generated for ${preview.period}` : "Schedule: 25th at 08:00 SAST"}</div>
        </div>
        <div className="glass tile span-4 tile-pad" style={{ minHeight: 0 }}>
          <div className="tile-label"><I.repeat />Annual schedules</div>
          <div className="tile-value num">{rand(annual)}</div>
          <div className="muted">{data.recurring.filter((r) => r.active && r.frequency === "annually").length} active annual template{data.recurring.filter((r) => r.active && r.frequency === "annually").length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <section className="glass panel">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Customer</th>
                <th className="hide-sm">What’s billed</th>
                <th>Next invoice</th>
                <th className="r">Amount</th>
                <th className="r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, next }) => (
                <tr key={r.sageId} className="row" onClick={() => setEditingTpl(r)} style={{ cursor: "pointer" }}>
                  <td>
                    <div className="strong">
                      <a href={`#/customers/${r.customerSageId}`} onClick={(e) => { e.stopPropagation(); go(`/customers/${r.customerSageId}`); }} style={{ color: "inherit", textDecoration: "none" }}>
                        {customerName(r.customerSageId)}
                      </a>
                    </div>
                    <div className="cell-sub">{r.number} · {r.frequency === "annually" ? "Every year" : "Every month"} · since {fmtDate(r.startDate)}</div>
                  </td>
                  <td className="hide-sm">
                    {r.lines.map((l, i) => (
                      <div key={i}>
                        {Number(l.quantity) !== 1 ? `${Number(l.quantity)} × ` : ""}{l.description}
                        {Number(l.discountPercent) ? <span className="faint"> ({Number(l.discountPercent)}% off)</span> : ""}
                      </div>
                    ))}
                  </td>
                  <td>
                    {next ? (
                      <>
                        {fmtDate(next)}
                        {!r.lastRunDate && <div style={{ marginTop: 4 }}><Pill tone="info">First one</Pill></div>}
                        {next < today && <div style={{ marginTop: 4 }}><Pill tone="warn">Overdue run</Pill></div>}
                      </>
                    ) : (
                      <Pill tone="plain">Paused</Pill>
                    )}
                  </td>
                  <td className="r num strong">
                    {rand(r.totalCents)}
                    {r.taxCents > 0 && <div className="cell-sub">incl. VAT</div>}
                  </td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <div className="toolbar" style={{ justifyContent: "flex-end", gap: 6 }}>
                      <button className="btn small" onClick={() => setEditingTpl(r)}>Edit</button>
                      <button className="btn ghost small" onClick={() => handleToggle(r)} disabled={togglingId === r.sageId}>
                        {r.active ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RecurringEditor({ tpl, onClose, onSaved }: { tpl: Recurring | null; onClose: () => void; onSaved: (msg: string) => Promise<void> }) {
  const { companyId } = useApp();
  const today = todayISO();
  const defaultStart = `${today.slice(0, 7)}-25`;

  const [customerId, setCustomerId] = useState<number | null>(tpl?.customerSageId ?? null);
  const [frequency, setFrequency] = useState<"monthly" | "annually">((tpl?.frequency as "monthly" | "annually") || "monthly");
  const [startDate, setStartDate] = useState(tpl?.startDate ?? defaultStart);
  const [active, setActive] = useState(tpl ? tpl.active : true);
  const [reference, setReference] = useState(tpl?.reference ?? "");
  const [vat, setVat] = useState(tpl ? tpl.taxCents > 0 : false);
  const [lines, setLines] = useState<EditLine[]>(() => (tpl && tpl.lines.length ? fromDocLines(tpl) : [blank()]));
  const [message, setMessage] = useState(tpl?.message ?? data.invoiceMessage ?? "");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const customer = customerId ? customersById.get(customerId) : undefined;
  const items = useMemo(() => data.items.filter((i) => i.active).sort((a, b) => a.description.localeCompare(b.description)), []);
  const customers = useMemo(() => data.customers.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name)), []);

  const valid = lines.map((l) => ({ q: okQty(l.quantity), p: parsePrice(l.price) !== null && l.price.trim() !== "", d: okDisc(l.discount), desc: l.description.trim() !== "" }));
  const calcInput = lines.map((l, i) => ({
    quantity: valid[i].q ? l.quantity.trim() : "0",
    unitPriceExclCents: parsePrice(l.price) ?? 0,
    discountPercent: valid[i].d ? l.discount.trim() : "0",
    taxRate: vat ? "0.15" : "0",
  }));
  const totals = calcDocument(calcInput);
  const ready = !!customer && lines.length > 0 && valid.every((v) => v.q && v.p && v.d && v.desc);

  const set = (key: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, it: Item) => set(key, { itemSageId: it.sageId, description: it.description, price: centsToStr(it.priceExclCents) });
  const bad = (ok: boolean) => (tried && !ok ? "true" : undefined);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    setErr(null);
    if (!ready) return;

    setSaving(true);
    try {
      const body = {
        companyId,
        customerId: customer!.sageId,
        frequency,
        startDate,
        active,
        reference: reference.trim() || null,
        message: message.trim() || null,
        vat,
        lines: lines.map((l, i) => ({
          itemId: l.itemSageId,
          description: l.description.trim(),
          comments: l.comments.trim() || null,
          unit: l.itemSageId ? itemsById.get(l.itemSageId)?.unit ?? null : null,
          quantity: calcInput[i].quantity,
          unitPriceExclCents: calcInput[i].unitPriceExclCents,
          discountPercent: calcInput[i].discountPercent,
        })),
      };
      const res = await api<{ id: number; number: string }>(tpl ? `recurring/${tpl.sageId}` : "recurring", {
        method: tpl ? "PUT" : "POST",
        body,
      });
      await onSaved(`${tpl ? "Updated" : "Created"} recurring template ${res.number ?? ""} · ${rand(totals.totalCents)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  async function remove() {
    if (!tpl) return;
    if (!confirm(`Delete recurring template ${tpl.number} for ${customerName(tpl.customerSageId)}? Past invoices generated from it will not be affected.`)) return;
    setDeleting(true);
    setErr(null);
    try {
      await api(`recurring/${tpl.sageId}`, { method: "DELETE" });
      await onSaved(`Deleted recurring template ${tpl.number}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      <button type="button" className="crumb" onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }}>
        <I.back />Recurring invoices
      </button>
      <div className="page-head">
        <div>
          <h1>{tpl ? `Edit recurring ${tpl.number}` : "New recurring invoice"}</h1>
          <p className="sub">{tpl ? `${customerName(tpl.customerSageId)} · last run ${fmtDate(tpl.lastRunDate)}` : "Set up an automated monthly or annual billing schedule"}</p>
        </div>
      </div>

      <form className="glass editor-form" onSubmit={save} style={{ maxWidth: 880 }} noValidate>
        <div className="field">
          <span>Customer</span>
          <Combo<Customer>
            label="Customer"
            placeholder="Start typing a customer name"
            value={customer?.name ?? ""}
            items={customers}
            autoFocus={!tpl}
            getLabel={(c) => c.name}
            getSub={(c) => (c.contactName && c.contactName !== c.name ? c.contactName : "")}
            onPick={(c) => setCustomerId(c.sageId)}
            onText={() => setCustomerId(null)}
          />
          {tried && !customer && <span style={{ color: "var(--bad)", fontSize: 12.5 }}>Choose a customer from the list.</span>}
        </div>

        <div className="form-row">
          <label className="field">
            <span>Frequency</span>
            <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as "monthly" | "annually")}>
              <option value="monthly">Monthly (every 25th)</option>
              <option value="annually">Annually (once a year)</option>
            </select>
          </label>
          <label className="field">
            <span>Start / anchor date</span>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Reference <span className="faint">(optional)</span></span>
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Hosting / Retainer" />
          </label>
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
            <span>Active (include in automated 25th billing runs)</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }} className="muted">
            <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
            <span>Add VAT (15%)</span>
          </label>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <h2>Recurring lines</h2>
          <div className="lines">
            {lines.map((l, i) => (
              <div className="line" key={l.key}>
                <div className="line-desc">
                  <Combo<Item>
                    label={`Line ${i + 1} item`}
                    placeholder="Pick an item or type a description"
                    value={l.description}
                    items={items}
                    getLabel={(it) => it.description}
                    getSub={(it) => rand(it.priceExclCents)}
                    onPick={(it) => pickItem(l.key, it)}
                    onText={(s) => set(l.key, { description: s, itemSageId: null })}
                  />
                  <input className="input" aria-label={`Line ${i + 1} note`} placeholder="Note for the customer (optional)" value={l.comments} onChange={(e) => set(l.key, { comments: e.target.value })} style={{ height: 32, fontSize: 13 }} />
                  {tried && !valid[i].desc && <span style={{ color: "var(--bad)", fontSize: 12.5 }}>Add a description.</span>}
                </div>
                <label><span className="mlabel">Qty</span><input className="input num r" inputMode="decimal" aria-invalid={bad(valid[i].q)} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} /></label>
                <label><span className="mlabel">Price (excl.)</span><input className="input num r" inputMode="decimal" aria-invalid={bad(valid[i].p)} placeholder="0.00" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} /></label>
                <label><span className="mlabel">Disc. %</span><input className="input num r" inputMode="decimal" aria-invalid={bad(valid[i].d)} value={l.discount} onChange={(e) => set(l.key, { discount: e.target.value })} /></label>
                <div className="amt-cell"><div className="amt num">{rand(totals.lines[i].exclusiveCents)}</div></div>
                <button type="button" className="icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()]))}><I.trash /></button>
              </div>
            ))}
          </div>
          <div><button type="button" className="btn small" onClick={() => setLines((ls) => [...ls, blank()])}><I.plus />Add a line</button></div>
        </div>

        <div className="totals num">
          <span className="muted">Subtotal</span><span className="r">{rand(totals.exclusiveCents)}</span>
          <span className="muted">VAT {vat ? "15%" : ""}</span><span className="r">{rand(totals.taxCents)}</span>
          <span className="grand">Recurring Total</span><span className="grand r">{rand(totals.totalCents)}</span>
        </div>

        <label className="field">
          <span>Message on generated invoices</span>
          <textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        {err && <p className="auth-err" role="alert">{err}</p>}

        <div className="savebar glass">
          <div className="toolbar">
            {tpl && (
              <button type="button" className="btn ghost" onClick={remove} disabled={saving || deleting}>
                <I.trash />{deleting ? "Deleting…" : "Delete template"}
              </button>
            )}
          </div>
          <div className="toolbar">
            <button type="button" className="btn ghost" onClick={onClose} disabled={saving || deleting}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving || deleting}>
              <I.check />{saving ? "Saving…" : tpl ? "Save changes" : "Create recurring template"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
