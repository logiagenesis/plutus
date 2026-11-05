import { data, customersById, fmtDate, parseBankDetails, stripRedundantBankLines, type StatementData } from "./data";
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

export function statementPdfFileName(stmt: StatementData) {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `Statement_${safe(stmt.customer?.name || "Customer")}_${stmt.toDate}.pdf`;
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

export async function buildStatementPdf(stmt: StatementData) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = 595.28, H = 841.89, M = 48, R = W - M;
  const co = stmt.company;
  const cust = stmt.customer;
  const custName = cust?.name || "Customer";
  const addr = (cust.postal && cust.postal.length > 0 ? cust.postal : cust.delivery) ?? [];
  const bank = parseBankDetails(co);

  const ink: [number, number, number] = [20, 24, 33], mute: [number, number, number] = [105, 112, 125];
  const text = (t: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size ?? 10); doc.setTextColor(...(o.color ?? ink));
    doc.text(clean(t), x, y, { align: o.align ?? "left" });
  };
  const wrap = (t: string, w: number, size = 10) => { doc.setFontSize(size); return doc.splitTextToSize(clean(t), w) as string[]; };

  // Header
  let y = M + 8;
  text(co.displayName, M, y, { size: 17, bold: true });
  text("Statement of Account", R, y, { size: 19, bold: true, align: "right" });
  y += 16;
  text(`Date: ${fmtDate(stmt.toDate)}`, R, y, { size: 10, bold: true, color: mute, align: "right" });
  const head = [
    (co.address ?? []).join(", "),
    [co.registrationNumber ? `Reg. ${co.registrationNumber}` : "", co.email ?? "", co.telephone ? `Tel: ${co.telephone}` : ""].filter(Boolean).join("  |  "),
    co.vatNumber ? `VAT Reg. ${co.vatNumber}` : ""
  ].filter(Boolean);
  for (const h of head) for (const l of wrap(h, 300, 9)) { text(l, M, y, { size: 9, color: mute }); y += 12; }
  y = Math.max(y, M + 50) + 16;
  doc.setDrawColor(210, 214, 222); doc.line(M, y, R, y); y += 22;

  // Bill to + Period details
  const top = y;
  text("BILL TO", M, y, { size: 8.5, bold: true, color: mute }); y += 14;
  text(custName, M, y, { size: 11, bold: true }); y += 14;
  if (cust.contact && cust.contact !== cust.name) { text(cust.contact, M, y); y += 13; }
  for (const a of addr) { text(a, M, y, { color: mute }); y += 12.5; }
  if (cust.vat) { text(`VAT ${cust.vat}`, M, y, { color: mute }); y += 12.5; }

  let ry = top;
  const kv = (k: string, v: string) => { text(v, R, ry, { bold: true, align: "right" }); text(k, R - 130, ry, { color: mute, align: "right" }); ry += 15; };
  kv("Account Ref", custName);
  kv("Period", `${fmtDate(stmt.fromDate)} – ${fmtDate(stmt.toDate)}`);
  kv("Currency", "ZAR (R)");
  y = Math.max(y, ry) + 18;

  // Table Columns
  // W=595.28, M=48, R=547.28, Total width = 499.28
  const colDate = M + 6, colTx = M + 68, colRef = M + 188, colDeb = R - 145, colCred = R - 75, colBal = R;
  const header = () => {
    doc.setFillColor(240, 242, 246); doc.rect(M, y - 12, R - M, 20, "F");
    text("DATE", colDate, y + 1, { size: 8.5, bold: true, color: mute });
    text("TRANSACTION", colTx, y + 1, { size: 8.5, bold: true, color: mute });
    text("REFERENCE", colRef, y + 1, { size: 8.5, bold: true, color: mute });
    text("DEBIT", colDeb, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    text("CREDIT", colCred, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    text("BALANCE", colBal, y + 1, { size: 8.5, bold: true, color: mute, align: "right" });
    y += 20;
  };
  header();

  // Opening Balance Row
  doc.setFillColor(248, 250, 252); doc.rect(M, y - 10, R - M, 18, "F");
  text(fmtDate(stmt.fromDate), colDate, y + 2, { size: 9 });
  text("Opening Balance", colTx, y + 2, { size: 9, bold: true });
  text("—", colDeb, y + 2, { size: 9, color: mute, align: "right" });
  text("—", colCred, y + 2, { size: 9, color: mute, align: "right" });
  text(rand(stmt.openingBalanceCents), colBal, y + 2, { size: 9, bold: true, align: "right" });
  y += 18;
  doc.setDrawColor(232, 235, 240); doc.line(M, y - 4, R, y - 4);

  // Ledger Lines
  if (stmt.lines.length === 0) {
    text("No transactions recorded during this period", W / 2, y + 10, { size: 9, color: mute, align: "center" });
    y += 24;
    doc.setDrawColor(232, 235, 240); doc.line(M, y - 4, R, y - 4);
  } else {
    for (const l of stmt.lines) {
      if (y + 20 > H - 180) { doc.addPage(); y = M + 10; header(); }
      const txLabel = l.kind === "invoice" ? `Invoice ${l.number}` : l.kind === "credit_note" ? `Credit Note ${l.number}` : l.number;
      const refText = l.reference || l.description || "";
      const refLines = wrap(refText, colDeb - colRef - 10, 8.5);
      const rowH = Math.max(16, refLines.length * 11 + 5);

      if (y + rowH > H - 180) { doc.addPage(); y = M + 10; header(); }

      text(fmtDate(l.date), colDate, y + 1, { size: 8.5 });
      text(txLabel, colTx, y + 1, { size: 8.5, bold: true });
      if (refLines.length <= 1) {
        text(refLines[0] || "", colRef, y + 1, { size: 8.5, color: mute });
      } else {
        refLines.forEach((rl, i) => text(rl, colRef, y + 1 + i * 11, { size: 8.5, color: mute }));
      }
      text(l.debitCents > 0 ? rand(l.debitCents) : "—", colDeb, y + 1, { size: 8.5, align: "right" });
      text(l.creditCents > 0 ? rand(l.creditCents) : "—", colCred, y + 1, { size: 8.5, align: "right" });
      text(rand(l.balanceCents), colBal, y + 1, { size: 8.5, bold: true, align: "right" });

      y += rowH;
      doc.setDrawColor(232, 235, 240); doc.line(M, y - 3, R, y - 3);
    }
  }

  // Closing Balance Row
  if (y + 30 > H - 160) { doc.addPage(); y = M + 10; }
  y += 4;
  doc.setFillColor(244, 246, 249); doc.rect(M, y - 10, R - M, 22, "F");
  doc.setDrawColor(22, 32, 43); doc.line(M, y - 10, R, y - 10);
  text(fmtDate(stmt.toDate), colDate, y + 4, { size: 9, bold: true });
  text("Closing Balance Outstanding", colTx, y + 4, { size: 9.5, bold: true });
  text(rand(stmt.closingBalanceCents), colBal, y + 4, { size: 10, bold: true, align: "right", color: stmt.closingBalanceCents > 0 ? ink : [22, 163, 74] });
  y += 28;

  // Aging Table
  if (y + 65 > H - 120) { doc.addPage(); y = M + 10; }
  doc.setFillColor(248, 250, 252); doc.roundedRect(M, y, R - M, 52, 4, 4, "F");
  doc.setDrawColor(210, 214, 222); doc.roundedRect(M, y, R - M, 52, 4, 4, "S");
  text("AGING BREAKDOWN (DAYS OUTSTANDING)", M + 10, y + 14, { size: 8, bold: true, color: mute });

  const agingW = (R - M - 20) / 5;
  const agingCols = [
    { lbl: "Current (0-30)", val: rand(stmt.aging.currentCents), bold: false },
    { lbl: "30 Days", val: rand(stmt.aging.days30Cents), bold: false },
    { lbl: "60 Days", val: rand(stmt.aging.days60Cents), bold: false },
    { lbl: "90+ Days", val: rand(stmt.aging.days90Cents), bold: false },
    { lbl: "Total Due", val: rand(stmt.aging.totalDueCents), bold: true },
  ];
  agingCols.forEach((col, i) => {
    const cx = M + 10 + i * agingW;
    text(col.lbl, cx, y + 28, { size: 8, color: mute, bold: col.bold });
    text(col.val, cx, y + 42, { size: 9, bold: true, color: col.bold ? ink : undefined });
  });
  y += 66;

  // Banking Details Box
  if (y + 90 > H - M) { doc.addPage(); y = M + 10; }
  doc.setFillColor(246, 248, 251); doc.roundedRect(M, y, R - M, 86, 6, 6, "F");
  text("BANKING & REMITTANCE DETAILS", M + 14, y + 16, { size: 8.5, bold: true, color: mute });
  const rows: [string, string][] = [
    ["Bank", bank.bank],
    ["Account Name", bank.accountName],
    ["Account Number", bank.accountNumber],
    ["Account Type", bank.accountType],
    ["Branch Code", bank.branchCode],
    ["Payment Reference", custName],
  ];
  rows.forEach(([k, v], i) => {
    const cx = M + 14 + (i % 2) * ((R - M) / 2), cy = y + 33 + Math.floor(i / 2) * 15;
    text(`${k}:`, cx, cy, { size: 8.5, color: mute });
    text(v, cx + 86, cy, { size: 9, bold: true });
  });
  text(`Please email proof of payment to ${bank.proofEmail}`, M + 14, y + 78, { size: 8.5, color: mute });
  y += 98;

  // Running Page Numbering
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    text(`Statement of Account  |  ${clean(custName)}  |  Page ${i} of ${pages}`, W / 2, H - 24, { size: 8, color: mute, align: "center" });
  }

  return { doc, fileName: statementPdfFileName(stmt) };
}

export async function downloadStatementPdf(stmt: StatementData) {
  const { doc, fileName } = await buildStatementPdf(stmt);
  doc.save(fileName);
}
