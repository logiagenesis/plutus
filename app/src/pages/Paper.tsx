import { data, customersById, fmtDate, type Snapshot, type CompanySnapshot } from "../data";
import { rand } from "../money";

export type PaperLine = { description: string; comments?: string | null; quantity: string; unitPriceExclCents: number; discountPercent: string; taxRate: string; exclusiveCents: number; taxCents: number; totalCents: number };
type Props = {
  kind: "invoice" | "quote"; number: string; date: string; dueDate?: string | null; reference?: string | null;
  customerSageId: number | null; customerName?: string; lines: PaperLine[];
  exclusiveCents: number; taxCents: number; totalCents: number; discountCents: number; message?: string | null; draft?: boolean;
  /** Frozen at issue time. When present, the document shows exactly what was issued, even if the customer or company was edited later. */
  customerSnapshot?: Snapshot | null; companySnapshot?: CompanySnapshot | null;
};

const q = (s: string) => (Number(s) % 1 === 0 ? String(Number(s)) : s);

export default function Paper(p: Props) {
  const live = data.companies.find((c) => c.id === data.companyId) ?? data.companies[0];
  const co = p.companySnapshot ?? live;
  const cur = p.customerSageId ? customersById.get(p.customerSageId) : undefined;
  const s = p.customerSnapshot;
  const c = s ? { name: s.name, contactName: s.contact, vatNumber: s.vat, postalAddress: s.postal, deliveryAddress: s.delivery } : cur;
  const addr = c?.postalAddress ?? c?.deliveryAddress ?? [];
  const anyDiscount = p.lines.some((l) => Number(l.discountPercent) > 0);
  return (
    <article className="paper" aria-label={`${p.kind === "invoice" ? "Invoice" : "Quote"} preview`}>
      <div className="p-top">
        <div>
          <div className="p-co">{co.displayName}</div>
          <div className="p-muted">{(co.address ?? []).join(", ")}</div>
          <div className="p-muted">Reg. {co.registrationNumber} · {co.email}</div>
        </div>
        <div>
          <div className="p-title">{p.kind === "invoice" ? (p.taxCents > 0 ? "Tax Invoice" : "Invoice") : "Quotation"}</div>
          <div className="p-muted" style={{ textAlign: "right" }}>{p.draft ? "Draft" : p.number}</div>
        </div>
      </div>
      <div className="p-top" style={{ marginTop: 22 }}>
        <div style={{ minWidth: 0 }}>
          <div className="p-muted" style={{ fontSize: 10.5, fontWeight: 600 }}>Bill to</div>
          <div style={{ fontWeight: 600 }}>{c?.name ?? p.customerName ?? "Choose a customer"}</div>
          {c?.contactName && c.contactName !== c.name && <div>{c.contactName}</div>}
          {addr.map((a) => <div key={a} className="p-muted">{a}</div>)}
          {c?.vatNumber && <div className="p-muted">VAT {c.vatNumber}</div>}
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div><span className="p-muted">Date </span>{fmtDate(p.date)}</div>
          {p.kind === "invoice" && <div><span className="p-muted">Due </span>{fmtDate(p.dueDate)}</div>}
          {p.kind === "quote" && p.dueDate && <div><span className="p-muted">Valid until </span>{fmtDate(p.dueDate)}</div>}
          {p.reference && <div><span className="p-muted">Ref </span>{p.reference}</div>}
        </div>
      </div>
      <table>
        <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Price</th>{anyDiscount && <th className="r">Disc.</th>}<th className="r">Amount</th></tr></thead>
        <tbody>
          {p.lines.length === 0 && <tr><td colSpan={5} className="p-muted">No lines yet</td></tr>}
          {p.lines.map((l, i) => (
            <tr key={i}>
              <td><div style={{ fontWeight: 600 }}>{l.description || "—"}</div>{l.comments && <div className="p-muted" style={{ whiteSpace: "pre-line" }}>{l.comments}</div>}</td>
              <td className="r num">{q(l.quantity)}</td>
              <td className="r num">{rand(l.unitPriceExclCents)}</td>
              {anyDiscount && <td className="r num">{Number(l.discountPercent) ? `${q(l.discountPercent)}%` : ""}</td>}
              <td className="r num">{rand(l.exclusiveCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="p-tot num">
        <span className="p-muted">Subtotal</span><span className="r">{rand(p.exclusiveCents)}</span>
        <span className="p-muted">VAT</span><span className="r">{rand(p.taxCents)}</span>
        <span className="p-grand">Total</span><span className="p-grand r">{rand(p.totalCents)}</span>
      </div>
      {p.message && <div className="p-msg">{p.message}</div>}
    </article>
  );
}
