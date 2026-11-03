import { data, customersById, fmtDate, parseBankDetails, stripRedundantBankLines } from "./data";
import { rand } from "./money";
import type { PaperProps } from "./pages/Paper";

// Real PDF file (selectable text), built in the browser. No server, no print dialog.
const clean = (s: unknown) =>
  String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...")
    .replace(/[^\n\x20-\x7E -ÿ–—]/g, "?");
const q = (s: string) => (Number(s) % 1 === 0 ? String(Number(s)) : s);

export function pdfFileName(p: PaperProps, customer: string) {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${safe(p.draft ? "Draft" : p.number)}_${safe(customer || "Customer")}.pdf`;
}

export async function buildDocumentPdf(p: PaperProps) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = 595.28, H = 841.89, M = 48, R = W - M;
  const live = data.companies.find((c) => c.id === data.companyId) ?? data.companies[0];
  const co = p.companySnapshot ?? live;
  const cur = p.customerSageId ? customersById.get(p.customerSageId) : undefined;
  const s = p.customerSnapshot;
  const c = s ? { name: s.name, contactName: s.contact, vatNumber: s.vat, postalAddress: s.postal, deliveryAddress: s.delivery } : cur;
  const custName = c?.name ?? p.customerName ?? "";
  const addr = c?.postalAddress ?? c?.deliveryAddress ?? [];
  const bank = parseBankDetails(co, p.message);
  const msg = p.kind === "invoice" ? stripRedundantBankLines(p.message) : p.message;
  const title = p.kind === "invoice" ? (p.taxCents > 0 ? "Tax Invoice" : "Invoice") : p.kind === "quote" ? "Quotation" : "Credit Note";
  const anyDisc = p.lines.some((l) => Number(l.discountPercent) > 0);

  const ink: [number, number, number] = [20, 24, 33], mute: [number, number, number] = [105, 112, 125];
  const text = (t: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size ?? 10); doc.setTextColor(...(o.color ?? ink));
    doc.text(clean(t), x, y, { align: o.align ?? "left" });
  };
  const wrap = (t: string, w: number, size = 10) => { doc.setFontSize(size); return doc.splitTextToSize(clean(t), w) as string[]; };

  // Header
  let y = M + 8;
  text(co.displayName, M, y, { size: 17, bold: true });
  text(title, R, y, { size: 22, bold: true, align: "right" });
  y += 16;
  text(p.draft ? "Draft" : p.number, R, y, { size: 12, bold: true, color: mute, align: "right" });
  const head = [(co.address ?? []).join(", "),
    [co.registrationNumber ? `Reg. ${co.registrationNumber}` : "", co.email ?? "", co.telephone ? `Tel: ${co.telephone}` : ""].filter(Boolean).join("  |  "),
    co.vatNumber ? `VAT Reg. ${co.vatNumber}` : ""].filter(Boolean);
  for (const h of head) for (const l of wrap(h, 300, 9)) { text(l, M, y, { size: 9, color: mute }); y += 12; }
  y = Math.max(y, M + 50) + 16;
  doc.setDrawColor(210, 214, 222); doc.line(M, y, R, y); y += 22;

  // Bill to + dates
  const top = y;
  text(p.kind === "credit_note" ? "CREDITED TO" : "BILL TO", M, y, { size: 8.5, bold: true, color: mute }); y += 14;
  text(custName || "-", M, y, { size: 11, bold: true }); y += 14;
  if (c?.contactName && c.contactName !== c.name) { text(c.contactName, M, y); y += 13; }
  for (const a of addr) { text(a, M, y, { color: mute }); y += 12.5; }
  if (c?.vatNumber) { text(`VAT ${c.vatNumber}`, M, y, { color: mute }); y += 12.5; }
  let ry = top;
  const kv = (k: string, v: string) => { text(v, R, ry, { bold: true, align: "right" }); text(k, R - 130, ry, { color: mute, align: "right" }); ry += 15; };
  kv(p.kind === "credit_note" ? "Credit date" : p.kind === "quote" ? "Quote date" : "Invoice date", fmtDate(p.date));
  if (p.kind === "invoice") kv("Due date", fmtDate(p.dueDate));
  if (p.kind === "quote" && p.dueDate) kv("Valid until", fmtDate(p.dueDate));
  if (p.fromDocument) kv(p.kind === "credit_note" ? "Credits invoice" : "From", p.fromDocument);
  if (p.reference) kv("Reference", p.reference);
  y = Math.max(y, ry) + 18;

  // Table
  const colAmt = R, colDisc = R - 78, colPrice = anyDisc ? R - 130 : R - 80, colQty = (anyDisc ? R - 200 : R - 160), descW = colQty - M - 24;
  const header = () => {
    doc.setFillColor(240, 242, 246); doc.rect(M, y - 12, R - M, 20, "F");
    text("DESCRIPTION", M + 6, y + 1, { size: 8.5, bold: true, color: mute });
    text("QTY", colQty, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    text("PRICE", colPrice, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    if (anyDisc) text("DISC.", colDisc, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    text("AMOUNT", colAmt, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    y += 22;
  };
  header();
  for (const l of p.lines) {
    const d = wrap(l.description || "-", descW), cm = l.comments ? wrap(l.comments, descW, 9) : [];
    const h = d.length * 13 + cm.length * 11.5 + 10;
    if (y + h > H - 150) { doc.addPage(); y = M + 10; header(); }
    d.forEach((ln, i) => text(ln, M + 6, y + i * 13, { bold: true }));
    cm.forEach((ln, i) => text(ln, M + 6, y + d.length * 13 + i * 11.5, { size: 9, color: mute }));
    text(q(l.quantity), colQty, y, { align: "right" });
    text(rand(l.unitPriceExclCents), colPrice, y, { align: "right" });
    if (anyDisc) text(Number(l.discountPercent) ? `${q(l.discountPercent)}%` : "", colDisc, y, { align: "right" });
    text(rand(l.exclusiveCents), colAmt, y, { align: "right" });
    y += h; doc.setDrawColor(232, 235, 240); doc.line(M, y - 6, R, y - 6);
  }

  // Totals
  if (y + 90 > H - 150) { doc.addPage(); y = M + 10; }
  y += 8;
  const tot = (k: string, v: string, big = false) => {
    text(k, R - 150, y, { bold: big, size: big ? 12 : 10, color: big ? ink : mute }); text(v, R, y, { bold: big, size: big ? 12 : 10, align: "right" }); y += big ? 20 : 16;
  };
  tot("Subtotal", rand(p.exclusiveCents)); tot("VAT", rand(p.taxCents));
  doc.setDrawColor(...ink); doc.line(R - 150, y - 10, R, y - 10); y += 4;
  tot(p.kind === "credit_note" ? "Total Credit" : p.kind === "quote" ? "Total" : "Total Due", rand(p.totalCents), true);
  y += 10;

  // Banking details
  if (p.kind === "invoice") {
    if (y + 110 > H - M) { doc.addPage(); y = M + 10; }
    doc.setFillColor(246, 248, 251); doc.roundedRect(M, y, R - M, 100, 6, 6, "F");
    text("BANKING & EFT PAYMENT DETAILS", M + 14, y + 20, { size: 9, bold: true, color: mute });
    const ref = p.draft ? (custName || "Invoice Number") : p.number;
    const rows: [string, string][] = [["Bank", bank.bank], ["Account Name", bank.accountName], ["Account Number", bank.accountNumber], ["Account Type", bank.accountType], ["Branch Code", bank.branchCode], ["Payment Reference", ref]];
    rows.forEach(([k, v], i) => {
      const cx = M + 14 + (i % 2) * ((R - M) / 2), cy = y + 40 + Math.floor(i / 2) * 16;
      text(`${k}:`, cx, cy, { size: 9, color: mute }); text(v, cx + 92, cy, { size: 9.5, bold: true });
    });
    text(`Please email proof of payment to ${bank.proofEmail}`, M + 14, y + 92, { size: 9, color: mute });
    y += 116;
  }
  if (msg) for (const l of wrap(msg, R - M, 9.5)) { if (y > H - M) { doc.addPage(); y = M + 10; } text(l, M, y, { size: 9.5 }); y += 12.5; }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); text(`${p.draft ? "Draft" : p.number}  |  Page ${i} of ${pages}`, W / 2, H - 24, { size: 8, color: mute, align: "center" }); }
  return { doc, fileName: pdfFileName(p, custName) };
}

export async function downloadDocumentPdf(p: PaperProps) {
  const { doc, fileName } = await buildDocumentPdf(p);
  doc.save(fileName);
}
