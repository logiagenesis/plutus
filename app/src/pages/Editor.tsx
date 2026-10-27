import { useEffect, useId, useMemo, useRef, useState } from "react";
import { data, invoices, customersById, itemsById, nextNumber, todayISO, fmtDate, api, mapDoc, type Customer, type Item, type Doc } from "../data";
import { calcDocument, rand } from "../money";
import { I } from "../ui";
import { go, routeQuery, useApp } from "../App";
import Paper from "./Paper";

type Kind = "invoice" | "quote";
type EditLine = { key: number; itemSageId: number | null; description: string; comments: string; quantity: string; price: string; discount: string };

let seq = 1;
const blank = (): EditLine => ({ key: seq++, itemSageId: null, description: "", comments: "", quantity: "1", price: "", discount: "0" });
const endOfMonth = (iso: string) => { const [y, m] = iso.split("-").map(Number); return `${y}-${String(m).padStart(2, "0")}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`; };
const centsToStr = (c: number) => (c / 100).toFixed(2);
// Price input → cents. Accepts "1500", "1 500", "1,500.50", "R1500".
function parsePrice(s: string): number | null {
  const t = s.replace(/[R\s,]/gi, "");
  if (t === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}
const okQty = (s: string) => /^\d+(\.\d{1,4})?$/.test(s.trim()) && Number(s) > 0;
const okDisc = (s: string) => /^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) <= 100;
const fromDocLines = (d: Doc): EditLine[] => d.lines.map((l) => ({ key: seq++, itemSageId: l.itemSageId, description: l.description, comments: l.comments ?? "", quantity: l.quantity, price: centsToStr(l.unitPriceExclCents), discount: String(Number(l.discountPercent)) }));

// ── Search-as-you-type picker (customers and items) ──
function Combo<T>({ label, placeholder, value, items, getLabel, getSub, onPick, onText, autoFocus }: {
  label: string; placeholder: string; value: string; items: T[]; getLabel: (t: T) => string; getSub?: (t: T) => string;
  onPick: (t: T) => void; onText?: (s: string) => void; autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [hi, setHi] = useState(0);
  const id = useId();
  useEffect(() => setText(value), [value]);
  const matches = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (s ? items.filter((t) => getLabel(t).toLowerCase().includes(s) || (getSub?.(t) ?? "").toLowerCase().includes(s)) : items).slice(0, 40);
  }, [text, items, getLabel, getSub]);
  const pick = (t: T) => { onPick(t); setText(getLabel(t)); setOpen(false); };
  return (
    <div className="combo">
      <input className="input" role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-autocomplete="list" placeholder={placeholder}
        value={text} autoFocus={autoFocus}
        onChange={(e) => { setText(e.target.value); onText?.(e.target.value); setOpen(true); setHi(0); }}
        onClick={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && matches.length > 0 && (
        <div className="combo-list glass" id={id} role="listbox">
          {matches.map((t, i) => (
            <button type="button" role="option" aria-selected={i === hi} key={i} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t)}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getLabel(t)}</span>
              {getSub && <span className="faint num" style={{ whiteSpace: "nowrap" }}>{getSub(t)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Editor({ kind, editId }: { kind: Kind; editId?: number }) {
  const fromId = routeQuery().get("from");
  const [st, setSt] = useState<{ source: Doc | null; editing: Doc | null } | string | null>(null);
  useEffect(() => {
    let live = true;
    const id = editId ?? (fromId ? Number(fromId) : null);
    if (!id) { setSt({ source: null, editing: null }); return; }
    api<any>(`documents/${id}`).then((d) => { if (!live) return; const m = mapDoc(d); setSt(editId ? { source: null, editing: m } : { source: m, editing: null }); })
      .catch((e) => live && setSt(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [editId, fromId]);
  const back = <a className="crumb" href={`#/${kind === "invoice" ? "invoices" : "quotes"}`}><I.back />{kind === "invoice" ? "Invoices" : "Quotes"}</a>;
  if (st === null) return <div className="page">{back}<div className="skel" style={{ width: 260, height: 34 }} /><div className="skel" style={{ height: 420, marginTop: 22 }} /></div>;
  if (typeof st === "string") return <div className="page">{back}<div className="notice"><I.alert /><div><strong>Couldn’t open that document</strong><p>{st}</p></div></div></div>;
  if (st.editing && st.editing.status !== "draft") return <div className="page">{back}<div className="notice"><I.alert /><div><strong>This document is issued</strong><p>Issued documents are locked. Use Copy to start a new one from it.</p></div></div></div>;
  return <EditorForm kind={kind} source={st.source} editing={st.editing} />;
}

function EditorForm({ kind, source, editing }: { kind: Kind; source: Doc | null; editing: Doc | null }) {
  const { reload, notify } = useApp();
  const today = todayISO();
  const init = editing ?? source;
  const [customerId, setCustomerId] = useState<number | null>(init?.customerSageId ?? null);
  const [date, setDate] = useState(editing?.date ?? today);
  const [due, setDue] = useState(editing?.dueDate ?? endOfMonth(today));
  const [reference, setReference] = useState(init?.reference ?? "");
  const [vat, setVat] = useState(init ? init.taxCents > 0 || !!init.vat : false);
  const [lines, setLines] = useState<EditLine[]>(() => (init && init.lines.length ? fromDocLines(init) : [blank()]));
  const [message, setMessage] = useState(editing ? editing.message ?? "" : kind === "invoice" ? data.invoiceMessage ?? "" : "");
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const firstRef = useRef<HTMLFormElement>(null);

  const customer = customerId ? customersById.get(customerId) : undefined;
  const lastForCustomer = useMemo(() => customerId ? invoices.find((d) => d.customerSageId === customerId && d.status === "issued") : undefined, [customerId]);
  const items = useMemo(() => data.items.filter((i) => i.active).sort((a, b) => a.description.localeCompare(b.description)), []);
  const customers = useMemo(() => data.customers.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name)), []);

  const valid = lines.map((l) => ({ q: okQty(l.quantity), p: parsePrice(l.price) !== null && l.price.trim() !== "", d: okDisc(l.discount), desc: l.description.trim() !== "" }));
  const calcInput = lines.map((l, i) => ({
    quantity: valid[i].q ? l.quantity.trim() : "0", unitPriceExclCents: parsePrice(l.price) ?? 0,
    discountPercent: valid[i].d ? l.discount.trim() : "0", taxRate: vat ? "0.15" : "0",
  }));
  const totals = calcDocument(calcInput);
  const ready = !!customer && lines.length > 0 && valid.every((v) => v.q && v.p && v.d && v.desc);

  const set = (key: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: number, it: Item) => set(key, { itemSageId: it.sageId, description: it.description, price: centsToStr(it.priceExclCents) });

  async function copyLast() {
    if (!lastForCustomer) return;
    setCopying(true);
    try { const d = mapDoc(await api<any>(`documents/${lastForCustomer.sageId}`)); setLines(fromDocLines(d)); setVat(d.taxCents > 0); }
    catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); }
    finally { setCopying(false); }
  }

  async function save() {
    setTried(true); setSaveErr(null);
    if (!ready) { firstRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(); return; }
    const body = {
      companyId: data.companyId, kind, customerId: customer!.sageId, date, dueDate: due || null, reference: reference || null, message: message || null, vat,
      fromDocumentId: source?.sageId ?? null, version: editing?.version,
      lines: lines.map((l, i) => ({ itemId: l.itemSageId, description: l.description.trim(), comments: l.comments.trim() || null, unit: l.itemSageId ? itemsById.get(l.itemSageId)?.unit ?? null : null,
        quantity: calcInput[i].quantity, unitPriceExclCents: calcInput[i].unitPriceExclCents, discountPercent: calcInput[i].discountPercent })),
    };
    setSaving(true);
    try {
      const saved = await api<any>(editing ? `documents/${editing.sageId}` : "documents", { method: editing ? "PUT" : "POST", body });
      if (saved.total_cents !== totals.totalCents) console.warn("Server total differs from screen total", saved.total_cents, totals.totalCents);
      await reload();
      notify(`Draft ${kind === "invoice" ? "invoice" : "quote"} saved · ${rand(saved.total_cents)}`);
      go(`/${kind === "invoice" ? "invoices" : "quotes"}/${saved.id}`, true);
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); setSaving(false); }
  }

  const number = nextNumber(kind);
  const label = kind === "invoice" ? "invoice" : "quote";
  const bad = (ok: boolean) => (tried && !ok ? "true" : undefined);

  return (
    <div className="page">
      <a className="crumb" href={`#/${kind === "invoice" ? "invoices" : "quotes"}`}><I.back />{kind === "invoice" ? "Invoices" : "Quotes"}</a>
      <div className="page-head">
        <div><h1>{editing ? `Edit draft ${label}` : `New ${label}`}</h1><p className="sub">{source ? `Copied from ${source.number} · ` : ""}Gets number {number} when you issue it</p></div>
      </div>
      <div className="seg preview-tabs" role="group" aria-label="View">
        <button aria-pressed={view === "edit"} onClick={() => setView("edit")}>Edit</button>
        <button aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</button>
      </div>

      <div className="editor" data-view={view}>
        <form className="glass editor-form" onSubmit={(e) => { e.preventDefault(); save(); }} ref={firstRef} noValidate>
          <div className="field">
            <span>Customer</span>
            <Combo<Customer> label="Customer" placeholder="Start typing a customer name" value={customer?.name ?? ""} items={customers} autoFocus={!source}
              getLabel={(c) => c.name} getSub={(c) => c.contactName && c.contactName !== c.name ? c.contactName : ""}
              onPick={(c) => setCustomerId(c.sageId)} onText={() => setCustomerId(null)} />
            {tried && !customer && <span style={{ color: "var(--bad)", fontSize: 12.5 }}>Choose a customer from the list.</span>}
            {customer && (
              <div className="muted" style={{ fontSize: 13, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <span>{customer.email ?? "No email on file"}</span>
                {lastForCustomer && lines.length === 1 && !lines[0].description && (
                  <button type="button" className="btn small" onClick={copyLast} disabled={copying}>
                    <I.copy />{copying ? "Copying…" : `Use lines from ${lastForCustomer.number}`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="form-row">
            <label className="field"><span>{kind === "invoice" ? "Invoice date" : "Quote date"}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="field"><span>{kind === "invoice" ? "Due date" : "Valid until"}</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="field"><span>Reference <span className="faint">(optional)</span></span><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO number" /></label>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h2>What you’re charging for</h2>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }} className="muted">
                <input type="checkbox" checked={vat} onChange={(e) => setVat(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                Add VAT (15%)
              </label>
            </div>
            <div className="lines">
              {lines.map((l, i) => (
                <div className="line" key={l.key}>
                  <div className="line-desc">
                    <Combo<Item> label={`Line ${i + 1} item`} placeholder="Pick an item or type a description" value={l.description} items={items}
                      getLabel={(it) => it.description} getSub={(it) => rand(it.priceExclCents)}
                      onPick={(it) => pickItem(l.key, it)} onText={(s) => set(l.key, { description: s, itemSageId: null })} />
                    <input className="input" aria-label={`Line ${i + 1} note`} placeholder="Note for the customer (optional)" value={l.comments} onChange={(e) => set(l.key, { comments: e.target.value })} style={{ height: 32, fontSize: 13 }} />
                    {tried && !valid[i].desc && <span style={{ color: "var(--bad)", fontSize: 12.5 }}>Add a description.</span>}
                  </div>
                  <label><span className="mlabel">Qty</span><input className="input num r" inputMode="decimal" aria-label={`Line ${i + 1} quantity`} aria-invalid={bad(valid[i].q)} value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} /></label>
                  <label><span className="mlabel">Price (excl.)</span><input className="input num r" inputMode="decimal" aria-label={`Line ${i + 1} price excluding VAT`} aria-invalid={bad(valid[i].p)} placeholder="0.00" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} /></label>
                  <label><span className="mlabel">Disc. %</span><input className="input num r" inputMode="decimal" aria-label={`Line ${i + 1} discount percent`} aria-invalid={bad(valid[i].d)} value={l.discount} onChange={(e) => set(l.key, { discount: e.target.value })} /></label>
                  <div className="amt-cell"><div className="amt num" aria-label={`Line ${i + 1} amount`}>{rand(totals.lines[i].exclusiveCents)}{totals.lines[i].discountCents > 0 && <small>after {rand(totals.lines[i].discountCents)} discount</small>}</div></div>
                  <button type="button" className="icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [blank()])}><I.trash /></button>
                </div>
              ))}
            </div>
            <div><button type="button" className="btn small" onClick={() => setLines((ls) => [...ls, blank()])}><I.plus />Add a line</button></div>
          </div>

          <div className="totals num" aria-live="polite">
            <span className="muted">Subtotal</span><span className="r">{rand(totals.exclusiveCents)}</span>
            {totals.discountCents > 0 && <><span className="muted">Includes discount</span><span className="r muted">−{rand(totals.discountCents)}</span></>}
            <span className="muted">VAT {vat ? "15%" : ""}</span><span className="r">{rand(totals.taxCents)}</span>
            <span className="grand">Total</span><span className="grand r">{rand(totals.totalCents)}</span>
          </div>

          <label className="field"><span>Message on the {label}</span><textarea className="input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Payment details, thank-you note…" /></label>

          <div className="savebar glass">
            <span className="muted" style={{ fontSize: 13 }} role="status">{saveErr ? <span className="err">{saveErr}</span> : ready ? `Ready · ${rand(totals.totalCents)} to ${customer!.name}` : tried ? "Fix the highlighted fields" : "Saved drafts can be edited until you issue them"}</span>
            <div className="toolbar">
              <button type="button" className="btn ghost opt" onClick={() => go(kind === "invoice" ? "/invoices" : "/quotes")}>Cancel</button>
              <button type="button" className="btn opt" disabled title="Sending switches on once your email sender is set up">Email to customer</button>
              <button type="submit" className="btn primary" disabled={saving}><I.check />{saving ? "Saving…" : "Save draft"}</button>
            </div>
          </div>
        </form>

        <div className="paper-wrap">
          <Paper kind={kind} number="Draft" date={date} dueDate={due} reference={reference} customerSageId={customerId} draft
            lines={lines.map((l, i) => ({ description: l.description, comments: l.comments, quantity: calcInput[i].quantity, unitPriceExclCents: calcInput[i].unitPriceExclCents, discountPercent: calcInput[i].discountPercent, taxRate: calcInput[i].taxRate, ...totals.lines[i] }))}
            exclusiveCents={totals.exclusiveCents} taxCents={totals.taxCents} totalCents={totals.totalCents} discountCents={totals.discountCents} message={message} />
          <p className="faint" style={{ fontSize: 12, marginTop: 10, textAlign: "center" }}>Live preview · due {fmtDate(due)}</p>
        </div>
      </div>
    </div>
  );
}
