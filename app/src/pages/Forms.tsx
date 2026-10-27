import { useState } from "react";
import { data, customersById, itemsById, api } from "../data";
import { I, Empty } from "../ui";
import { go, useApp } from "../App";

function Field({ label, id, value, onChange, type = "text", placeholder, full, error, hint, inputMode }: {
  label: string; id: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; full?: boolean; error?: string | null; hint?: string; inputMode?: "decimal" | "email" | "tel" | "text";
}) {
  return (
    <label className={`field${full ? " full" : ""}`} htmlFor={id}>
      <span>{label}{hint && <span className="faint"> ({hint})</span>}</span>
      <input className="input" id={id} type={type} value={value} placeholder={placeholder} inputMode={inputMode} aria-invalid={error ? "true" : undefined} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="err">{error}</span>}
    </label>
  );
}

function SaveBar({ saving, err, onCancel, label }: { saving: boolean; err: string | null; onCancel: () => void; label: string }) {
  return (
    <div className="savebar glass" style={{ marginTop: 16 }}>
      <span className="muted" style={{ fontSize: 13 }} role="status">{err ? <span className="err">{err}</span> : "Changes are saved to your database"}</span>
      <div className="toolbar">
        <button type="button" className="btn ghost opt" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving}><I.check />{saving ? "Saving…" : label}</button>
      </div>
    </div>
  );
}

export function CustomerForm({ id }: { id?: number }) {
  const { reload, notify } = useApp();
  const c = id ? customersById.get(id) : undefined;
  const [f, setF] = useState(() => ({
    name: c?.name ?? "", contactName: c?.contactName ?? "", email: c?.email ?? "", mobile: c?.mobile ?? "", telephone: c?.telephone ?? "",
    vatNumber: c?.vatNumber ?? "", category: c?.category ?? "", address: (c?.postalAddress ?? c?.deliveryAddress ?? []).join("\n"), active: c?.active ?? true,
  }));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (id && !c) return <div className="page"><a className="crumb" href="#/customers"><I.back />Customers</a><Empty title="Customer not found" /></div>;
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const emailBad = f.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const cats = [...new Set(data.customers.map((x) => x.category).filter(Boolean))] as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setTried(true); setErr(null);
    if (!f.name.trim() || emailBad) return;
    setSaving(true);
    try {
      const body = { companyId: data.companyId, name: f.name, contactName: f.contactName, email: f.email, mobile: f.mobile, telephone: f.telephone, vatNumber: f.vatNumber, category: f.category,
        postalAddress: f.address.split("\n").map((s) => s.trim()).filter(Boolean), active: f.active, version: c?.version };
      const saved = await api<any>(id ? `customers/${id}` : "customers", { method: id ? "PUT" : "POST", body });
      await reload(); notify(id ? "Customer updated" : "Customer added"); go(`/customers/${saved.id}`, true);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setSaving(false); }
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <a className="crumb" href={id ? `#/customers/${id}` : "#/customers"}><I.back />{id ? c!.name : "Customers"}</a>
      <div className="page-head"><div><h1>{id ? "Edit customer" : "Add a customer"}</h1><p className="sub">Only the name is required.</p></div></div>
      <form onSubmit={submit} noValidate>
        <section className="glass">
          <div className="form-grid">
            <Field full label="Customer or company name" id="c-name" value={f.name} onChange={set("name")} error={tried && !f.name.trim() ? "Add a name." : null} />
            <Field label="Contact person" id="c-contact" value={f.contactName} onChange={set("contactName")} />
            <Field label="Email" id="c-email" type="email" inputMode="email" value={f.email} onChange={set("email")} hint="invoices go here" error={tried && emailBad ? "That email address doesn’t look right." : null} />
            <Field label="Mobile" id="c-mobile" inputMode="tel" value={f.mobile} onChange={set("mobile")} />
            <Field label="Telephone" id="c-tel" inputMode="tel" value={f.telephone} onChange={set("telephone")} />
            <Field label="VAT number" id="c-vat" value={f.vatNumber} onChange={set("vatNumber")} hint="if they have one" />
            <label className="field" htmlFor="c-cat"><span>Category</span>
              <input className="input" id="c-cat" list="c-cats" value={f.category} onChange={(e) => set("category")(e.target.value)} />
              <datalist id="c-cats">{cats.map((x) => <option key={x} value={x} />)}</datalist>
            </label>
            <label className="field full" htmlFor="c-addr"><span>Address <span className="faint">(one line per row)</span></span>
              <textarea className="input" id="c-addr" rows={4} value={f.address} onChange={(e) => set("address")(e.target.value)} />
            </label>
            {id && <label className="full" style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-2)" }}>
              <input type="checkbox" id="c-active" checked={f.active} onChange={(e) => set("active")(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
              Active (show this customer when creating invoices)
            </label>}
          </div>
        </section>
        <SaveBar saving={saving} err={err} onCancel={() => go(id ? `/customers/${id}` : "/customers")} label={id ? "Save changes" : "Add customer"} />
      </form>
    </div>
  );
}

export function ItemForm({ id }: { id?: number }) {
  const { reload, notify } = useApp();
  const it = id ? itemsById.get(id) : undefined;
  const [f, setF] = useState(() => ({ description: it?.description ?? "", code: it?.code ?? "", category: it?.category ?? "", unit: it?.unit ?? "", price: it ? (it.priceExclCents / 100).toFixed(2) : "", active: it?.active ?? true }));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (id && !it) return <div className="page"><a className="crumb" href="#/items"><I.back />Items</a><Empty title="Item not found" /></div>;
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const t = f.price.replace(/[R\s,]/gi, "");
  const priceOk = /^\d+(\.\d{1,2})?$/.test(t);
  const cents = priceOk ? Number(t.split(".")[0]) * 100 + Number(((t.split(".")[1] ?? "") + "00").slice(0, 2)) : 0;
  const cats = [...new Set(data.items.map((x) => x.category).filter(Boolean))] as string[];

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setTried(true); setErr(null);
    if (!f.description.trim() || !priceOk) return;
    setSaving(true);
    try {
      const body = { companyId: data.companyId, description: f.description, code: f.code, category: f.category, unit: f.unit, priceExclCents: cents, active: f.active, version: it?.version };
      await api<any>(id ? `items/${id}` : "items", { method: id ? "PUT" : "POST", body });
      await reload(); notify(id ? "Item updated" : "Item added"); go("/items", true);
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); setSaving(false); }
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <a className="crumb" href="#/items"><I.back />Items</a>
      <div className="page-head"><div><h1>{id ? "Edit item" : "Add an item"}</h1><p className="sub">Price changes only affect new invoices. Issued invoices keep their price.</p></div></div>
      <form onSubmit={submit} noValidate>
        <section className="glass">
          <div className="form-grid">
            <Field full label="Name on the invoice" id="i-desc" value={f.description} onChange={set("description")} error={tried && !f.description.trim() ? "Add a name." : null} />
            <Field label="Price excluding VAT" id="i-price" inputMode="decimal" value={f.price} onChange={set("price")} placeholder="0.00" error={tried && !priceOk ? "Enter an amount like 195 or 195.50." : null} />
            <Field label="Unit" id="i-unit" value={f.unit} onChange={set("unit")} hint="e.g. each, per hour, monthly" />
            <label className="field" htmlFor="i-cat"><span>Category</span>
              <input className="input" id="i-cat" list="i-cats" value={f.category} onChange={(e) => set("category")(e.target.value)} />
              <datalist id="i-cats">{cats.map((x) => <option key={x} value={x} />)}</datalist>
            </label>
            <Field label="Code" id="i-code" value={f.code} onChange={set("code")} hint="optional" />
            {id && <label className="full" style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-2)" }}>
              <input type="checkbox" id="i-active" checked={f.active} onChange={(e) => set("active")(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
              Active (show in the item list on invoices)
            </label>}
          </div>
        </section>
        <SaveBar saving={saving} err={err} onCancel={() => go("/items")} label={id ? "Save changes" : "Add item"} />
      </form>
    </div>
  );
}
