import { calcDocument } from "../src/money";
import { AuthError, type Env } from "./auth";
import { handleBackup, handleRestore } from "./backup";
import { handleAuth, requireSession } from "./login";
import { ensureSchema } from "./schema";

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

function validateDoc(d: DocIn) {
  if (!["invoice", "quote", "credit_note"].includes(d.kind)) throw bad("Unknown document type");
  if (!Number.isSafeInteger(d.customerId)) throw bad("Choose a customer");
  if (!isCalendarDate(d.date)) throw bad("The date is not a real date");
  if (d.dueDate && !isCalendarDate(d.dueDate)) throw bad("The due date is not a real date");
  if (d.dueDate && d.dueDate < d.date) throw bad(d.kind === "quote" ? "Valid-until date is before the quote date" : "Due date is before the invoice date");
  if (!Array.isArray(d.lines) || d.lines.length === 0) throw bad("Add at least one line");
  if (d.lines.length > 200) throw bad("Too many lines");
  const taxRate = d.vat ? "0.15" : "0";
  const lines = d.lines.map((l, i) => {
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
    env.DB.prepare(`SELECT d.id, d.kind, d.number, d.status, d.customer_id, d.date, d.due_date, d.reference, d.tax_cents, d.total_cents, d.sage_status, d.from_number, d.version, d.source,
        (SELECT description FROM document_lines WHERE document_id = d.id AND line_no = 1) AS first_line,
        (SELECT COUNT(*) FROM document_lines WHERE document_id = d.id) AS line_count,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE document_id = d.id AND voided_at IS NULL) AS paid_cents
      FROM documents d WHERE d.company_id = ? ORDER BY d.date DESC, d.id DESC`).bind(company),
    env.DB.prepare("SELECT kind, prefix, width, next_value FROM number_sequences WHERE company_id = ?").bind(company),
  ]);
  return json({ company, companies: companies.results, customers: customers.results, items: items.results, recurring: recurring.results, recurringLines: rlines.results, documents: docs.results, sequences: seqs.results });
}

async function getDocument(env: Env, id: number, extra: Record<string, unknown> = {}) {
  const [d, lines, pays] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM documents WHERE id = ?").bind(id),
    env.DB.prepare("SELECT * FROM document_lines WHERE document_id = ? ORDER BY line_no").bind(id),
    env.DB.prepare("SELECT id, date, amount_cents, method, reference, note, created_by, created_at, voided_at, voided_by FROM payments WHERE document_id = ? ORDER BY date, id").bind(id),
  ]);
  if (!d.results[0]) throw new HttpError(404, "Document not found");
  return json({ ...d.results[0], lines: lines.results, payments: pays.results, ...extra });
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
      company_snapshot_json = (SELECT json_object('id', id, 'displayName', display_name, 'registeredName', registered_name, 'registrationNumber', registration_number, 'vatNumber', vat_number, 'email', email, 'telephone', telephone, 'address', json(address_json)) FROM companies WHERE id = documents.company_id)
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

// ───────── payments (manual, until bank-statement matching exists) ─────────
type PaymentIn = { date: string; amountCents: number; method?: string | null; reference?: string | null; note?: string | null; clientKey?: string };

async function addPayment(env: Env, actor: string, docId: number, p: PaymentIn) {
  const d = await env.DB.prepare("SELECT company_id, kind, status, total_cents FROM documents WHERE id = ?").bind(docId).first<{ company_id: string; kind: string; status: string; total_cents: number }>();
  if (!d) throw new HttpError(404, "Document not found");
  if (d.kind !== "invoice" || d.status !== "issued") throw bad("Payments can only be recorded against issued invoices");
  if (!isCalendarDate(p.date)) throw bad("The payment date is not a real date");
  const amount = int(p.amountCents, "Amount");
  if (amount <= 0) throw bad("Enter an amount above R 0.00");
  const key = typeof p.clientKey === "string" && /^[A-Za-z0-9-]{16,64}$/.test(p.clientKey) ? p.clientKey : crypto.randomUUID();
  // Never more than what is still open on the invoice; checked inside the INSERT so two clicks can't both pass.
  const r = await env.DB.prepare(`INSERT INTO payments (company_id, document_id, date, amount_cents, method, reference, note, client_key, created_by)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM payments WHERE client_key = ?)
      AND ? <= (SELECT total_cents FROM documents WHERE id = ?) - (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE document_id = ? AND voided_at IS NULL)`)
    .bind(d.company_id, docId, p.date, amount, str(p.method, 40), str(p.reference, 120), str(p.note, 500), key, actor, key, amount, docId, docId).run();
  if (r.meta.changes !== 1) {
    const dup = await env.DB.prepare("SELECT id FROM payments WHERE client_key = ?").bind(key).first();
    if (!dup) throw new HttpError(409, "That is more than what is still owed on this invoice.");
  } else await audit(env, actor, "payment_add", "document", docId, { amount, date: p.date }).run();
  return getDocument(env, docId);
}

async function voidPayment(env: Env, actor: string, docId: number, paymentId: number) {
  const r = await env.DB.prepare("UPDATE payments SET voided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), voided_by = ? WHERE id = ? AND document_id = ? AND voided_at IS NULL").bind(actor, paymentId, docId).run();
  if (r.meta.changes !== 1) throw new HttpError(409, "That payment was not found or was already removed.");
  await audit(env, actor, "payment_void", "document", docId, { paymentId }).run();
  return getDocument(env, docId);
}

async function deleteDraft(env: Env, actor: string, id: number) {
  const r = await env.DB.batch([
    env.DB.prepare("DELETE FROM document_lines WHERE document_id = ? AND (SELECT status FROM documents WHERE id = ?) = 'draft'").bind(id, id),
    env.DB.prepare("DELETE FROM documents WHERE id = ? AND status = 'draft'").bind(id),
  ]);
  if (r[1].meta.changes === 1) await audit(env, actor, "delete_draft", "document", id).run();
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
  const r = await env.DB.prepare(`UPDATE customers SET name=?, category=?, contact_name=?, email=?, telephone=?, mobile=?, vat_number=?, postal_address_json=?, active=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?`)
    .bind(...vals, c.active === false ? 0 : 1, id, c.version ?? -1).run();
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
  const r = await env.DB.prepare(`UPDATE items SET code=?, description=?, category=?, unit=?, price_excl_cents=?, active=?, version=version+1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND version=?`)
    .bind(...vals, i.active === false ? 0 : 1, id, i.version ?? -1).run();
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
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      // Same-origin writes only (the login cookie is SameSite=Strict too; this blocks cross-site posts).
      if (req.method !== "GET") {
        const origin = req.headers.get("Origin");
        if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request refused");
        if ((req.method === "POST" || req.method === "PUT") && !(req.headers.get("content-type") ?? "").includes("application/json")) throw new HttpError(415, "JSON expected");
      }
      const p = url.pathname.split("/").filter(Boolean).slice(1); // after "api"
      if (p[0] === "auth") { const r = await handleAuth(req, env, p[1] ?? ""); if (r) return r; throw new HttpError(404, "Not found"); }
      if (p[0] === "restore") return await handleRestore(req, env, p[1] ?? "");
      const actor = await requireSession(req, env);
      await ensureSchema(env);
      if (p[0] === "backup" && req.method === "GET") return await handleBackup(env, url, p[1] ?? "");
      const id = p[1] && /^\d{1,15}$/.test(p[1]) ? Number(p[1]) : undefined;
      if (p[1] && id === undefined && p[0] !== "import") throw new HttpError(404, "Not found");
      const m = req.method;
      if (p[0] === "me" && m === "GET") return await json({ email: actor });
      if (p[0] === "bootstrap" && m === "GET") return await bootstrap(env, url);
      if (p[0] === "stats" && m === "GET") return await stats(env);
      if (p[0] === "documents") {
        if (m === "POST" && id === undefined) return await createDocument(env, actor, await body<DocIn>(req));
        if (id !== undefined && p[2] === "payments" && !p[3] && m === "POST") return await addPayment(env, actor, id, await body<PaymentIn>(req));
        if (id !== undefined && p[2] === "payments" && p[3] && /^\d{1,15}$/.test(p[3]) && m === "DELETE") return await voidPayment(env, actor, id, Number(p[3]));
        if (id !== undefined && p[2] === "issue" && m === "POST") return await issueDocument(env, actor, id, (await body<{ version: number }>(req)).version);
        if (id !== undefined && m === "GET") return await getDocument(env, id);
        if (id !== undefined && m === "PUT") return await updateDocument(env, actor, id, await body<DocIn>(req));
        if (id !== undefined && m === "DELETE") return await deleteDraft(env, actor, id);
      }
      if (p[0] === "customers") {
        if (m === "POST" && id === undefined) return await saveCustomer(env, actor, await body<CustomerIn>(req));
        if (m === "PUT" && id !== undefined) return await saveCustomer(env, actor, await body<CustomerIn>(req), id);
      }
      if (p[0] === "items") {
        if (m === "POST" && id === undefined) return await saveItem(env, actor, await body<ItemIn>(req));
        if (m === "PUT" && id !== undefined) return await saveItem(env, actor, await body<ItemIn>(req), id);
      }
      if (p[0] === "import" && p[1] && m === "POST") return await importChunk(env, actor, p[1], await body(req));
      throw new HttpError(404, "Not found");
    } catch (e) {
      if (e instanceof AuthError) return json({ error: e.message }, e.status);
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      const msg = e instanceof Error ? e.message : String(e);
      if (/UNIQUE constraint failed/.test(msg)) return json({ error: "That number is already used." }, 409);
      console.error(msg);
      return json({ error: "Something went wrong on the server. Nothing was saved." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
