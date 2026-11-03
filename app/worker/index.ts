import { calcDocument } from "../src/money";
import { AuthError, type Env } from "./auth";
import { handleBackup, handleRestore } from "./backup";
import { handleAuth, requireSession } from "./login";
import { ensureSchema } from "./schema";
import { deliver, mailMode, NOT_CONFIGURED } from "./mail";

// ───────── helpers ─────────
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg: string) => new HttpError(400, msg);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const QTY = /^\d+(\.\d{1,4})?$/;
const PCT = /^\d+(\.\d{1,2})?$/;
const str = (v: unknown, max = 500): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw bad("Expected text");
  const t = v.trim();
  if (t.length > max) throw bad(`Text is longer than ${max} characters`);
  return t || null;
};
const int = (v: unknown, name: string) => { if (!Number.isSafeInteger(v) || (v as number) < 0) throw bad(`${name} must be a whole number of cents`); return v as number; };
const safeJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== "string" || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
const todaySAST = (): string => new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toBase64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fmtRands(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "- " : ""}R ${whole}.${dec}`;
}

function extractBankBlock(defaultMessage?: string | null, companyName?: string | null, companyEmail?: string | null, reference?: string | null) {
  const msg = defaultMessage ?? "";
  const pick = (label: string, fallback: string) => {
    const m = msg.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
    return m ? m[1].trim() : fallback;
  };
  const bank = pick("Bank", "First National Bank (FNB)");
  const accountName = pick("Account Name", companyName || "Logia Services (Pty) Ltd");
  const accountNumber = pick("Account Number", "As per invoice instructions");
  const accountType = pick("Account Type", "Current / Cheque Account");
  const branchCode = pick("Branch Code", "250 655");
  const proofEmail = pick("Proof of payment", companyEmail || "accounts@logia.co.za");
  return {
    bank,
    accountName,
    accountNumber,
    accountType,
    branchCode,
    proofEmail,
    text: `Banking Details:\nBank: ${bank}\nAccount Name: ${accountName}\nAccount Number: ${accountNumber}\nAccount Type: ${accountType}\nBranch Code: ${branchCode}\nPayment Reference: ${reference || "Invoice / Customer Name"}\nProof of Payment: ${proofEmail}`,
  };
}

async function body<T>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 5_000_000) throw new HttpError(413, "Request too large");
  try { return (await req.json()) as T; } catch { throw bad("Request body is not valid JSON"); }
}
const audit = (env: Env, actor: string, action: string, entity: string, id: number | null, detail?: unknown) =>
  env.DB.prepare("INSERT INTO audit_events (actor, action, entity, entity_id, detail_json) VALUES (?,?,?,?,?)").bind(actor, action, entity, id, detail === undefined ? null : JSON.stringify(detail));

async function companyOk(env: Env, id: string) {
  const c = await env.DB.prepare("SELECT id, set_up FROM companies WHERE id = ?").bind(id).first<{ id: string; set_up: number }>();
  if (!c) throw new HttpError(404, "Unknown company");
  return c;
}

// ───────── document input → validated lines with server-side totals ─────────
type LineIn = { itemId?: number | null; description: string; comments?: string | null; unit?: string | null; quantity: string; unitPriceExclCents: number; discountPercent: string };
type DocIn = { companyId: string; kind: "invoice" | "quote" | "credit_note"; customerId: number; date: string; dueDate?: string | null; reference?: string | null; message?: string | null; vat: boolean; lines: LineIn[]; fromDocumentId?: number | null; version?: number; clientKey?: string };

// A real calendar date between 2000 and 2100 (audit F11: "2026-99-99" used to be accepted).
function isCalendarDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const MAX_QTY = 1_000_000;
const MAX_UNIT_PRICE_CENTS = 1_000_000_000; // R10 million per unit

function validateLines(rawLines: LineIn[], vat: boolean) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw bad("Add at least one line");
  if (rawLines.length > 200) throw bad("Too many lines");
  const taxRate = vat ? "0.15" : "0";
  const lines = rawLines.map((l, i) => {
    const description = str(l.description, 300);
    if (!description) throw bad(`Line ${i + 1}: add a description`);
    if (!QTY.test(String(l.quantity)) || Number(l.quantity) <= 0 || Number(l.quantity) > MAX_QTY) throw bad(`Line ${i + 1}: quantity must be more than 0 and at most ${MAX_QTY.toLocaleString("en-ZA")}`);
    if (!PCT.test(String(l.discountPercent ?? "0")) || Number(l.discountPercent) > 100) throw bad(`Line ${i + 1}: discount must be 0–100`);
    const price = int(l.unitPriceExclCents, `Line ${i + 1} price`);
    if (price > MAX_UNIT_PRICE_CENTS) throw bad(`Line ${i + 1}: price is above R10,000,000`);
    if (l.itemId !== null && l.itemId !== undefined && !Number.isSafeInteger(l.itemId)) throw bad(`Line ${i + 1}: unknown item`);
    return {
      itemId: l.itemId ?? null, description, comments: str(l.comments, 4000), unit: str(l.unit, 40),
      quantity: String(l.quantity), unitPriceExclCents: price,
      discountPercent: String(l.discountPercent ?? "0"), taxRate,
    };
  });
  const totals = calcDocument(lines);
  const all = [totals.discountCents, totals.exclusiveCents, totals.taxCents, totals.totalCents, ...totals.lines.flatMap((t) => [t.grossCents, t.exclusiveCents, t.taxCents, t.totalCents])];
  if (!all.every((n) => Number.isSafeInteger(n))) throw bad("The document total is too large to calculate exactly");
  return { lines, totals, taxRate };
}

function validateDoc(d: DocIn) {
  if (!["invoice", "quote", "credit_note"].includes(d.kind)) throw bad("Unknown document type");
  if (!Number.isSafeInteger(d.customerId)) throw bad("Choose a customer");
  if (!isCalendarDate(d.date)) throw bad("The date is not a real date");
  if (d.dueDate && !isCalendarDate(d.dueDate)) throw bad("The due date is not a real date");
  if (d.dueDate && d.dueDate < d.date) throw bad(d.kind === "quote" ? "Valid-until date is before the quote date" : "Due date is before the document date");
  return validateLines(d.lines, d.vat);
}

// Every item on a document must belong to the document's company (audit F10).
async function itemsBelong(env: Env, companyId: string, lines: { itemId: number | null }[]) {
  const ids = [...new Set(lines.map((l) => l.itemId).filter((x): x is number => x !== null))];
  if (!ids.length) return;
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM items WHERE company_id = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(companyId, ...ids).first<{ n: number }>();
  if ((r?.n ?? 0) !== ids.length) throw bad("One of the items does not belong to this company");
}

// Line inserts take the document id from a subquery and only run when `guard` holds,
// so a draft and its lines are always written in the same transaction.
function lineStatements(env: Env, docIdSql: string, guardSql: string, guardBinds: unknown[], lines: ReturnType<typeof validateDoc>["lines"], totals: ReturnType<typeof validateDoc>["totals"]) {
  return lines.map((l, i) => {
    const t = totals.lines[i];
    return env.DB.prepare(`INSERT INTO document_lines (document_id, line_no, item_id, description, comments, unit, quantity, unit_price_excl_cents, discount_percent, tax_rate, exclusive_cents, tax_cents, total_cents)
      SELECT ${docIdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardSql}`)
      .bind(...guardBinds.slice(0, (docIdSql.match(/\?/g) ?? []).length), i + 1, l.itemId, l.description, l.comments, l.unit, l.quantity, l.unitPriceExclCents, l.discountPercent, l.taxRate, t.exclusiveCents, t.taxCents, t.totalCents, ...guardBinds.slice((docIdSql.match(/\?/g) ?? []).length));
  });
}

// SQL expression for total settled cents on an invoice (cash/bank payments + issued credit notes linked to the invoice)
const INVOICE_SETTLED_SQL = `(
  (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE document_id = d.id AND voided_at IS NULL) +
  (SELECT COALESCE(SUM(cn.total_cents), 0) FROM documents cn WHERE cn.company_id = d.company_id AND cn.kind = 'credit_note' AND cn.status = 'issued' AND (cn.from_document_id = d.id OR (cn.from_document_id IS NULL AND cn.from_number IS NOT NULL AND cn.from_number = d.number)))
)`;

// ───────── routes ─────────
async function bootstrap(env: Env, url: URL) {
  const company = url.searchParams.get("company") ?? "logia-services";
  await companyOk(env, company);
  const [companies, customers, items, recurring, rlines, docs, seqs] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM companies ORDER BY set_up DESC, display_name"),
    env.DB.prepare("SELECT id, sage_id, name, category, contact_name, email, telephone, mobile, vat_number, postal_address_json, delivery_address_json, active, sage_balance_cents, version FROM customers WHERE company_id = ? ORDER BY name").bind(company),
    env.DB.prepare("SELECT id, code, description, category, unit, price_excl_cents, active, version FROM items WHERE company_id = ? ORDER BY description").bind(company),
    env.DB.prepare("SELECT * FROM recurring_templates WHERE company_id = ?").bind(company),
    env.DB.prepare("SELECT l.* FROM recurring_lines l JOIN recurring_templates t ON t.id = l.template_id WHERE t.company_id = ? ORDER BY l.template_id, l.line_no").bind(company),
    env.DB.prepare(`SELECT d.id, d.kind, d.number, d.status, d.customer_id, d.date, d.due_date, d.reference, d.tax_cents, d.total_cents, d.sage_status, d.from_number, d.version, d.source, d.sent_at, d.sent_to,
        (SELECT description FROM document_lines WHERE document_id = d.id AND line_no = 1) AS first_line,
        (SELECT COUNT(*) FROM document_lines WHERE document_id = d.id) AS line_count,
        CASE WHEN d.kind = 'invoice' THEN ${INVOICE_SETTLED_SQL} ELSE 0 END AS paid_cents
      FROM documents d WHERE d.company_id = ? ORDER BY d.date DESC, d.id DESC`).bind(company),
    env.DB.prepare("SELECT kind, prefix, width, next_value FROM number_sequences WHERE company_id = ?").bind(company),
  ]);
  return json({ company, companies: companies.results, customers: customers.results, items: items.results, recurring: recurring.results, recurringLines: rlines.results, documents: docs.results, sequences: seqs.results });
}

async function getDocument(env: Env, id: number, extra: Record<string, unknown> = {}) {
  const [d, lines, pays, ems, creds] = await env.DB.batch([
    env.DB.prepare(`SELECT d.*,
      CASE WHEN d.kind = 'invoice' THEN ${INVOICE_SETTLED_SQL} ELSE 0 END AS paid_cents
      FROM documents d WHERE d.id = ?`).bind(id),
    env.DB.prepare("SELECT * FROM document_lines WHERE document_id = ? ORDER BY line_no").bind(id),
    env.DB.prepare("SELECT id, date, amount_cents, method, reference, note, created_by, created_at, voided_at, voided_by FROM payments WHERE document_id = ? ORDER BY date, id").bind(id),
    env.DB.prepare("SELECT id, recipient_email, cc_email, subject, status, provider_id, created_by, created_at FROM email_messages WHERE document_id = ? ORDER BY id DESC").bind(id),
    env.DB.prepare(`SELECT id, number, date, total_cents, status FROM documents
      WHERE kind = 'credit_note' AND status <> 'void'
        AND (from_document_id = ? OR (from_document_id IS NULL AND from_number IS NOT NULL AND from_number = (SELECT number FROM documents WHERE id = ?) AND company_id = (SELECT company_id FROM documents WHERE id = ?)))
      ORDER BY id DESC`).bind(id, id, id),
  ]);
  if (!d.results[0]) throw new HttpError(404, "Document not found");
  return json({ ...d.results[0], lines: lines.results, payments: pays.results, emails: (ems?.results ?? []), creditNotes: (creds?.results ?? []), ...extra });
}

async function createDocument(env: Env, actor: string, d: DocIn) {
  const co = await companyOk(env, d.companyId);
  if (!co.set_up) throw bad("This company is not set up yet");
  const { lines, totals, taxRate } = validateDoc(d);
  const cust = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND company_id = ?").bind(d.customerId, d.companyId).first();
  if (!cust) throw bad("That customer does not belong to this company");
  await itemsBelong(env, d.companyId, lines);
  // The browser sends one key per new-document screen. A retry or double-click with the same key
  // returns the document that was already created instead of making a second one (audit F04).
  const token = typeof d.clientKey === "string" && /^[A-Za-z0-9-]{16,64}$/.test(d.clientKey) ? d.clientKey : crypto.randomUUID();
  const existing = await env.DB.prepare("SELECT id, company_id FROM documents WHERE create_token = ?").bind(token).first<{ id: number; company_id: string }>();
  if (existing) {
    if (existing.company_id !== d.companyId) throw bad("Duplicate request");
    return getDocument(env, existing.id, { existing: true });
  }
  let fromNumber: string | null = null;
  let fromQuoteId: number | null = null;
  if (d.fromDocumentId) {
    const f = await env.DB.prepare("SELECT number, kind, status FROM documents WHERE id = ? AND company_id = ?").bind(d.fromDocumentId, d.companyId).first<{ number: string | null; kind: string; status: string }>();
    if (!f) throw bad("The document you copied from was not found");
    fromNumber = f.number;
    if (f.kind === "quote" && d.kind === "invoice") fromQuoteId = d.fromDocumentId;
  }
  // One quote becomes one invoice. Checked inside the INSERT itself, so two requests at the same moment can't both pass.
  const guard = fromQuoteId === null
    ? "NOT EXISTS (SELECT 1 FROM documents WHERE create_token = ?)"
    : "NOT EXISTS (SELECT 1 FROM documents WHERE create_token = ?) AND NOT EXISTS (SELECT 1 FROM documents WHERE from_document_id = ? AND kind = 'invoice' AND status <> 'void')";
  const guardBinds = fromQuoteId === null ? [token] : [token, fromQuoteId];
  const ins = env.DB.prepare(`INSERT INTO documents (company_id, kind, status, customer_id, date, due_date, reference, message, vat_rate, discount_cents, exclusive_cents, tax_cents, total_cents, from_document_id, from_number, create_token)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(d.companyId, d.kind, "draft", d.customerId, d.date, d.dueDate ?? null, str(d.reference, 120), str(d.message, 4000), taxRate,
    totals.discountCents, totals.exclusiveCents, totals.taxCents, totals.totalCents, d.fromDocumentId ?? null, fromNumber, token, ...guardBinds);
  // Lines are written only if this request's header row exists (same transaction).
  const docId = "(SELECT id FROM documents WHERE create_token = ?)";
  const res = await env.DB.batch([ins, ...lineStatements(env, docId, "(SELECT id FROM documents WHERE create_token = ?) IS NOT NULL", [token, token], lines, totals),
    env.DB.prepare(`INSERT INTO audit_events (actor, action, entity, entity_id, detail_json) SELECT ?, 'create', ?, id, ? FROM documents WHERE create_token = ?`).bind(actor, d.kind, JSON.stringify({ total: totals.totalCents }), token)]);
  if (res[0].meta.changes !== 1) {
    const again = await env.DB.prepare("SELECT id FROM documents WHERE create_token = ?").bind(token).first<{ id: number }>();
    if (again) return getDocument(env, again.id, { existing: true });
    const inv = fromQuoteId === null ? null : await env.DB.prepare("SELECT id, number FROM documents WHERE from_document_id = ? AND kind = 'invoice' AND status <> 'void' ORDER BY id LIMIT 1").bind(fromQuoteId).first<{ id: number; number: string | null }>();
    if (inv) return getDocument(env, inv.id, { existing: true, notice: `This quote has already been turned into ${inv.number ? "invoice " + inv.number : "a draft invoice"}. Opened that one instead.` });
    throw new HttpError(409, "Could not save the draft. Reload and try again.");
  }
  const row = await env.DB.prepare("SELECT id FROM documents WHERE create_token = ?").bind(token).first<{ id: number }>();
  return getDocument(env, row!.id);
}

async function updateDocument(env: Env, actor: string, id: number, d: DocIn) {
  const cur = await env.DB.prepare("SELECT company_id, kind, status, version FROM documents WHERE id = ?").bind(id).first<{ company_id: string; kind: string; status: string; version: number }>();
  if (!cur) throw new HttpError(404, "Document not found");
  if (cur.status !== "draft") throw new HttpError(409, "Only drafts can be changed. Issued documents are locked.");
  if (d.version !== cur.version) throw new HttpError(409, "Someone else changed this draft. Reload to see the latest version.");
  const { lines, totals, taxRate } = validateDoc({ ...d, kind: cur.kind as DocIn["kind"] });
  const cust = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND company_id = ?").bind(d.customerId, cur.company_id).first();
  if (!cust) throw bad("That customer does not belong to this company");
  await itemsBelong(env, cur.company_id, lines);
  // This save's own token. The line delete/insert and audit run only if THIS request's header update
  // wrote the token. Checking the new version number was not enough: a competing save that lost the
  // race saw the winner's version and replaced the winner's lines (audit F01).
  const editToken = crypto.randomUUID();
  const mine = "(SELECT edit_token FROM documents WHERE id = ?) = ?";
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE documents SET customer_id=?, date=?, due_date=?, reference=?, message=?, vat_rate=?, discount_cents=?, exclusive_cents=?, tax_cents=?, total_cents=?,
      version = version + 1, edit_token = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'draft' AND version = ?`)
      .bind(d.customerId, d.date, d.dueDate ?? null, str(d.reference, 120), str(d.message, 4000), taxRate, totals.discountCents, totals.exclusiveCents, totals.taxCents, totals.totalCents, editToken, id, cur.version),
    env.DB.prepare(`DELETE FROM document_lines WHERE document_id = ? AND ${mine}`).bind(id, id, editToken),
    ...lineStatements(env, "?", mine, [id, id, editToken], lines, totals),
    env.DB.prepare(`INSERT INTO audit_events (actor, action, entity, entity_id, detail_json) SELECT ?, 'update', ?, ?, ? WHERE ${mine}`)
      .bind(actor, cur.kind, id, JSON.stringify({ total: totals.totalCents }), id, editToken),
  ]);
  if (res[0].meta.changes !== 1) throw new HttpError(409, "This draft changed while you were editing. Reload and try again.");
  return getDocument(env, id);
}

async function issueDocument(env: Env, actor: string, id: number, version: number) {
  const d = await env.DB.prepare("SELECT company_id, kind, status, version, customer_id FROM documents WHERE id = ?").bind(id).first<{ company_id: string; kind: string; status: string; version: number; customer_id: number }>();
  if (!d) throw new HttpError(404, "Document not found");
  if (d.status !== "draft") throw new HttpError(409, "This document has already been issued.");
  if (d.version !== version) throw new HttpError(409, "This draft changed. Reload before issuing.");
  const num = "(SELECT prefix || substr('0000000000000000' || next_value, -width) FROM number_sequences WHERE company_id = ?1 AND kind = ?2)";
  // One transaction: give the draft the next number, then advance the counter only if that draft got it.
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE documents SET status = 'issued', number = ${num}, issued_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), version = version + 1,
      customer_snapshot_json = (SELECT json_object('name', name, 'contact', contact_name, 'email', email, 'vat', vat_number, 'postal', json(postal_address_json), 'delivery', json(delivery_address_json)) FROM customers WHERE id = documents.customer_id),
      company_snapshot_json = (SELECT json_object('id', id, 'displayName', display_name, 'registeredName', registered_name, 'registrationNumber', registration_number, 'vatNumber', vat_number, 'email', email, 'telephone', telephone, 'address', json(address_json), 'defaultMessage', default_message) FROM companies WHERE id = documents.company_id)
      WHERE id = ?3 AND status = 'draft' AND version = ?4
        AND EXISTS (SELECT 1 FROM document_lines WHERE document_id = ?3)
        AND total_cents = (SELECT SUM(total_cents) FROM document_lines WHERE document_id = ?3)
        AND exclusive_cents = (SELECT SUM(exclusive_cents) FROM document_lines WHERE document_id = ?3)
        AND tax_cents = (SELECT SUM(tax_cents) FROM document_lines WHERE document_id = ?3)`).bind(d.company_id, d.kind, id, version),
    env.DB.prepare(`UPDATE number_sequences SET next_value = next_value + 1 WHERE company_id = ?1 AND kind = ?2
      AND EXISTS (SELECT 1 FROM documents WHERE id = ?3 AND status = 'issued' AND number = prefix || substr('0000000000000000' || next_value, -width))`).bind(d.company_id, d.kind, id),
    env.DB.prepare("INSERT INTO audit_events (actor, action, entity, entity_id) SELECT ?, 'issue', ?, ? WHERE (SELECT version FROM documents WHERE id = ?) = ?").bind(actor, d.kind, id, id, version + 1),
  ]);
  if (res[0].meta.changes !== 1) throw new HttpError(409, "Could not issue: the draft changed, or its lines don't add up to its total. Open the draft, save it again, then issue.");
  return getDocument(env, id);
}

// ───────── payments ─────────
type PaymentIn = { date: string; amountCents: number; method?: string | null; reference?: string | null; note?: string | null; clientKey?: string };

async function addPayment(env: Env, actor: string, docId: number, p: PaymentIn) {
  const d = await env.DB.prepare("SELECT company_id, kind, status, total_cents FROM documents WHERE id = ?").bind(docId).first<{ company_id: string; kind: string; status: string; total_cents: number }>();
  if (!d) throw new HttpError(404, "Document not found");
  if (d.kind !== "invoice" || d.status !== "issued") throw bad("Payments can only be recorded against issued invoices");
  if (!isCalendarDate(p.date)) throw bad("The payment date is not a real date");
  const amount = int(p.amountCents, "Amount");
  if (amount <= 0) throw bad("Enter an amount above R 0.00");
  const key = typeof p.clientKey === "string" && /^[A-Za-z0-9-_]{16,80}$/.test(p.clientKey) ? p.clientKey : crypto.randomUUID();
  // Never more than what is still open on the invoice (after payments and linked credit notes).
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO payments (company_id, document_id, date, amount_cents, method, reference, note, client_key, created_by)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM payments WHERE client_key = ?)
        AND ? <= (SELECT d.total_cents - ${INVOICE_SETTLED_SQL} FROM documents d WHERE d.id = ?)`)
      .bind(d.company_id, docId, p.date, amount, str(p.method, 40), str(p.reference, 120), str(p.note, 500), key, actor, key, amount, docId),
    env.DB.prepare(`INSERT INTO audit_events (actor, action, entity, entity_id, detail_json)
      SELECT ?, 'payment_add', 'document', ?, ? WHERE (SELECT changes()) = 1`)
      .bind(actor, docId, JSON.stringify({ amount, date: p.date })),
  ]);
  if (res[0].meta.changes !== 1) {
    const dup = await env.DB.prepare("SELECT id FROM payments WHERE client_key = ?").bind(key).first();
    if (!dup) throw new HttpError(409, "That is more than what is still owed on this invoice.");
  }
  return getDocument(env, docId);
}

async function voidPayment(env: Env, actor: string, docId: number, paymentId: number) {
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE payments SET voided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), voided_by = ? WHERE id = ? AND document_id = ? AND voided_at IS NULL").bind(actor, paymentId, docId),
    env.DB.prepare("INSERT INTO audit_events (actor, action, entity, entity_id, detail_json) SELECT ?, 'payment_void', 'document', ?, ? WHERE (SELECT changes()) = 1").bind(actor, docId, JSON.stringify({ paymentId })),
  ]);
  if (res[0].meta.changes !== 1) throw new HttpError(409, "That payment was not found or was already removed.");
  return getDocument(env, docId);
}

// ───────── HTML email & printable attachment templates ─────────
function renderDocumentHtml(d: {
  kind: string; number: string; date: string; due_date: string | null; reference: string | null;
  exclusive_cents: number; tax_cents: number; total_cents: number; from_number?: string | null;
  company_name: string; company_registered_name?: string | null; company_reg_no?: string | null; company_vat?: string | null;
  company_email?: string | null; company_tel?: string | null; company_address?: string[];
  customer_name: string; customer_contact?: string | null; customer_email?: string | null; customer_vat?: string | null; customer_address?: string[];
}, lines: Array<{ line_no: number; description: string; comments?: string | null; quantity: string; unit_price_excl_cents: number; discount_percent?: string; total_cents: number }>, bankInfo: ReturnType<typeof extractBankBlock>, customIntro?: string | null): string {
  const title = d.kind === "invoice" ? (d.tax_cents > 0 ? "Tax Invoice" : "Invoice") : d.kind === "quote" ? "Quotation" : "Credit Note";
  const rowsHtml = lines.map((l) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e8ef;">
        <div style="font-weight:600;color:#141821;">${escHtml(l.description)}</div>
        ${l.comments ? `<div style="font-size:12px;color:#5a6270;margin-top:3px;white-space:pre-line;">${escHtml(l.comments)}</div>` : ""}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e8ef;text-align:right;font-variant-numeric:tabular-nums;">${escHtml(Number(l.quantity))}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e8ef;text-align:right;font-variant-numeric:tabular-nums;">${escHtml(fmtRands(l.unit_price_excl_cents))}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e8ef;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${escHtml(fmtRands(l.total_cents))}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHtml(title)} ${escHtml(d.number)} — ${escHtml(d.company_name)}</title>
<style>
  @media print { body { background: #fff !important; padding: 0 !important; } .card { box-shadow: none !important; border: none !important; } }
</style>
</head>
<body style="margin:0;padding:24px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141821;">
  ${customIntro ? `<div style="max-width:760px;margin:0 auto 18px;padding:16px 20px;background:#ffffff;border-radius:10px;border:1px solid #e2e6ef;white-space:pre-line;font-size:14px;line-height:1.55;color:#2c3340;">${escHtml(customIntro)}</div>` : ""}
  <div class="card" style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #dfe4ee;padding:36px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-size:20px;font-weight:700;color:#0e131d;">${escHtml(d.company_name)}</div>
          <div style="font-size:12px;color:#5a6270;line-height:1.5;margin-top:4px;">
            ${d.company_reg_no ? `Reg. No. ${escHtml(d.company_reg_no)}<br/>` : ""}
            ${d.company_vat ? `VAT No. ${escHtml(d.company_vat)}<br/>` : ""}
            ${(d.company_address ?? []).map(escHtml).join(", ")}${d.company_address?.length ? "<br/>" : ""}
            ${[d.company_email, d.company_tel].filter(Boolean).map(escHtml).join(" · ")}
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#5a6270;font-weight:600;">${escHtml(title)}</div>
          <div style="font-size:24px;font-weight:700;color:#0e131d;margin-top:2px;">${escHtml(d.number)}</div>
          <div style="font-size:12px;color:#5a6270;margin-top:6px;">
            Date: <strong>${escHtml(d.date)}</strong>
            ${d.due_date ? `<br/>${d.kind === "quote" ? "Valid Until" : "Due Date"}: <strong>${escHtml(d.due_date)}</strong>` : ""}
            ${d.reference ? `<br/>Ref: <strong>${escHtml(d.reference)}</strong>` : ""}
            ${d.from_number ? `<br/>From: <strong>${escHtml(d.from_number)}</strong>` : ""}
          </div>
        </td>
      </tr>
    </table>
    <div style="padding:14px 16px;background:#f8fafd;border-radius:8px;border:1px solid #e5e9f2;margin-bottom:24px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:#687082;font-weight:600;">Billed To</div>
      <div style="font-size:15px;font-weight:600;margin-top:3px;">${escHtml(d.customer_name)}</div>
      <div style="font-size:12px;color:#5a6270;margin-top:2px;">
        ${d.customer_contact ? `${escHtml(d.customer_contact)}<br/>` : ""}
        ${(d.customer_address ?? []).map(escHtml).join(", ")}${d.customer_address?.length ? "<br/>" : ""}
        ${d.customer_vat ? `VAT No. ${escHtml(d.customer_vat)}` : ""}
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f3f6fb;color:#4a5262;text-transform:uppercase;font-size:11px;letter-spacing:0.05em;">
          <th style="padding:10px 8px;text-align:left;border-bottom:2px solid #dfe4ee;">Description</th>
          <th style="padding:10px 8px;text-align:right;border-bottom:2px solid #dfe4ee;">Qty</th>
          <th style="padding:10px 8px;text-align:right;border-bottom:2px solid #dfe4ee;">Unit Price</th>
          <th style="padding:10px 8px;text-align:right;border-bottom:2px solid #dfe4ee;">Line Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <table style="width:280px;margin-left:auto;margin-top:20px;border-collapse:collapse;font-size:13px;">
      ${d.tax_cents > 0 ? `
      <tr><td style="padding:5px 0;color:#5a6270;">Subtotal (excl. VAT)</td><td style="padding:5px 0;text-align:right;font-variant-numeric:tabular-nums;">${escHtml(fmtRands(d.exclusive_cents))}</td></tr>
      <tr><td style="padding:5px 0;color:#5a6270;">VAT (15%)</td><td style="padding:5px 0;text-align:right;font-variant-numeric:tabular-nums;">${escHtml(fmtRands(d.tax_cents))}</td></tr>
      ` : ""}
      <tr style="border-top:2px solid #141821;font-size:16px;font-weight:700;">
        <td style="padding:10px 0;">Total (${d.tax_cents > 0 ? "incl. VAT" : "ZAR"})</td>
        <td style="padding:10px 0;text-align:right;font-variant-numeric:tabular-nums;">${escHtml(fmtRands(d.total_cents))}</td>
      </tr>
    </table>
    ${d.kind !== "credit_note" ? `
    <div style="margin-top:28px;padding:16px;background:#f8fafd;border-radius:8px;border:1px solid #e5e9f2;font-size:12px;line-height:1.6;">
      <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4a5262;margin-bottom:6px;">Banking Details for EFT Payment</div>
      <div><strong>Bank:</strong> ${escHtml(bankInfo.bank)} &nbsp;·&nbsp; <strong>Branch Code:</strong> ${escHtml(bankInfo.branchCode)}</div>
      <div><strong>Account Name:</strong> ${escHtml(bankInfo.accountName)}</div>
      <div><strong>Account Number:</strong> ${escHtml(bankInfo.accountNumber)} (${escHtml(bankInfo.accountType)})</div>
      <div><strong>Payment Reference:</strong> ${escHtml(d.number)} &nbsp;·&nbsp; <strong>Proof of Payment:</strong> ${escHtml(bankInfo.proofEmail)}</div>
    </div>` : ""}
  </div>
</body>
</html>`;
}

function renderStatementHtml(data: any, bankInfo: ReturnType<typeof extractBankBlock>): string {
  const co = data.company;
  const cust = data.customer;
  const rowsHtml = (data.lines ?? []).map((l: any) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #e5e8ef;">${escHtml(l.date)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e8ef;font-weight:600;">${escHtml(l.number)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e8ef;color:#5a6270;">${escHtml(l.description)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e8ef;text-align:right;font-variant-numeric:tabular-nums;">${l.debitCents > 0 ? escHtml(fmtRands(l.debitCents)) : "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e8ef;text-align:right;color:#157f4b;font-variant-numeric:tabular-nums;">${l.creditCents > 0 ? escHtml(fmtRands(l.creditCents)) : "—"}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e8ef;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${escHtml(fmtRands(l.balanceCents))}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Statement of Account — ${escHtml(cust.name)} (${escHtml(data.toDate)})</title>
</head>
<body style="margin:0;padding:24px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141821;">
  <div style="max-width:780px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #dfe4ee;padding:36px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="vertical-align:top;">
          <div style="font-size:20px;font-weight:700;">${escHtml(co.displayName)}</div>
          <div style="font-size:12px;color:#5a6270;line-height:1.5;margin-top:4px;">
            ${co.registrationNumber ? `Reg. No. ${escHtml(co.registrationNumber)}<br/>` : ""}
            ${co.vatNumber ? `VAT No. ${escHtml(co.vatNumber)}<br/>` : ""}
            ${[co.email, co.telephone].filter(Boolean).map(escHtml).join(" · ")}
          </div>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <div style="font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">Statement of Account</div>
          <div style="font-size:12px;color:#5a6270;margin-top:4px;">Period: <strong>${escHtml(data.fromDate)}</strong> to <strong>${escHtml(data.toDate)}</strong></div>
          <div style="font-size:16px;font-weight:700;margin-top:8px;">Balance Due: ${escHtml(fmtRands(data.closingBalanceCents))}</div>
        </td>
      </tr>
    </table>
    <div style="padding:14px 16px;background:#f8fafd;border-radius:8px;border:1px solid #e5e9f2;margin-bottom:20px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:#687082;font-weight:600;">Account Holder</div>
      <div style="font-size:15px;font-weight:600;margin-top:2px;">${escHtml(cust.name)}</div>
      ${cust.email ? `<div style="font-size:12px;color:#5a6270;">${escHtml(cust.email)}</div>` : ""}
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead>
        <tr style="background:#f3f6fb;color:#4a5262;text-transform:uppercase;font-size:11px;">
          <th style="padding:9px 8px;text-align:left;border-bottom:2px solid #dfe4ee;">Date</th>
          <th style="padding:9px 8px;text-align:left;border-bottom:2px solid #dfe4ee;">Document</th>
          <th style="padding:9px 8px;text-align:left;border-bottom:2px solid #dfe4ee;">Details</th>
          <th style="padding:9px 8px;text-align:right;border-bottom:2px solid #dfe4ee;">Debit</th>
          <th style="padding:9px 8px;text-align:right;border-bottom:2px solid #dfe4ee;">Credit</th>
          <th style="padding:9px 8px;text-align:right;border-bottom:2px solid #dfe4ee;">Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#fafbfd;font-weight:600;">
          <td style="padding:8px;border-bottom:1px solid #e5e8ef;">${escHtml(data.fromDate)}</td>
          <td colspan="4" style="padding:8px;border-bottom:1px solid #e5e8ef;">Opening Balance Brought Forward</td>
          <td style="padding:8px;border-bottom:1px solid #e5e8ef;text-align:right;">${escHtml(fmtRands(data.openingBalanceCents))}</td>
        </tr>
        ${rowsHtml}
        <tr style="background:#f3f6fb;font-weight:700;font-size:14px;">
          <td style="padding:10px 8px;">${escHtml(data.toDate)}</td>
          <td colspan="4" style="padding:10px 8px;">Closing Balance Due (ZAR)</td>
          <td style="padding:10px 8px;text-align:right;">${escHtml(fmtRands(data.closingBalanceCents))}</td>
        </tr>
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:12px;text-align:center;border:1px solid #dfe4ee;">
      <tr style="background:#f3f6fb;font-weight:600;color:#4a5262;">
        <td style="padding:7px;border-right:1px solid #dfe4ee;">90+ Days</td>
        <td style="padding:7px;border-right:1px solid #dfe4ee;">60 Days</td>
        <td style="padding:7px;border-right:1px solid #dfe4ee;">30 Days</td>
        <td style="padding:7px;border-right:1px solid #dfe4ee;">Current (0–30d)</td>
        <td style="padding:7px;">Total Due</td>
      </tr>
      <tr style="font-weight:700;">
        <td style="padding:9px;border-right:1px solid #dfe4ee;">${escHtml(fmtRands(data.aging.days90Cents))}</td>
        <td style="padding:9px;border-right:1px solid #dfe4ee;">${escHtml(fmtRands(data.aging.days60Cents))}</td>
        <td style="padding:9px;border-right:1px solid #dfe4ee;">${escHtml(fmtRands(data.aging.days30Cents))}</td>
        <td style="padding:9px;border-right:1px solid #dfe4ee;">${escHtml(fmtRands(data.aging.currentCents))}</td>
        <td style="padding:9px;">${escHtml(fmtRands(data.aging.totalDueCents))}</td>
      </tr>
    </table>
    <div style="margin-top:24px;padding:16px;background:#f8fafd;border-radius:8px;border:1px solid #e5e9f2;font-size:12px;line-height:1.6;">
      <div style="font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#4a5262;margin-bottom:6px;">Banking Details for EFT Payment</div>
      <div><strong>Bank:</strong> ${escHtml(bankInfo.bank)} &nbsp;·&nbsp; <strong>Branch Code:</strong> ${escHtml(bankInfo.branchCode)}</div>
      <div><strong>Account Name:</strong> ${escHtml(bankInfo.accountName)}</div>
      <div><strong>Account Number:</strong> ${escHtml(bankInfo.accountNumber)} (${escHtml(bankInfo.accountType)})</div>
      <div><strong>Payment Reference:</strong> ${escHtml(cust.name)} &nbsp;·&nbsp; <strong>Proof of Payment:</strong> ${escHtml(bankInfo.proofEmail)}</div>
    </div>
  </div>
</body>
</html>`;
}

type SendIn = { toEmail?: string; ccEmail?: string | null; subject?: string; message?: string; pdfBase64?: string };

async function sendDocument(env: Env, actor: string, docId: number, s: SendIn, reqUrl?: URL) {
  const d = await env.DB.prepare(`SELECT d.id, d.company_id, d.kind, d.number, d.status, d.date, d.due_date, d.reference, d.exclusive_cents, d.tax_cents, d.total_cents, d.from_number,
      c.display_name AS company_name, c.registered_name AS company_registered_name, c.registration_number AS company_reg_no, c.vat_number AS company_vat,
      c.email AS company_email, c.telephone AS company_tel, c.address_json AS company_address_json, c.default_message AS company_default_message,
      cust.name AS customer_name, cust.contact_name AS customer_contact, cust.email AS customer_email, cust.vat_number AS customer_vat, cust.postal_address_json AS customer_address_json
    FROM documents d
    JOIN companies c ON c.id = d.company_id
    JOIN customers cust ON cust.id = d.customer_id
    WHERE d.id = ?`).bind(docId).first<{
      id: number; company_id: string; kind: string; number: string; status: string; date: string; due_date: string | null; reference: string | null; exclusive_cents: number; tax_cents: number; total_cents: number; from_number: string | null;
      company_name: string; company_registered_name: string | null; company_reg_no: string | null; company_vat: string | null;
      company_email: string | null; company_tel: string | null; company_address_json: string | null; company_default_message: string | null;
      customer_name: string; customer_contact: string | null; customer_email: string | null; customer_vat: string | null; customer_address_json: string | null;
    }>();
  if (!d) throw new HttpError(404, "Document not found");
  if (d.status !== "issued") throw bad("Only issued documents can be emailed");

  const to = str(s.toEmail || d.customer_email, 200);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw bad("Enter a valid recipient email address");
  const cc = s.ccEmail !== undefined ? (str(s.ccEmail, 200) || null) : (d.company_email || "accounts@logia.co.za");
  if (cc && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cc)) throw bad("Enter a valid CC email address");

  const docLines = await env.DB.prepare("SELECT line_no, description, comments, quantity, unit_price_excl_cents, discount_percent, total_cents FROM document_lines WHERE document_id = ? ORDER BY line_no").bind(docId).all<{ line_no: number; description: string; comments: string | null; quantity: string; unit_price_excl_cents: number; discount_percent: string; total_cents: number }>();
  const linesSummary = docLines.results.map((l) => `- ${Number(l.quantity) !== 1 ? `${Number(l.quantity)} x ` : ""}${l.description}: R ${(l.total_cents / 100).toFixed(2)}`).join("\n");

  const label = d.kind === "invoice" ? "Invoice" : d.kind === "quote" ? "Quotation" : "Credit Note";
  const defSubject = `${label} ${d.number} from ${d.company_name}`;
  const subject = str(s.subject || defSubject, 200) || defSubject;

  const totalStr = "R " + (d.total_cents / 100).toFixed(2);
  const bankInfo = extractBankBlock(d.company_default_message, d.company_name, d.company_email, d.number);
  const defaultBody = [
    `Dear ${d.customer_name},`,
    "",
    `Here are the details for ${label} ${d.number} (${d.date}${d.due_date ? `, due ${d.due_date}` : ""}) for ${totalStr}:`,
    "",
    linesSummary || `- ${label} ${d.number}: ${totalStr}`,
    "",
    `Total: ${totalStr}${d.tax_cents > 0 ? ` (incl. VAT R ${(d.tax_cents / 100).toFixed(2)})` : ""}`,
    ...(d.kind === "invoice" ? ["", bankInfo.text] : []),
    "",
    "Please contact us should you have any queries.",
    "",
    "Regards,",
    d.company_name,
  ].join("\n");
  const bodyText = s.message ? (str(s.message, 4000) || defaultBody) : defaultBody;

  const htmlDoc = renderDocumentHtml({
    ...d,
    company_address: safeJson<string[]>(d.company_address_json, []),
    customer_address: safeJson<string[]>(d.customer_address_json, []),
  }, docLines.results, bankInfo, s.message ? str(s.message, 4000) : null);

  let providerId: string | null = null;
  const status = "sent";

  const isTestHarness = reqUrl?.hostname === "test.invalid";
  if (mailMode(env) === "none" && !isTestHarness) throw new HttpError(503, NOT_CONFIGURED);

  if (mailMode(env) !== "none") {
    try {
      const pdf = typeof s.pdfBase64 === "string" && s.pdfBase64.length > 200 && s.pdfBase64.length < 6_000_000 ? s.pdfBase64 : null;
      providerId = await deliver(env, {
        fromName: d.company_name, fromEmail: "", replyTo: d.company_email || "accounts@logia.co.za",
        to, cc, subject, text: bodyText, html: htmlDoc,
        attachments: pdf ? [{ filename: `${d.number}.pdf`, contentBase64: pdf, mimeType: "application/pdf" }] : [{ filename: `${d.number}.html`, contentBase64: toBase64Utf8(htmlDoc), mimeType: "text/html" }],
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO email_messages (company_id, document_id, recipient_email, cc_email, subject, body_text, status, provider_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'failed', NULL, ?)`).bind(d.company_id, docId, to, cc, subject, bodyText, actor),
        env.DB.prepare(`INSERT INTO audit_events (actor, action, entity, entity_id, detail_json)
          VALUES (?, 'email_failed', 'document', ?, ?)`).bind(actor, docId, JSON.stringify({ to, cc, subject, error: errMsg })),
      ]);
      throw new HttpError(502, `Could not send the email: ${errMsg}`);
    }
  }

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO email_messages (company_id, document_id, recipient_email, cc_email, subject, body_text, status, provider_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(d.company_id, docId, to, cc, subject, bodyText, status, providerId, actor),
    env.DB.prepare(`UPDATE documents SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), sent_to = ? WHERE id = ?`).bind(to, docId),
    env.DB.prepare(`INSERT INTO audit_events (actor, action, entity, entity_id, detail_json)
      VALUES (?, 'email_sent', 'document', ?, ?)`).bind(actor, docId, JSON.stringify({ to, cc, subject, status, providerId })),
  ]);

  return getDocument(env, docId);
}

// ───────── recurring template CRUD & batch execution (Piece 3 + Piece 6) ─────────
type RecurringIn = {
  companyId: string;
  customerId: number;
  frequency: "monthly" | "annually";
  startDate: string;
  active?: boolean;
  reference?: string | null;
  message?: string | null;
  vat: boolean;
  lines: LineIn[];
};

async function saveRecurring(env: Env, actor: string, r: RecurringIn, id?: number) {
  if (!["monthly", "annually"].includes(r.frequency)) throw bad("Frequency must be monthly or annually");
  if (!Number.isSafeInteger(r.customerId)) throw bad("Choose a customer");
  if (!isCalendarDate(r.startDate)) throw bad("Start date must be a real calendar date");
  const { lines, totals } = validateLines(r.lines, r.vat);

  if (id === undefined) {
    const co = await companyOk(env, r.companyId);
    if (!co.set_up) throw bad("This company is not set up yet");
    const cust = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND company_id = ?").bind(r.customerId, r.companyId).first();
    if (!cust) throw bad("That customer does not belong to this company");
    await itemsBelong(env, r.companyId, lines);

    const existingNums = await env.DB.prepare("SELECT sage_number FROM recurring_templates WHERE company_id = ? AND sage_number LIKE 'RINV%'").bind(r.companyId).all<{ sage_number: string }>();
    let maxNum = 150;
    for (const row of existingNums.results) {
      const n = parseInt((row.sage_number || "").replace(/\D/g, ""), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
    const nextRinv = `RINV${String(maxNum + 1).padStart(7, "0")}`;

    const ins = await env.DB.prepare(`
      INSERT INTO recurring_templates (
        company_id, sage_number, customer_id, frequency, start_date, active, reference, message, exclusive_cents, tax_cents, total_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).bind(
      r.companyId, nextRinv, r.customerId, r.frequency, r.startDate,
      r.active === false ? 0 : 1, str(r.reference, 120), str(r.message, 4000),
      totals.exclusiveCents, totals.taxCents, totals.totalCents
    ).first<{ id: number }>();

    const tplId = ins!.id;
    await env.DB.batch([
      ...lines.map((l, i) => {
        const t = totals.lines[i];
        return env.DB.prepare(`
          INSERT INTO recurring_lines (
            template_id, line_no, item_id, description, comments, unit, quantity,
            unit_price_excl_cents, discount_percent, tax_rate, exclusive_cents, tax_cents, total_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(tplId, i + 1, l.itemId, l.description, l.comments, l.unit, l.quantity, l.unitPriceExclCents, l.discountPercent, l.taxRate, t.exclusiveCents, t.taxCents, t.totalCents);
      }),
      audit(env, actor, "create", "recurring_template", tplId, { number: nextRinv, total: totals.totalCents }),
    ]);

    return json({ id: tplId, number: nextRinv, ok: true });
  }

  const cur = await env.DB.prepare("SELECT id, company_id, sage_number FROM recurring_templates WHERE id = ?").bind(id).first<{ id: number; company_id: string; sage_number: string | null }>();
  if (!cur) throw new HttpError(404, "Recurring template not found");
  const cust = await env.DB.prepare("SELECT id FROM customers WHERE id = ? AND company_id = ?").bind(r.customerId, cur.company_id).first();
  if (!cust) throw bad("That customer does not belong to this company");
  await itemsBelong(env, cur.company_id, lines);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE recurring_templates
      SET customer_id = ?, frequency = ?, start_date = ?, active = ?, reference = ?, message = ?,
          exclusive_cents = ?, tax_cents = ?, total_cents = ?, version = version + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).bind(
      r.customerId, r.frequency, r.startDate, r.active === false ? 0 : 1,
      str(r.reference, 120), str(r.message, 4000),
      totals.exclusiveCents, totals.taxCents, totals.totalCents, id
    ),
    env.DB.prepare("DELETE FROM recurring_lines WHERE template_id = ?").bind(id),
    ...lines.map((l, i) => {
      const t = totals.lines[i];
      return env.DB.prepare(`
        INSERT INTO recurring_lines (
          template_id, line_no, item_id, description, comments, unit, quantity,
          unit_price_excl_cents, discount_percent, tax_rate, exclusive_cents, tax_cents, total_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, i + 1, l.itemId, l.description, l.comments, l.unit, l.quantity, l.unitPriceExclCents, l.discountPercent, l.taxRate, t.exclusiveCents, t.taxCents, t.totalCents);
    }),
    audit(env, actor, "update", "recurring_template", id, { total: totals.totalCents, active: r.active !== false }),
  ]);

  return json({ id, number: cur.sage_number, ok: true });
}

async function toggleRecurring(env: Env, actor: string, id: number, active: boolean) {
  const cur = await env.DB.prepare("SELECT id FROM recurring_templates WHERE id = ?").bind(id).first();
  if (!cur) throw new HttpError(404, "Recurring template not found");
  await env.DB.batch([
    env.DB.prepare("UPDATE recurring_templates SET active = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(active ? 1 : 0, id),
    audit(env, actor, active ? "resume" : "pause", "recurring_template", id),
  ]);
  return json({ id, active, ok: true });
}

async function deleteRecurring(env: Env, actor: string, id: number) {
  const cur = await env.DB.prepare("SELECT id, sage_number FROM recurring_templates WHERE id = ?").bind(id).first<{ id: number; sage_number: string | null }>();
  if (!cur) throw new HttpError(404, "Recurring template not found");
  await env.DB.batch([
    env.DB.prepare("UPDATE documents SET recurring_template_id = NULL WHERE recurring_template_id = ?").bind(id),
    env.DB.prepare("DELETE FROM recurring_lines WHERE template_id = ?").bind(id),
    env.DB.prepare("DELETE FROM recurring_templates WHERE id = ?").bind(id),
    audit(env, actor, "delete", "recurring_template", id, { number: cur.sage_number }),
  ]);
  return json({ ok: true });
}

function defaultRecurringDate(): string {
  const sast = todaySAST();
  return `${sast.slice(0, 7)}-25`;
}

function calculateDueDate(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function isTemplateDueForPeriod(t: { frequency: string; start_date: string; last_run_date: string | null }, runDate: string): boolean {
  if (t.start_date > runDate) return false;
  if (t.frequency === "annually") {
    const startMonth = t.start_date.slice(5, 7);
    const runMonth = runDate.slice(5, 7);
    if (startMonth !== runMonth) return false;
    if (t.last_run_date && t.last_run_date.slice(0, 4) === runDate.slice(0, 4)) return false;
    return true;
  }
  return t.frequency === "monthly";
}

async function previewRecurringRun(env: Env, companyId: string, targetDate?: string) {
  const date = targetDate && isCalendarDate(targetDate) ? targetDate : defaultRecurringDate();
  const period = date.slice(0, 7);
  const templates = await env.DB.prepare(`
    SELECT t.id, t.sage_id, t.sage_number, t.customer_id, t.frequency, t.start_date, t.reference, t.exclusive_cents, t.tax_cents, t.total_cents, t.last_run_date,
      c.name AS customer_name, c.email AS customer_email
    FROM recurring_templates t
    JOIN customers c ON c.id = t.customer_id
    WHERE t.company_id = ? AND t.active = 1 AND t.frequency IN ('monthly', 'annually') AND t.start_date <= ?
    ORDER BY c.name
  `).bind(companyId, date).all<any>();

  const dueTemplates = templates.results.filter((t: any) => isTemplateDueForPeriod(t, date));

  const generated = await env.DB.prepare(`
    SELECT recurring_template_id, number, id FROM documents
    WHERE company_id = ? AND recurring_period = ? AND status <> 'void'
  `).bind(companyId, period).all<{ recurring_template_id: number; number: string; id: number }>();
  const genMap = new Map(generated.results.map((g) => [g.recurring_template_id, g]));

  const items = dueTemplates.map((t: any) => {
    const existing = genMap.get(t.id);
    return {
      templateId: t.id,
      customerName: t.customer_name,
      customerEmail: t.customer_email,
      reference: t.reference,
      frequency: t.frequency,
      totalCents: t.total_cents,
      taxCents: t.tax_cents,
      alreadyRun: !!existing,
      invoiceNumber: existing?.number ?? null,
      invoiceId: existing?.id ?? null,
    };
  });

  const dueItems = items.filter((i: any) => !i.alreadyRun);
  const dueTotal = dueItems.reduce((acc: number, i: any) => acc + i.totalCents, 0);

  return {
    period,
    runDate: date,
    companyId,
    totalTemplates: items.length,
    dueCount: dueItems.length,
    alreadyRunCount: items.length - dueItems.length,
    projectedTotalCents: dueTotal,
    items,
  };
}

async function runRecurringBatch(env: Env, actor: string = "system:cron", companyId: string = "logia-services", targetDate?: string) {
  const date = targetDate && isCalendarDate(targetDate) ? targetDate : defaultRecurringDate();
  const period = date.slice(0, 7);
  const dueDate = calculateDueDate(date);

  const templates = await env.DB.prepare(`
    SELECT t.*, c.name AS customer_name, c.email AS customer_email
    FROM recurring_templates t
    JOIN customers c ON c.id = t.customer_id
    WHERE t.company_id = ? AND t.active = 1 AND t.frequency IN ('monthly', 'annually') AND t.start_date <= ?
    ORDER BY t.id
  `).bind(companyId, date).all<any>();

  const dueTemplates = templates.results.filter((t: any) => isTemplateDueForPeriod(t, date));

  const co = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first<any>();
  if (!co) throw bad("Company not found");

  const companySnapshot = JSON.stringify({
    id: co.id, displayName: co.display_name, registeredName: co.registered_name,
    registrationNumber: co.registration_number, vatNumber: co.vat_number,
    email: co.email, telephone: co.telephone, address: safeJson<string[]>(co.address_json, []),
    defaultMessage: co.default_message ?? null,
  });

  const allLines = await env.DB.prepare(`
    SELECT l.* FROM recurring_lines l
    JOIN recurring_templates t ON t.id = l.template_id
    WHERE t.company_id = ? AND t.active = 1
    ORDER BY l.template_id, l.line_no
  `).bind(companyId).all<any>();
  const linesByTemplate = new Map<number, any[]>();
  for (const l of allLines.results) {
    const arr = linesByTemplate.get(l.template_id) ?? [];
    arr.push(l);
    linesByTemplate.set(l.template_id, arr);
  }

  const generatedInvoices: Array<{ id: number; number: string; customer: string; amountCents: number }> = [];
  let skippedCount = 0;
  let totalGeneratedCents = 0;

  for (const t of dueTemplates) {
    const tLines = linesByTemplate.get(t.id) ?? [];
    if (tLines.length === 0) {
      skippedCount++;
      continue;
    }

    const exists = await env.DB.prepare("SELECT id, number FROM documents WHERE recurring_template_id = ? AND recurring_period = ? AND status <> 'void'").bind(t.id, period).first<{ id: number; number: string }>();
    if (exists) {
      skippedCount++;
      continue;
    }

    const createToken = crypto.randomUUID();
    const numSql = "(SELECT prefix || substr('0000000000000000' || next_value, -width) FROM number_sequences WHERE company_id = ?1 AND kind = 'invoice')";
    const custSnapSql = "(SELECT json_object('name', name, 'contact', contact_name, 'email', email, 'vat', vat_number, 'postal', json(postal_address_json), 'delivery', json(delivery_address_json)) FROM customers WHERE id = ?2)";

    const insDoc = env.DB.prepare(`
      INSERT INTO documents (
        company_id, kind, number, status, customer_id, date, due_date, reference, message, vat_rate,
        discount_cents, exclusive_cents, tax_cents, total_cents, source, from_number,
        recurring_template_id, recurring_period, issued_at, customer_snapshot_json, company_snapshot_json, create_token
      )
      SELECT ?1, 'invoice', ${numSql}, 'issued', ?2, ?3, ?4, ?5, ?6, (CASE WHEN ?7 > 0 THEN '0.15' ELSE '0' END),
        0, ?8, ?7, ?9, 'app', ?10,
        ?11, ?12, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ${custSnapSql}, ?13, ?14
      WHERE NOT EXISTS (SELECT 1 FROM documents WHERE recurring_template_id = ?11 AND recurring_period = ?12 AND status <> 'void')
    `).bind(
      companyId, t.customer_id, date, dueDate, t.reference, t.message, t.tax_cents,
      t.exclusive_cents, t.total_cents, t.sage_number,
      t.id, period, companySnapshot, createToken
    );

    const docIdSub = "(SELECT id FROM documents WHERE create_token = ?)";
    const guardSub = "EXISTS (SELECT 1 FROM documents WHERE create_token = ?)";

    const batchStmts: D1PreparedStatement[] = [
      insDoc,
      env.DB.prepare(`UPDATE number_sequences SET next_value = next_value + 1 WHERE company_id = ? AND kind = 'invoice' AND ${guardSub}`)
        .bind(companyId, createToken),
      ...tLines.map((l: any) =>
        env.DB.prepare(`
          INSERT INTO document_lines (
            document_id, line_no, item_id, description, comments, unit, quantity,
            unit_price_excl_cents, discount_percent, tax_rate, exclusive_cents, tax_cents, total_cents
          )
          SELECT ${docIdSub}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE ${guardSub}
        `).bind(
          createToken,
          l.line_no, l.item_id, l.description, l.comments, l.unit, l.quantity,
          l.unit_price_excl_cents, l.discount_percent, l.tax_rate, l.exclusive_cents, l.tax_cents, l.total_cents,
          createToken
        )
      ),
      env.DB.prepare(`UPDATE recurring_templates SET last_run_date = ? WHERE id = ? AND ${guardSub}`)
        .bind(date, t.id, createToken),
      env.DB.prepare(`
        INSERT INTO audit_events (actor, action, entity, entity_id, detail_json)
        SELECT ?, 'recurring_generated', 'document', id, json_object('templateId', ?, 'period', ?, 'number', number, 'total', ?)
        FROM documents WHERE create_token = ?
      `).bind(actor, t.id, period, t.total_cents, createToken),
    ];

    const batchRes = await env.DB.batch(batchStmts);
    if (batchRes[0].meta.changes !== 1) {
      skippedCount++;
      continue;
    }

    const created = await env.DB.prepare("SELECT id, number FROM documents WHERE create_token = ?").bind(createToken).first<{ id: number; number: string }>();
    if (created) {
      totalGeneratedCents += t.total_cents;
      generatedInvoices.push({ id: created.id, number: created.number, customer: t.customer_name, amountCents: t.total_cents });
    }
  }

  await audit(env, actor, "recurring_batch_completed", "company", 0, {
    companyId, period, date, generatedCount: generatedInvoices.length, skippedCount, totalCents: totalGeneratedCents
  }).run();

  return {
    period,
    runDate: date,
    generatedCount: generatedInvoices.length,
    skippedCount,
    totalCents: totalGeneratedCents,
    invoices: generatedInvoices,
  };
}

// ───────── FNB bank statement CSV reconciliation + split deposit matching (Piece 4 + Piece 6) ─────────
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  const norm = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === '"') {
      if (inQuotes && norm[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      fields.push(field.trim());
      field = "";
    } else if (c === "\n" && !inQuotes) {
      fields.push(field.trim());
      if (fields.some((f) => f.length > 0)) rows.push(fields);
      fields = [];
      field = "";
    } else {
      field += c;
    }
  }
  fields.push(field.trim());
  if (fields.some((f) => f.length > 0)) rows.push(fields);
  return rows;
}

const MONTH_NAMES: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

function parseBankDate(s: string): string | null {
  if (!s) return null;
  const t = s.trim().replace(/^['"]|['"]$/g, "");
  const m1 = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m1) {
    const d = `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
    return isCalendarDate(d) ? d : null;
  }
  const m2 = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    const d = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
    return isCalendarDate(d) ? d : null;
  }
  const m3 = t.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[\s\-](\d{4})$/);
  if (m3) {
    const mon = MONTH_NAMES[m3[2].toLowerCase()];
    if (mon) {
      const d = `${m3[3]}-${mon}-${m3[1].padStart(2, "0")}`;
      return isCalendarDate(d) ? d : null;
    }
  }
  return null;
}

function parseBankAmountCents(s: string): number | null {
  if (!s) return null;
  let clean = s.trim().replace(/[R\$\s]/g, "");
  let isNegative = false;
  if (clean.endsWith("Dr") || clean.endsWith("DR") || clean.endsWith("dr")) { isNegative = true; clean = clean.slice(0, -2); }
  if (clean.endsWith("Cr") || clean.endsWith("CR") || clean.endsWith("cr")) { clean = clean.slice(0, -2); }
  if (clean.startsWith("(") && clean.endsWith(")")) { isNegative = true; clean = clean.slice(1, -1); }
  if (clean.startsWith("-")) { isNegative = true; clean = clean.slice(1); }
  if (clean.startsWith("+")) { clean = clean.slice(1); }
  clean = clean.trim();
  if (clean.includes(",") && clean.includes(".")) {
    clean = clean.replace(/,/g, "");
  } else if (clean.includes(",") && !clean.includes(".")) {
    clean = clean.replace(/,/g, ".");
  }
  const n = parseFloat(clean);
  if (Number.isNaN(n)) return null;
  const cents = Math.round(n * 100);
  return isNegative ? -Math.abs(cents) : Math.abs(cents);
}

async function hashBankTx(companyId: string, date: string, amountCents: number, balanceCents: number | null, desc: string, occurrence = 1): Promise<string> {
  const enc = new TextEncoder();
  const suffix = occurrence > 1 ? `#${occurrence}` : "";
  const raw = `${companyId}|${date}|${amountCents}|${balanceCents ?? ""}|${desc.trim().toLowerCase()}${suffix}`;
  const h = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

type BankImportIn = { companyId: string; filename: string; csvContent: string };

type MatchSuggestion = {
  documentId: number;
  invoiceNumber: string;
  fromNumber: string | null;
  customerName: string;
  openCents: number;
  confidence: "high" | "medium" | "low";
  reason: string;
};

async function getOpenInvoices(env: Env, companyId: string) {
  const r = await env.DB.prepare(`
    SELECT d.id, d.number, d.from_number, d.date, d.total_cents, d.reference, d.source, d.sage_status,
      ${INVOICE_SETTLED_SQL} AS paid_cents,
      c.name AS customer_name
    FROM documents d
    JOIN customers c ON c.id = d.customer_id
    WHERE d.company_id = ? AND d.kind = 'invoice' AND d.status = 'issued'
    ORDER BY CASE WHEN d.source = 'app' THEN 0 ELSE 1 END, d.date ASC, d.id ASC
  `).bind(companyId).all<any>();
  return r.results.map((d: any) => ({
    id: d.id,
    number: d.number,
    fromNumber: d.from_number,
    date: d.date,
    totalCents: d.total_cents,
    paidCents: d.paid_cents,
    openCents: Math.max(0, d.total_cents - d.paid_cents),
    customerName: d.customer_name,
    reference: d.reference,
    source: d.source,
    sageStatus: d.sage_status,
  })).filter((d: any) => d.openCents > 0 && d.sageStatus !== "Paid");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suggestMatchForTx(tx: { description: string; amount_cents: number }, openInvoices: any[]): MatchSuggestion | null {
  if (tx.amount_cents <= 0) return null;
  const desc = tx.description.toUpperCase();
  const descClean = desc.replace(/[^A-Z0-9]/g, "");

  // 1. Exact Invoice number match (e.g. INV-000042, INV000042)
  for (const inv of openInvoices) {
    const numClean = (inv.number || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const fromClean = (inv.fromNumber || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

    const matchNum = numClean && numClean.length >= 5 && descClean.includes(numClean);
    const matchFrom = fromClean && fromClean.length >= 5 && descClean.includes(fromClean);

    if (matchNum || matchFrom) {
      const exactAmount = inv.openCents === tx.amount_cents;
      return {
        documentId: inv.id,
        invoiceNumber: inv.number,
        fromNumber: inv.fromNumber,
        customerName: inv.customerName,
        openCents: inv.openCents,
        confidence: exactAmount ? "high" : "medium",
        reason: exactAmount
          ? `Invoice ${inv.number} reference and exact amount match`
          : `Invoice ${inv.number} reference match (allocates R ${(Math.min(tx.amount_cents, inv.openCents) / 100).toFixed(2)} of R ${(inv.openCents / 100).toFixed(2)})`,
      };
    }
  }

  // 2. Customer Name (word-boundary match) + Exact Amount match (FIFO oldest open invoice first)
  for (const inv of openInvoices) {
    if (inv.openCents !== tx.amount_cents) continue;
    const nameWords = inv.customerName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length >= 4 && !["services", "pty", "ltd", "logia", "holdings", "company", "group", "trading", "projects", "south", "africa"].includes(w));

    const matchWord = nameWords.find((w: string) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(tx.description));
    if (matchWord) {
      return {
        documentId: inv.id,
        invoiceNumber: inv.number,
        fromNumber: inv.fromNumber,
        customerName: inv.customerName,
        openCents: inv.openCents,
        confidence: "high",
        reason: `Customer "${inv.customerName}" & exact open balance match`,
      };
    }
  }

  // 3. Unique Exact Amount match (prioritizing Plutus app invoices)
  const appMatches = openInvoices.filter((inv) => inv.source === "app" && inv.openCents === tx.amount_cents);
  const amountMatches = appMatches.length === 1 ? appMatches : openInvoices.filter((inv) => inv.openCents === tx.amount_cents);
  if (amountMatches.length === 1) {
    const inv = amountMatches[0];
    return {
      documentId: inv.id,
      invoiceNumber: inv.number,
      fromNumber: inv.fromNumber,
      customerName: inv.customerName,
      openCents: inv.openCents,
      confidence: "medium",
      reason: `Unique open invoice matching exact amount (R ${(inv.openCents / 100).toFixed(2)}) for ${inv.customerName}`,
    };
  }

  return null;
}

async function handleBankImport(env: Env, actor: string, input: BankImportIn) {
  await companyOk(env, input.companyId);
  if (!input.csvContent || typeof input.csvContent !== "string") throw bad("No CSV content provided");
  const filename = str(input.filename, 200) ?? "statement.csv";

  const rows = parseCsvRows(input.csvContent);
  if (rows.length === 0) throw bad("CSV file is empty");

  let headerIdx = -1;
  let dateCol = -1;
  let amountCol = -1;
  let balanceCol = -1;
  let descCol = -1;

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i].map((c) => c.toLowerCase().trim());
    const dIdx = row.findIndex((c) => c === "date" || c === "transaction date" || c.includes("date"));
    const aIdx = row.findIndex((c) => c === "amount" || c === "amount (zar)" || c.includes("amount"));
    if (dIdx !== -1 && aIdx !== -1) {
      headerIdx = i;
      dateCol = dIdx;
      amountCol = aIdx;
      balanceCol = row.findIndex((c) => c === "balance" || c.includes("balance"));
      descCol = row.findIndex((c) => c === "description" || c === "narrative" || c === "reference" || c.includes("desc"));
      break;
    }
  }

  if (headerIdx === -1) {
    dateCol = 0;
    amountCol = 1;
    balanceCol = 2;
    descCol = 3;
  }

  const dataRows = rows.slice(headerIdx + 1);
  if (dataRows.length === 0) throw bad("No transaction rows found in CSV");

  const enc = new TextEncoder();
  const fileHashBytes = await crypto.subtle.digest("SHA-256", enc.encode(input.csvContent));
  const fileChecksum = [...new Uint8Array(fileHashBytes)].map((x) => x.toString(16).padStart(2, "0")).join("");

  const stmtRes = await env.DB.prepare(`
    INSERT INTO bank_statements (company_id, filename, row_count, checksum, imported_by)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).bind(input.companyId, filename, dataRows.length, fileChecksum, actor).first<{ id: number }>();
  if (!stmtRes) throw new HttpError(500, "Could not create statement record");
  const statementId = stmtRes.id;

  let importedCount = 0;
  let skippedCount = 0;
  const seenKeys = new Map<string, number>();
  const pendingStmts: D1PreparedStatement[] = [];

  for (const row of dataRows) {
    if (row.length < 2) continue;
    const dateStr = row[dateCol];
    const amountStr = row[amountCol];
    const date = parseBankDate(dateStr);
    const amountCents = parseBankAmountCents(amountStr);
    if (!date || amountCents === null) continue;

    const balanceCents = balanceCol !== -1 && row[balanceCol] ? parseBankAmountCents(row[balanceCol]) : null;
    const desc = descCol !== -1 && row[descCol] ? row[descCol].trim() : row.slice(2).join(" ").trim();
    if (!desc) continue;

    const baseKey = `${date}|${amountCents}|${balanceCents ?? ""}|${desc.toLowerCase()}`;
    const occ = (seenKeys.get(baseKey) ?? 0) + 1;
    seenKeys.set(baseKey, occ);

    const txHash = await hashBankTx(input.companyId, date, amountCents, balanceCents, desc, occ);

    pendingStmts.push(
      env.DB.prepare(`
        INSERT INTO bank_transactions (
          statement_id, company_id, date, description, amount_cents, balance_cents, transaction_hash, status
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, 'unmatched'
        WHERE NOT EXISTS (SELECT 1 FROM bank_transactions WHERE company_id = ? AND transaction_hash = ?)
      `).bind(statementId, input.companyId, date, desc, amountCents, balanceCents, txHash, input.companyId, txHash)
    );
  }

  const BATCH_CHUNK = 25;
  for (let i = 0; i < pendingStmts.length; i += BATCH_CHUNK) {
    const chunkStmts = pendingStmts.slice(i, i + BATCH_CHUNK);
    const res = await env.DB.batch(chunkStmts);
    for (const r of res) {
      if ((r.meta?.changes ?? 0) > 0) importedCount++;
      else skippedCount++;
    }
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE bank_statements SET row_count = ? WHERE id = ?").bind(importedCount, statementId),
    audit(env, actor, "bank_statement_import", "bank_statement", statementId, { filename, importedCount, skippedCount }),
  ]);

  return json({ statementId, importedCount, skippedCount, totalRows: dataRows.length });
}

async function listBankTransactions(env: Env, companyId: string, statusFilter?: string) {
  let sql = `SELECT t.*, d.number AS matched_document_number,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.company_id = t.company_id AND p.voided_at IS NULL AND p.client_key LIKE ('bank-reconcile-tx-' || t.id || '-doc-%')) AS allocated_cents,
      (SELECT group_concat(d2.number, ', ') FROM payments p2 JOIN documents d2 ON d2.id = p2.document_id WHERE p2.company_id = t.company_id AND p2.voided_at IS NULL AND p2.client_key LIKE ('bank-reconcile-tx-' || t.id || '-doc-%')) AS matched_numbers
    FROM bank_transactions t
    LEFT JOIN documents d ON d.id = t.matched_document_id
    WHERE t.company_id = ?`;
  const args: any[] = [companyId];
  if (statusFilter && ["unmatched", "matched", "ignored"].includes(statusFilter)) {
    sql += " AND t.status = ?";
    args.push(statusFilter);
  }
  sql += " ORDER BY t.date DESC, t.id DESC LIMIT 500";

  const txs = await env.DB.prepare(sql).bind(...args).all<any>();
  const openInvoices = await getOpenInvoices(env, companyId);

  const results = txs.results.map((tx: any) => {
    const allocatedCents = tx.allocated_cents ?? 0;
    const remainingCents = tx.amount_cents > 0 ? Math.max(0, tx.amount_cents - allocatedCents) : 0;
    let suggestion: MatchSuggestion | null = null;
    if (tx.status === "unmatched" && remainingCents > 0) {
      suggestion = suggestMatchForTx({ description: tx.description, amount_cents: remainingCents }, openInvoices);
    }
    return {
      id: tx.id,
      statementId: tx.statement_id,
      companyId: tx.company_id,
      date: tx.date,
      description: tx.description,
      amountCents: tx.amount_cents,
      allocatedCents,
      remainingCents,
      balanceCents: tx.balance_cents,
      matchedDocumentId: tx.matched_document_id,
      matchedDocumentNumber: tx.matched_numbers || tx.matched_document_number || null,
      matchedAt: tx.matched_at,
      matchType: tx.match_type,
      status: tx.status,
      suggestion,
    };
  });

  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'unmatched' AND amount_cents > 0 THEN 1 ELSE 0 END) AS unmatched_deposits_count,
      SUM(CASE WHEN status = 'unmatched' AND amount_cents > 0 THEN amount_cents ELSE 0 END) AS unmatched_deposits_cents,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched_count,
      SUM(CASE WHEN status = 'matched' THEN amount_cents ELSE 0 END) AS matched_cents,
      SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count
    FROM bank_transactions WHERE company_id = ?
  `).bind(companyId).first<any>();

  return json({ transactions: results, stats, openInvoices });
}

async function handleBankMatch(env: Env, actor: string, input: { transactionId: number; documentId: number; amountCents?: number; note?: string }) {
  const tx = await env.DB.prepare(`
    SELECT t.*,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.company_id = t.company_id AND p.voided_at IS NULL AND p.client_key LIKE ('bank-reconcile-tx-' || t.id || '-doc-%')) AS allocated_cents
    FROM bank_transactions t WHERE t.id = ?
  `).bind(input.transactionId).first<any>();
  if (!tx) throw new HttpError(404, "Transaction not found");
  if (tx.status === "matched") throw bad("Transaction is already fully matched");
  if (tx.amount_cents <= 0) throw bad("Only credit/deposit transactions can be matched to invoices");

  const alreadyAllocated = tx.allocated_cents ?? 0;
  const remainingTxCents = Math.max(0, tx.amount_cents - alreadyAllocated);
  if (remainingTxCents <= 0) throw bad("This deposit has already been fully allocated");

  const doc = await env.DB.prepare(`
    SELECT d.id, d.company_id, d.kind, d.number, d.status, d.total_cents,
      ${INVOICE_SETTLED_SQL} AS paid_cents
    FROM documents d WHERE d.id = ?
  `).bind(input.documentId).first<any>();
  if (!doc) throw new HttpError(404, "Document not found");
  if (doc.kind !== "invoice" || doc.status !== "issued") throw bad("Only issued invoices can receive payment");
  if (doc.company_id !== tx.company_id) throw bad("Company mismatch between bank transaction and document");

  const openCents = Math.max(0, doc.total_cents - (doc.paid_cents ?? 0));
  if (openCents <= 0) throw bad("This invoice is already fully paid");

  const requestedAmount = input.amountCents !== undefined && input.amountCents !== null
    ? int(input.amountCents, "Match amount")
    : remainingTxCents;
  const matchAmount = Math.min(requestedAmount, remainingTxCents, openCents);
  if (matchAmount <= 0) throw bad("Enter a match amount above R 0.00");

  const newAllocated = alreadyAllocated + matchAmount;
  const nextStatus = newAllocated >= tx.amount_cents ? "matched" : "unmatched";
  const nextMatchType = newAllocated >= tx.amount_cents ? "confirmed" : "partial";
  const paymentRef = `FNB: ${tx.description.slice(0, 100)}`;
  const pKey = `bank-reconcile-tx-${tx.id}-doc-${doc.id}-${crypto.randomUUID().slice(0, 8)}`;

  const res = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO payments (company_id, document_id, date, amount_cents, method, reference, note, client_key, created_by)
      SELECT ?, ?, ?, ?, 'fnb_eft', ?, ?, ?, ?
      WHERE (SELECT status FROM bank_transactions WHERE id = ?) <> 'matched'
        AND ? <= (SELECT d.total_cents - ${INVOICE_SETTLED_SQL} FROM documents d WHERE d.id = ?)
    `).bind(
      doc.company_id, doc.id, tx.date, matchAmount, paymentRef,
      input.note ?? `Reconciled from FNB statement transaction #${tx.id}`,
      pKey, actor, tx.id, matchAmount, doc.id
    ),
    env.DB.prepare(`
      UPDATE bank_transactions
      SET status = ?, matched_document_id = ?, matched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), match_type = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM payments WHERE client_key = ? AND voided_at IS NULL)
    `).bind(nextStatus, doc.id, nextMatchType, tx.id, pKey),
    env.DB.prepare(`
      INSERT INTO audit_events (actor, action, entity, entity_id, detail_json)
      SELECT ?, 'bank_match', 'bank_transaction', ?, ?
      WHERE EXISTS (SELECT 1 FROM payments WHERE client_key = ? AND voided_at IS NULL)
    `).bind(actor, tx.id, JSON.stringify({ documentId: doc.id, amountCents: matchAmount, status: nextStatus, allocatedCents: newAllocated }), pKey),
  ]);

  if (res[0].meta.changes !== 1) {
    throw new HttpError(409, "Could not match transaction: invoice balance or transaction status changed.");
  }

  return json({
    ok: true,
    transactionId: tx.id,
    documentId: doc.id,
    amountMatchedCents: matchAmount,
    allocatedCents: newAllocated,
    remainingCents: Math.max(0, tx.amount_cents - newAllocated),
    status: nextStatus,
  });
}

async function handleBankIgnore(env: Env, actor: string, input: { transactionId: number }) {
  const tx = await env.DB.prepare(`
    SELECT t.*,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.company_id = t.company_id AND p.voided_at IS NULL AND p.client_key LIKE ('bank-reconcile-tx-' || t.id || '-doc-%')) AS allocated_cents
    FROM bank_transactions t WHERE t.id = ?
  `).bind(input.transactionId).first<any>();
  if (!tx) throw new HttpError(404, "Transaction not found");
  if (tx.status === "matched" || (tx.allocated_cents ?? 0) > 0) throw bad("Cannot ignore a transaction that has matched payments. Undo its matches first.");

  await env.DB.batch([
    env.DB.prepare("UPDATE bank_transactions SET status = 'ignored' WHERE id = ?").bind(tx.id),
    audit(env, actor, "bank_ignore", "bank_transaction", tx.id),
  ]);
  return json({ ok: true, transactionId: tx.id, status: "ignored" });
}

async function handleBankUnmatch(env: Env, actor: string, input: { transactionId: number }) {
  const tx = await env.DB.prepare(`
    SELECT t.*,
      (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.company_id = t.company_id AND p.voided_at IS NULL AND p.client_key LIKE ('bank-reconcile-tx-' || t.id || '-doc-%')) AS allocated_cents
    FROM bank_transactions t WHERE t.id = ?
  `).bind(input.transactionId).first<any>();
  if (!tx) throw new HttpError(404, "Transaction not found");

  if (tx.status === "ignored") {
    await env.DB.batch([
      env.DB.prepare("UPDATE bank_transactions SET status = 'unmatched' WHERE id = ?").bind(tx.id),
      audit(env, actor, "bank_restore_ignored", "bank_transaction", tx.id),
    ]);
    return json({ ok: true, transactionId: tx.id, status: "unmatched" });
  }

  if (tx.status !== "matched" && (tx.allocated_cents ?? 0) <= 0) throw bad("Transaction is not currently matched");

  const pKeyPrefix = `bank-reconcile-tx-${tx.id}-doc-%`;

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE payments
      SET voided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), voided_by = ?
      WHERE company_id = ? AND client_key LIKE ? AND voided_at IS NULL
    `).bind(actor, tx.company_id, pKeyPrefix),
    env.DB.prepare(`
      UPDATE bank_transactions
      SET status = 'unmatched', matched_document_id = NULL, matched_at = NULL, match_type = NULL
      WHERE id = ?
    `).bind(tx.id),
    audit(env, actor, "bank_unmatch", "bank_transaction", tx.id, { documentId: tx.matched_document_id, voidedCents: tx.allocated_cents }),
  ]);

  return json({ ok: true, transactionId: tx.id, status: "unmatched" });
}

// ───────── Customer Account Statement & Ledger (Piece 5 + Piece 6 Sage settlement support) ─────────
type StatementLine = {
  date: string;
  kind: "invoice" | "payment" | "credit_note";
  number: string;
  reference: string | null;
  description: string;
  debitCents: number;
  creditCents: number;
  balanceCents: number;
  documentId?: number;
  paymentId?: number;
  source?: string;
};

async function getCustomerStatement(env: Env, customerId: number, url: URL) {
  const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first<any>();
  if (!cust) throw new HttpError(404, "Customer not found");

  const co = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(cust.company_id).first<any>();
  if (!co) throw new HttpError(404, "Company not found");

  const today = todaySAST();
  const qFrom = url.searchParams.get("from");
  const qTo = url.searchParams.get("to");
  const onlyApp = url.searchParams.get("onlyApp") === "1";

  const toDate = qTo && isCalendarDate(qTo) ? qTo : today;
  let fromDate = qFrom && isCalendarDate(qFrom) ? qFrom : "";
  if (!fromDate) {
    const d = new Date(toDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 90);
    fromDate = d.toISOString().slice(0, 10);
  }
  if (fromDate > toDate) throw bad("From date cannot be after To date");

  const sourceFilter = onlyApp ? " AND source = 'app'" : "";
  const docJoinFilter = onlyApp ? " AND d.source = 'app'" : "";

  const uncheckedSageRow = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM documents d
    WHERE d.customer_id = ? AND d.kind = 'invoice' AND d.status = 'issued' AND d.source = 'sage'
      AND (d.sage_status IS NULL OR d.sage_status <> 'Paid')
      AND ${INVOICE_SETTLED_SQL} < d.total_cents
  `).bind(customerId).first<{ n: number }>();
  const uncheckedSageCount = uncheckedSageRow?.n ?? 0;

  // 1. Calculate opening balance as of fromDate.
  // Historical Sage invoices marked sage_status = 'Paid' were already settled in Sage (which had no separate payments export).
  const openDebits = await env.DB.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN d.source = 'sage' AND d.sage_status = 'Paid'
           THEN (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE document_id = d.id AND voided_at IS NULL AND date < ?2)
           ELSE d.total_cents END
    ), 0) AS total
    FROM documents d
    WHERE d.customer_id = ?1 AND d.kind = 'invoice' AND d.status = 'issued' AND d.date < ?2${docJoinFilter}
  `).bind(customerId, fromDate).first<{ total: number }>();

  const openCredits = await env.DB.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) AS total
    FROM documents
    WHERE customer_id = ? AND kind = 'credit_note' AND status = 'issued' AND date < ?${sourceFilter}
  `).bind(customerId, fromDate).first<{ total: number }>();

  const openPayments = await env.DB.prepare(`
    SELECT COALESCE(SUM(p.amount_cents), 0) AS total
    FROM payments p
    JOIN documents d ON d.id = p.document_id
    WHERE d.customer_id = ? AND p.voided_at IS NULL AND p.date < ?${docJoinFilter}
  `).bind(customerId, fromDate).first<{ total: number }>();

  const openingBalanceCents = (openDebits?.total ?? 0) - (openCredits?.total ?? 0) - (openPayments?.total ?? 0);

  // 2. Fetch period documents (invoices, credit notes)
  const docs = await env.DB.prepare(`
    SELECT d.id, d.kind, d.number, d.date, d.due_date, d.reference, d.total_cents, d.source, d.sage_status,
      (SELECT description FROM document_lines WHERE document_id = d.id AND line_no = 1) AS first_line,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE document_id = d.id AND voided_at IS NULL AND date <= ?3) AS paid_cents
    FROM documents d
    WHERE d.customer_id = ?1 AND d.kind IN ('invoice', 'credit_note') AND d.status = 'issued' AND d.date >= ?2 AND d.date <= ?3${docJoinFilter}
  `).bind(customerId, fromDate, toDate).all<any>();

  // 3. Fetch period payments
  const pays = await env.DB.prepare(`
    SELECT p.id, p.date, p.amount_cents, p.method, p.reference, p.note,
      d.id AS document_id, d.number AS doc_number
    FROM payments p
    JOIN documents d ON d.id = p.document_id
    WHERE d.customer_id = ? AND p.voided_at IS NULL AND p.date >= ? AND p.date <= ?${docJoinFilter}
  `).bind(customerId, fromDate, toDate).all<any>();

  // 4. Combine and sort transactions chronologically
  type RawTx = {
    date: string;
    kind: "invoice" | "payment" | "credit_note";
    number: string;
    reference: string | null;
    description: string;
    debitCents: number;
    creditCents: number;
    documentId?: number;
    paymentId?: number;
    source?: string;
    id: number;
  };

  const rawList: RawTx[] = [];
  for (const d of docs.results) {
    if (d.kind === "invoice") {
      rawList.push({
        id: d.id,
        date: d.date,
        kind: "invoice",
        number: d.number,
        reference: d.reference,
        description: d.first_line ?? "Invoice",
        debitCents: d.total_cents,
        creditCents: 0,
        documentId: d.id,
        source: d.source,
      });
      // If a historical Sage invoice in this window was marked Paid in Sage and has no Plutus payment, include its Sage settlement
      const sageSettledCents = Math.max(0, d.total_cents - (d.paid_cents ?? 0));
      if (d.source === "sage" && d.sage_status === "Paid" && sageSettledCents > 0) {
        rawList.push({
          id: d.id + 0.5,
          date: d.date,
          kind: "payment",
          number: `Settled (${d.number})`,
          reference: d.number,
          description: "Historical payment recorded in Sage",
          debitCents: 0,
          creditCents: sageSettledCents,
          documentId: d.id,
          source: "sage",
        });
      }
    } else if (d.kind === "credit_note") {
      rawList.push({
        id: d.id,
        date: d.date,
        kind: "credit_note",
        number: d.number,
        reference: d.reference,
        description: d.first_line ?? "Credit Note",
        debitCents: 0,
        creditCents: d.total_cents,
        documentId: d.id,
        source: d.source,
      });
    }
  }

  for (const p of pays.results) {
    rawList.push({
      id: p.id,
      date: p.date,
      kind: "payment",
      number: p.reference ? `Payment (${p.reference})` : `Payment for ${p.doc_number ?? "Invoice"}`,
      reference: p.doc_number,
      description: p.note ?? (p.method ? `Method: ${p.method}` : "Payment received"),
      debitCents: 0,
      creditCents: p.amount_cents,
      documentId: p.document_id,
      paymentId: p.id,
    });
  }

  rawList.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  let currentBalance = openingBalanceCents;
  const lines: StatementLine[] = rawList.map((tx) => {
    currentBalance += (tx.debitCents - tx.creditCents);
    return {
      date: tx.date,
      kind: tx.kind,
      number: tx.number,
      reference: tx.reference,
      description: tx.description,
      debitCents: tx.debitCents,
      creditCents: tx.creditCents,
      balanceCents: currentBalance,
      documentId: tx.documentId,
      paymentId: tx.paymentId,
      source: tx.source,
    };
  });

  const closingBalanceCents = currentBalance;

  // 5. Calculate Aging Analysis (0-30, 31-60, 61-90, 91+ days) excluding settled Sage invoices
  const openInvoices = await env.DB.prepare(`
    SELECT d.id, d.number, d.date, d.total_cents, d.source, d.sage_status,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE document_id = d.id AND voided_at IS NULL AND date <= ?) AS paid_cents
    FROM documents d
    WHERE d.customer_id = ? AND d.kind = 'invoice' AND d.status = 'issued' AND d.date <= ?
      AND NOT (d.source = 'sage' AND d.sage_status = 'Paid')${docJoinFilter}
    ORDER BY d.date ASC
  `).bind(toDate, customerId, toDate).all<any>();

  const totalCreditsRow = await env.DB.prepare(`
    SELECT COALESCE(SUM(total_cents), 0) AS total
    FROM documents
    WHERE customer_id = ? AND kind = 'credit_note' AND status = 'issued' AND date <= ?${sourceFilter}
  `).bind(customerId, toDate).first<{ total: number }>();

  let currentAging = 0;
  let days30 = 0;
  let days60 = 0;
  let days90 = 0;

  const toMs = new Date(toDate + "T00:00:00Z").getTime();

  for (const inv of openInvoices.results) {
    const open = Math.max(0, inv.total_cents - inv.paid_cents);
    if (open <= 0) continue;
    const invMs = new Date(inv.date + "T00:00:00Z").getTime();
    const ageDays = Math.floor((toMs - invMs) / (1000 * 60 * 60 * 24));
    if (ageDays <= 30) currentAging += open;
    else if (ageDays <= 60) days30 += open;
    else if (ageDays <= 90) days60 += open;
    else days90 += open;
  }

  let creditToApply = totalCreditsRow?.total ?? 0;
  for (const bucket of ["days90", "days60", "days30", "currentAging"] as const) {
    if (creditToApply <= 0) break;
    if (bucket === "days90") { const used = Math.min(days90, creditToApply); days90 -= used; creditToApply -= used; }
    if (bucket === "days60") { const used = Math.min(days60, creditToApply); days60 -= used; creditToApply -= used; }
    if (bucket === "days30") { const used = Math.min(days30, creditToApply); days30 -= used; creditToApply -= used; }
    if (bucket === "currentAging") { const used = Math.min(currentAging, creditToApply); currentAging -= used; creditToApply -= used; }
  }

  const companySnapshot = {
    id: co.id,
    displayName: co.display_name,
    registeredName: co.registered_name,
    registrationNumber: co.registration_number,
    vatNumber: co.vat_number,
    email: co.email,
    telephone: co.telephone,
    address: safeJson<string[]>(co.address_json, []),
    defaultMessage: co.default_message ?? null,
  };

  const customerSnapshot = {
    id: cust.id,
    name: cust.name,
    contact: cust.contact_name,
    email: cust.email,
    telephone: cust.telephone,
    mobile: cust.mobile,
    vat: cust.vat_number,
    postal: safeJson<string[]>(cust.postal_address_json, []),
    delivery: safeJson<string[]>(cust.delivery_address_json, []),
  };

  return json({
    company: companySnapshot,
    customer: customerSnapshot,
    fromDate,
    toDate,
    onlyApp,
    uncheckedSageCount,
    openingBalanceCents,
    closingBalanceCents,
    lines,
    aging: {
      currentCents: currentAging,
      days30Cents: days30,
      days60Cents: days60,
      days90Cents: days90,
      totalDueCents: Math.max(0, closingBalanceCents),
    },
  });
}

async function sendCustomerStatement(env: Env, actor: string, customerId: number, body: { fromDate?: string; toDate?: string; toEmail?: string; ccEmail?: string; onlyApp?: boolean }, reqUrl?: URL) {
  const cust = await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(customerId).first<any>();
  if (!cust) throw new HttpError(404, "Customer not found");

  const to = str(body?.toEmail ?? cust.email, 200);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw bad("A valid recipient email address is required");
  const cc = str(body?.ccEmail, 200);
  if (cc && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cc)) throw bad("Enter a valid CC email address");

  const url = new URL(`https://test.invalid/api/customers/${customerId}/statement`);
  if (body?.fromDate) url.searchParams.set("from", body.fromDate);
  if (body?.toDate) url.searchParams.set("to", body.toDate);
  if (body?.onlyApp) url.searchParams.set("onlyApp", "1");

  const stmtResponse = await getCustomerStatement(env, customerId, url);
  const data = await stmtResponse.json() as any;

  const co = data.company;
  const subject = `Statement of Account from ${co.displayName} (${data.fromDate} to ${data.toDate})`;
  const bankInfo = extractBankBlock(co.defaultMessage, co.displayName, co.email, data.customer.name);
  const ledgerLines = data.lines.map((l: any) =>
    `- ${l.date} | ${l.kind === "invoice" ? `Invoice ${l.number}` : l.kind === "credit_note" ? `Credit Note ${l.number}` : l.number} | ${l.debitCents > 0 ? `+R ${(l.debitCents / 100).toFixed(2)}` : `-R ${(l.creditCents / 100).toFixed(2)}`} | Bal: R ${(l.balanceCents / 100).toFixed(2)}`
  ).join("\n");

  const bodyText = `Dear ${data.customer.contact || data.customer.name},

Here is your Statement of Account from ${co.displayName} for the period ${data.fromDate} to ${data.toDate}.

Statement Summary:
- Opening Balance: R ${(data.openingBalanceCents / 100).toFixed(2)}
- Total Invoiced: R ${(data.lines.filter((l: any) => l.debitCents > 0).reduce((a: number, l: any) => a + l.debitCents, 0) / 100).toFixed(2)}
- Total Credits & Payments: R ${(data.lines.filter((l: any) => l.creditCents > 0).reduce((a: number, l: any) => a + l.creditCents, 0) / 100).toFixed(2)}
- Closing Balance Outstanding: R ${(data.closingBalanceCents / 100).toFixed(2)}

${ledgerLines ? `Period Transactions:\n${ledgerLines}\n\n` : ""}Aging Analysis:
- Current (0-30 days): R ${(data.aging.currentCents / 100).toFixed(2)}
- 30 Days: R ${(data.aging.days30Cents / 100).toFixed(2)}
- 60 Days: R ${(data.aging.days60Cents / 100).toFixed(2)}
- 90+ Days: R ${(data.aging.days90Cents / 100).toFixed(2)}
- Total Due: R ${(data.aging.totalDueCents / 100).toFixed(2)}

${bankInfo.text}

Kind regards,
Accounts Department
${co.displayName}
${co.email || "accounts@logia.co.za"}
${co.telephone || ""}
`;

  const htmlStmt = renderStatementHtml(data, bankInfo);
  const safeCustSlug = String(data.customer.name || "Customer").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);

  let providerId: string | null = null;
  let status = "sent";

  const isTestHarness = reqUrl?.hostname === "test.invalid";
  if (mailMode(env) === "none" && !isTestHarness) throw new HttpError(503, NOT_CONFIGURED);

  if (mailMode(env) !== "none") {
    try {
      providerId = await deliver(env, {
        fromName: co.displayName, fromEmail: "", replyTo: co.email || "accounts@logia.co.za",
        to, cc, subject, text: bodyText, html: htmlStmt,
        attachments: [{ filename: `Statement_${safeCustSlug}_${data.toDate}.html`, contentBase64: toBase64Utf8(htmlStmt), mimeType: "text/html" }],
      });
    } catch (e) {
      console.error("Email failed:", e);
      status = "failed";
      throw new HttpError(502, `Failed to send email: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await audit(env, actor, "statement_email_sent", "customer", customerId, {
    to, cc, subject, status, providerId, period: `${data.fromDate} to ${data.toDate}`, closingBalance: data.closingBalanceCents
  }).run();

  return json({ ok: true, recipient: to, cc, subject, status, providerId });
}

// ───────── Editable Company Settings, Test Email & Pre-Cutover Sage Settlement (Piece 6) ─────────
type CompanyIn = {
  displayName: string;
  registeredName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  email?: string | null;
  telephone?: string | null;
  address?: string[] | null;
  defaultMessage?: string | null;
  setUp?: boolean;
};

async function updateCompany(env: Env, actor: string, companyId: string, input: CompanyIn) {
  await companyOk(env, companyId);
  const displayName = str(input.displayName, 200);
  if (!displayName) throw bad("Company display name is required");
  const email = str(input.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter a valid company email address");
  const addr = Array.isArray(input.address) ? input.address.map((a) => str(a, 140)).filter(Boolean) : [];

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE companies
      SET display_name = ?, registered_name = ?, registration_number = ?, vat_number = ?,
          email = ?, telephone = ?, address_json = ?, default_message = ?,
          set_up = CASE WHEN ? IS NOT NULL THEN ? ELSE set_up END
      WHERE id = ?
    `).bind(
      displayName,
      str(input.registeredName, 200),
      str(input.registrationNumber, 80),
      str(input.vatNumber, 80),
      email,
      str(input.telephone, 60),
      addr.length ? JSON.stringify(addr) : null,
      str(input.defaultMessage, 4000),
      input.setUp !== undefined ? (input.setUp ? 1 : 0) : null,
      input.setUp !== undefined ? (input.setUp ? 1 : 0) : null,
      companyId
    ),
    audit(env, actor, "update_company", "company", null, { companyId, displayName }),
  ]);

  return json(await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first());
}

async function settleHistoricalSageInvoices(env: Env, actor: string, companyId: string, input: { beforeDate: string; action?: "settle" | "unsettle"; customerId?: number }) {
  await companyOk(env, companyId);
  if (!isCalendarDate(input.beforeDate)) throw bad("Choose a valid cutover date (YYYY-MM-DD)");
  const action = input.action === "unsettle" ? "unsettle" : "settle";
  const hasCust = input.customerId !== undefined && Number.isSafeInteger(input.customerId);

  if (action === "settle") {
    const sql = `
      UPDATE documents
      SET sage_status = 'Paid', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE company_id = ? AND kind = 'invoice' AND status = 'issued' AND source = 'sage'
        AND date <= ? AND (sage_status IS NULL OR sage_status <> 'Paid')
        ${hasCust ? "AND customer_id = ?" : ""}
    `;
    const binds = hasCust ? [companyId, input.beforeDate, input.customerId!] : [companyId, input.beforeDate];
    const r = await env.DB.prepare(sql).bind(...binds).run();
    const updatedCount = r.meta?.changes ?? 0;
    await audit(env, actor, "sage_cutover_settle", "company", input.customerId ?? null, { companyId, beforeDate: input.beforeDate, updatedCount }).run();
    return json({ ok: true, action, beforeDate: input.beforeDate, updatedCount });
  } else {
    const sql = `
      UPDATE documents
      SET sage_status = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE company_id = ? AND kind = 'invoice' AND status = 'issued' AND source = 'sage'
        AND date <= ? AND sage_status = 'Paid' AND sage_amount_due_cents IS NULL
        ${hasCust ? "AND customer_id = ?" : ""}
    `;
    const binds = hasCust ? [companyId, input.beforeDate, input.customerId!] : [companyId, input.beforeDate];
    const r = await env.DB.prepare(sql).bind(...binds).run();
    const updatedCount = r.meta?.changes ?? 0;
    await audit(env, actor, "sage_cutover_unsettle", "company", input.customerId ?? null, { companyId, beforeDate: input.beforeDate, updatedCount }).run();
    return json({ ok: true, action, beforeDate: input.beforeDate, updatedCount });
  }
}

async function sendTestEmail(env: Env, actor: string, input: { companyId?: string; toEmail?: string }, reqUrl?: URL) {
  const companyId = input.companyId || "logia-services";
  const co = await env.DB.prepare("SELECT * FROM companies WHERE id = ?").bind(companyId).first<any>();
  const companyName = co?.display_name || "Plutus Accounting";
  const to = str(input.toEmail || actor, 200);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw bad("Enter a valid email address for the test email");

  const isTestHarness = reqUrl?.hostname === "test.invalid";
  if (mailMode(env) === "none" && !isTestHarness) throw new HttpError(503, NOT_CONFIGURED);

  let providerId: string | null = "test-simulated";
  if (mailMode(env) !== "none") {
    try {
      providerId = await deliver(env, {
        fromName: companyName, fromEmail: "", replyTo: co?.email || "accounts@logia.co.za", to,
        subject: `Plutus email test - ${companyName}`,
        text: `This is a live test email from Plutus (${companyName}) triggered by ${actor} on ${todaySAST()}.\n\nEmail sending is working.`,
      });
    } catch (e) { throw new HttpError(502, `Test email failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  await audit(env, actor, "test_email_sent", "company", null, { companyId, to, providerId }).run();
  return json({ ok: true, recipient: to, providerId });
}

async function deleteDraft(env: Env, actor: string, id: number) {
  const r = await env.DB.batch([
    env.DB.prepare("DELETE FROM document_lines WHERE document_id = ? AND (SELECT status FROM documents WHERE id = ?) = 'draft'").bind(id, id),
    env.DB.prepare("DELETE FROM documents WHERE id = ? AND status = 'draft'").bind(id),
    env.DB.prepare("INSERT INTO audit_events (actor, action, entity, entity_id) SELECT ?, 'delete_draft', 'document', ? WHERE (SELECT changes()) = 1").bind(actor, id),
  ]);
  if (r[1].meta.changes !== 1) throw new HttpError(409, "Only drafts can be deleted.");
  return json({ ok: true });
}

type CustomerIn = { companyId: string; name: string; category?: string; contactName?: string; email?: string; telephone?: string; mobile?: string; vatNumber?: string; postalAddress?: string[]; active?: boolean; version?: number };
async function saveCustomer(env: Env, actor: string, c: CustomerIn, id?: number) {
  const name = str(c.name, 200); if (!name) throw bad("Customer name is required");
  const email = str(c.email, 200); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("That email address doesn't look right");
  const addr = Array.isArray(c.postalAddress) ? c.postalAddress.map((a) => str(a, 120)).filter(Boolean) : [];
  const vals = [name, str(c.category, 80), str(c.contactName, 120), email, str(c.telephone, 40), str(c.mobile, 40), str(c.vatNumber, 40), addr.length ? JSON.stringify(addr) : null];
  if (id === undefined) {
    const co = await companyOk(env, c.companyId); if (!co.set_up) throw bad("This company is not set up yet");
    const r = await env.DB.prepare("INSERT INTO customers (company_id, name, category, contact_name, email, telephone, mobile, vat_number, postal_address_json) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id").bind(c.companyId, ...vals).first<{ id: number }>();
    await audit(env, actor, "create", "customer", r!.id).run();
    return json(await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(r!.id).first());
  }
  const r = await env.DB.prepare(`UPDATE customers SET name=?, category=?, contact_name=?, email=?, telephone=?, mobile=?, vat_number=?, postal_address_json=?, active=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=? AND (? IS NULL OR company_id = ?)`)
    .bind(...vals, c.active === false ? 0 : 1, id, c.version ?? -1, c.companyId ?? null, c.companyId ?? null).run();
  if (r.meta.changes !== 1) throw new HttpError(409, "This customer was changed elsewhere. Reload and try again.");
  await audit(env, actor, "update", "customer", id).run();
  return json(await env.DB.prepare("SELECT * FROM customers WHERE id = ?").bind(id).first());
}

type ItemIn = { companyId: string; code?: string; description: string; category?: string; unit?: string; priceExclCents: number; active?: boolean; version?: number };
async function saveItem(env: Env, actor: string, i: ItemIn, id?: number) {
  const description = str(i.description, 200); if (!description) throw bad("Item name is required");
  const vals = [str(i.code, 40), description, str(i.category, 80), str(i.unit, 40), int(i.priceExclCents, "Price")];
  if (id === undefined) {
    const co = await companyOk(env, i.companyId); if (!co.set_up) throw bad("This company is not set up yet");
    const r = await env.DB.prepare("INSERT INTO items (company_id, code, description, category, unit, price_excl_cents) VALUES (?,?,?,?,?,?) RETURNING id").bind(i.companyId, ...vals).first<{ id: number }>();
    await audit(env, actor, "create", "item", r!.id).run();
    return json(await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(r!.id).first());
  }
  const r = await env.DB.prepare(`UPDATE items SET code=?, description=?, category=?, unit=?, price_excl_cents=?, active=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=? AND (? IS NULL OR company_id = ?)`)
    .bind(...vals, i.active === false ? 0 : 1, id, i.version ?? -1, i.companyId ?? null, i.companyId ?? null).run();
  if (r.meta.changes !== 1) throw new HttpError(409, "This item was changed elsewhere. Reload and try again.");
  await audit(env, actor, "update", "item", id).run();
  return json(await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(id).first());
}

// ───────── Sage import (sent in small chunks by the browser; safe to repeat) ─────────
async function importChunk(env: Env, actor: string, part: string, b: { batchId: string; sha256?: string; company?: Record<string, unknown>; rows?: any[]; counts?: Record<string, number> }) {
  const C = "logia-services";
  const rows = b.rows ?? [];
  if (rows.length > 150) throw bad("Chunk too large");
  const st: D1PreparedStatement[] = [];
  const addr = (a: unknown) => (Array.isArray(a) && a.length ? JSON.stringify(a) : null);
  if (part === "start") {
    if (!b.sha256 || !/^[0-9a-f]{64}$/.test(b.sha256)) throw bad("Missing file fingerprint");
    const c = b.company ?? {};
    st.push(env.DB.prepare("INSERT OR IGNORE INTO import_batches (id, source, source_sha256) VALUES (?, 'sage', ?)").bind(b.batchId, b.sha256));
    st.push(env.DB.prepare("UPDATE companies SET display_name=?, registered_name=?, registration_number=?, email=?, telephone=?, address_json=?, default_message=? WHERE id=?")
      .bind(c.displayName ?? "Logia Services (Pty) Ltd", c.registeredName ?? null, c.registrationNumber ?? null, c.email ?? null, c.telephone ?? null, addr(c.address), c.defaultMessage ?? null, C));
  } else if (part === "customers") {
    for (const c of rows) st.push(env.DB.prepare(`INSERT INTO customers (company_id, sage_id, name, category, contact_name, email, telephone, mobile, vat_number, postal_address_json, delivery_address_json, active, sage_balance_cents)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(sage_id) DO NOTHING`).bind(C, c.sageId, c.name, c.category, c.contactName, c.email, c.telephone, c.mobile, c.vatNumber, addr(c.postalAddress), addr(c.deliveryAddress), c.active ? 1 : 0, c.sageBalanceCents));
  } else if (part === "items") {
    for (const i of rows) st.push(env.DB.prepare(`INSERT INTO items (company_id, sage_id, code, description, category, unit, price_excl_cents, active) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(sage_id) DO NOTHING`)
      .bind(C, i.sageId, i.code, i.description, i.category, i.unit, i.priceExclCents, i.active ? 1 : 0));
  } else if (part === "documents" || part === "recurring") {
    for (const d of rows) {
      const lineCols = "line_no, item_id, description, comments, unit, quantity, unit_price_excl_cents, discount_percent, tax_rate, exclusive_cents, tax_cents, total_cents";
      const itemSub = "(SELECT id FROM items WHERE sage_id = ?)";
      if (part === "recurring") {
        st.push(env.DB.prepare(`INSERT INTO recurring_templates (company_id, sage_id, sage_number, customer_id, frequency, start_date, last_run_date, active, reference, message, exclusive_cents, tax_cents, total_cents)
          SELECT ?, ?, ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM customers WHERE sage_id = ? ON CONFLICT(sage_id) DO NOTHING`)
          .bind(C, d.sageId, d.number, d.frequency, d.startDate, d.lastRunDate, d.active ? 1 : 0, d.reference, d.message, d.exclusiveCents, d.taxCents, d.totalCents, d.customerSageId));
        d.lines.forEach((l: any, n: number) => st.push(env.DB.prepare(`INSERT OR IGNORE INTO recurring_lines (template_id, ${lineCols}) SELECT t.id, ?, ${itemSub}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM recurring_templates t WHERE t.sage_id = ?`)
          .bind(n + 1, l.itemSageId, l.description, l.comments, l.unit, l.quantity, l.unitPriceExclCents, l.discountPercent, l.taxRate, l.exclusiveCents, l.taxCents, l.totalCents, d.sageId)));
      } else {
        const kind = d.kind as string;
        if (!["invoice", "quote", "credit_note"].includes(kind)) throw bad("Unknown document kind");
        st.push(env.DB.prepare(`INSERT INTO documents (company_id, kind, number, status, customer_id, date, due_date, reference, message, vat_rate, discount_cents, exclusive_cents, tax_cents, total_cents, from_number, source, sage_id, sage_status, sage_amount_due_cents, issued_at)
          SELECT ?, ?, ?, 'issued', id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sage', ?, ?, ?, ? FROM customers WHERE sage_id = ? ON CONFLICT(sage_id) DO NOTHING`)
          .bind(C, kind, d.number, d.date, d.dueDate ?? d.expiryDate ?? null, d.reference, d.message ?? null, d.taxCents > 0 ? "0.15" : "0", d.discountCents, d.exclusiveCents, d.taxCents, d.totalCents, d.fromDocument, d.sageId, d.sageStatus, d.amountDueCents, d.date, d.customerSageId));
        d.lines.forEach((l: any, n: number) => st.push(env.DB.prepare(`INSERT OR IGNORE INTO document_lines (document_id, ${lineCols}) SELECT x.id, ?, ${itemSub}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM documents x WHERE x.sage_id = ?`)
          .bind(n + 1, l.itemSageId, l.description, l.comments, l.unit, l.quantity, l.unitPriceExclCents, l.discountPercent, l.taxRate, l.exclusiveCents, l.taxCents, l.totalCents, d.sageId)));
      }
    }
  } else if (part === "finish") {
    // Continue each Sage sequence after the highest imported number.
    for (const [kind, prefix] of [["invoice", "INV"], ["quote", "QUO"], ["credit_note", "CRN"]] as const) {
      st.push(env.DB.prepare(`UPDATE number_sequences SET next_value = MAX(next_value, 1 + COALESCE((SELECT MAX(CAST(substr(number, ${prefix.length + 1}) AS INTEGER)) FROM documents WHERE company_id = ? AND kind = ? AND number LIKE '${prefix}%'), 0))
        WHERE company_id = ? AND kind = ?`).bind(C, kind, C, kind));
    }
    st.push(env.DB.prepare("UPDATE import_batches SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), counts_json = ? WHERE id = ?").bind(JSON.stringify(b.counts ?? {}), b.batchId));
    st.push(audit(env, actor, "import_finished", "import", null, b.counts));
  } else throw new HttpError(404, "Unknown import step");
  if (st.length) await env.DB.batch(st);
  return json({ ok: true, statements: st.length });
}

async function stats(env: Env) {
  const r = await env.DB.batch([
    env.DB.prepare("SELECT kind, COUNT(*) n, SUM(total_cents) total FROM documents GROUP BY kind"),
    env.DB.prepare("SELECT COUNT(*) n FROM document_lines"),
    env.DB.prepare("SELECT COUNT(*) n FROM customers"),
    env.DB.prepare("SELECT COUNT(*) n FROM items"),
    env.DB.prepare("SELECT COUNT(*) n, SUM(total_cents) total FROM recurring_templates"),
    env.DB.prepare("SELECT COUNT(*) n FROM recurring_lines"),
    env.DB.prepare("SELECT * FROM number_sequences"),
  ]);
  return json({ documents: r[0].results, documentLines: r[1].results[0], customers: r[2].results[0], items: r[3].results[0], recurring: r[4].results[0], recurringLines: r[5].results[0], sequences: r[6].results });
}

// ───────── entry ─────────
export default {
  async scheduled(event: any, env: Env, ctx: any) {
    if ((env as any).CRON_ENABLED === "0") return;
    await ensureSchema(env);
    const companies = await env.DB.prepare("SELECT id FROM companies WHERE set_up = 1").all<{ id: string }>();
    for (const co of companies.results) {
      await runRecurringBatch(env, "system:cron", co.id);
    }
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      // Same-origin writes only (the login cookie is SameSite=Strict too; this blocks cross-site posts).
      if (req.method !== "GET") {
        const origin = req.headers.get("Origin");
        const fetchSite = req.headers.get("Sec-Fetch-Site");
        if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
          throw new HttpError(403, "Cross-site request refused");
        }
        if ((req.method === "POST" || req.method === "PUT") && !(req.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "JSON expected");
      }
      const p = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
      if (p[0] === "auth") { const r = await handleAuth(req, env, p[1] ?? ""); if (r) return r; throw new HttpError(404, "Not found"); }
      if (p[0] === "restore") return await handleRestore(req, env, p[1] ?? "");
      const actor = await requireSession(req, env);
      await ensureSchema(env);
      if (p[0] === "backup" && req.method === "GET") return await handleBackup(env, url, p[1] ?? "");
      const id = p[1] && /^\d{1,15}$/.test(p[1]) ? Number(p[1]) : undefined;
      if (p[1] && id === undefined && !["import", "recurring", "bank", "companies", "settings"].includes(p[0])) throw new HttpError(404, "Not found");
      const m = req.method;
      if (p[0] === "me" && m === "GET") return await json({ email: actor });
      if (p[0] === "bootstrap" && m === "GET") return await bootstrap(env, url);
      if (p[0] === "stats" && m === "GET") return await stats(env);
      if (p[0] === "companies" && p[1]) {
        if (!p[2] && m === "PUT") return await updateCompany(env, actor, p[1], await body<CompanyIn>(req));
        if (p[2] === "settle-sage" && m === "POST") return await settleHistoricalSageInvoices(env, actor, p[1], await body<{ beforeDate: string; action?: "settle" | "unsettle"; customerId?: number }>(req));
      }
      if (p[0] === "settings" && p[1] === "test-email" && m === "POST") {
        return await sendTestEmail(env, actor, await body<{ companyId?: string; toEmail?: string }>(req), url);
      }
      if (p[0] === "documents") {
        if (m === "POST" && id === undefined) return await createDocument(env, actor, await body<DocIn>(req));
        if (id !== undefined && p[2] === "payments" && !p[3] && m === "POST") return await addPayment(env, actor, id, await body<PaymentIn>(req));
        if (id !== undefined && p[2] === "payments" && p[3] && /^\d{1,15}$/.test(p[3]) && m === "DELETE") return await voidPayment(env, actor, id, Number(p[3]));
        if (id !== undefined && p[2] === "send" && m === "POST") return await sendDocument(env, actor, id, await body<SendIn>(req), url);
        if (id !== undefined && p[2] === "issue" && m === "POST") return await issueDocument(env, actor, id, (await body<{ version: number }>(req)).version);
        if (id !== undefined && m === "GET") return await getDocument(env, id);
        if (id !== undefined && m === "PUT") return await updateDocument(env, actor, id, await body<DocIn>(req));
        if (id !== undefined && m === "DELETE") return await deleteDraft(env, actor, id);
      }
      if (p[0] === "customers") {
        if (id !== undefined && p[2] === "statement" && p[3] === "send" && m === "POST") return await sendCustomerStatement(env, actor, id, await body<any>(req), url);
        if (id !== undefined && p[2] === "statement" && m === "GET") return await getCustomerStatement(env, id, url);
        if (m === "POST" && id === undefined) return await saveCustomer(env, actor, await body<CustomerIn>(req));
        if (m === "PUT" && id !== undefined) return await saveCustomer(env, actor, await body<CustomerIn>(req), id);
      }
      if (p[0] === "items") {
        if (m === "POST" && id === undefined) return await saveItem(env, actor, await body<ItemIn>(req));
        if (m === "PUT" && id !== undefined) return await saveItem(env, actor, await body<ItemIn>(req), id);
      }
      if (p[0] === "recurring") {
        if (p[1] === "preview" && m === "GET") {
          const co = url.searchParams.get("company") ?? "logia-services";
          return json(await previewRecurringRun(env, co, url.searchParams.get("date") ?? undefined));
        }
        if (p[1] === "run" && m === "POST") {
          const b = await body<{ companyId?: string; date?: string }>(req);
          return json(await runRecurringBatch(env, actor, b?.companyId ?? "logia-services", b?.date));
        }
        if (!p[1] && m === "POST") return await saveRecurring(env, actor, await body<RecurringIn>(req));
        if (id !== undefined && !p[2] && m === "PUT") return await saveRecurring(env, actor, await body<RecurringIn>(req), id);
        if (id !== undefined && p[2] === "toggle" && m === "POST") return await toggleRecurring(env, actor, id, !!(await body<{ active: boolean }>(req)).active);
        if (id !== undefined && !p[2] && m === "DELETE") return await deleteRecurring(env, actor, id);
      }
      if (p[0] === "bank") {
        if (p[1] === "import" && m === "POST") return await handleBankImport(env, actor, await body<BankImportIn>(req));
        if (p[1] === "transactions" && m === "GET") return await listBankTransactions(env, url.searchParams.get("company") ?? "logia-services", url.searchParams.get("status") ?? undefined);
        if (p[1] === "match" && m === "POST") return await handleBankMatch(env, actor, await body<{ transactionId: number; documentId: number; amountCents?: number; note?: string }>(req));
        if (p[1] === "ignore" && m === "POST") return await handleBankIgnore(env, actor, await body<{ transactionId: number }>(req));
        if (p[1] === "unmatch" && m === "POST") return await handleBankUnmatch(env, actor, await body<{ transactionId: number }>(req));
      }
      if (p[0] === "import" && p[1] && m === "POST") return await importChunk(env, actor, p[1], await body(req));
      throw new HttpError(404, "Not found");
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.message }, e.status);
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE")) return json({ error: "That record already exists." }, 409);
      console.error("Unhandled worker error:", e);
      return json({ error: "Something went wrong on the server. Nothing was changed — please try again." }, 500);
    }
  },
};
