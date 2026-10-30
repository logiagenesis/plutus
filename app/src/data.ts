// Data store: loaded from the Plutus API (Cloudflare D1) and kept in memory.
// Components read the exported collections; after any change the store reloads and the app re-renders.

export type Line = {
  description: string; comments: string | null; itemSageId: number | null; unit: string | null;
  quantity: string; unitPriceExclCents: number; discountPercent: string;
  exclusiveCents: number; taxRate: string; taxCents: number; totalCents: number;
};
export type Doc = {
  sageId: number; // internal document id (kept name for compatibility)
  kind: "invoice" | "quote" | "credit_note";
  status: "draft" | "issued" | "void";
  number: string; customerSageId: number; customerName?: string; date: string;
  dueDate?: string | null; expiryDate?: string | null; reference: string | null;
  discountCents: number; exclusiveCents: number; taxCents: number; totalCents: number;
  amountDueCents: number | null; sageStatus: string | null; fromDocument: string | null; lines: Line[];
  firstLine?: string | null; lineCount?: number; version: number; message?: string | null; vat?: boolean;
  source?: "app" | "sage"; paidCents?: number; payments?: Payment[];
  customerSnapshot?: Snapshot | null; companySnapshot?: CompanySnapshot | null;
};
export type Payment = { id: number; date: string; amountCents: number; method: string | null; reference: string | null; note: string | null; createdBy: string; createdAt: string; voidedAt: string | null };
export type Snapshot = { name: string; contact: string | null; email: string | null; vat: string | null; postal: string[] | null; delivery: string[] | null };
export type CompanySnapshot = { id: string; displayName: string; registeredName: string | null; registrationNumber: string | null; vatNumber: string | null; email: string | null; telephone: string | null; address: string[] | null };
const parseObj = <T,>(s: unknown): T | null => { if (typeof s !== "string" || !s) return null; try { return JSON.parse(s) as T; } catch { return null; } };
const mapPayment = (p: any): Payment => ({ id: p.id, date: p.date, amountCents: p.amount_cents, method: p.method, reference: p.reference, note: p.note, createdBy: p.created_by, createdAt: p.created_at, voidedAt: p.voided_at });
/** What is still owed on an issued invoice, from payments recorded in Plutus. */
export const openCents = (d: Doc) => Math.max(0, d.totalCents - (d.paidCents ?? 0));
export type Recurring = Doc & { frequency: string; startDate: string; lastRunDate: string | null; active: boolean; message: string | null };
export type Customer = {
  sageId: number; name: string; category: string | null; contactName: string | null; email: string | null;
  telephone: string | null; mobile: string | null; vatNumber: string | null;
  postalAddress: string[] | null; deliveryAddress: string[] | null; active: boolean; sageBalanceCents: number | null; version: number;
};
export type Item = { sageId: number; code: string | null; description: string; category: string | null; unit: string | null; priceExclCents: number; active: boolean; version: number };
export type Company = { id: string; displayName: string; registeredName?: string | null; registrationNumber?: string | null; email?: string | null; telephone?: string | null; address?: string[] | null; setUp: boolean; defaultMessage?: string | null };

type Data = { companyId: string; companies: Company[]; customers: Customer[]; items: Item[]; recurring: Recurring[]; documents: Doc[]; invoiceMessage: string | null; sequences: { kind: string; prefix: string; width: number; next_value: number }[] };

// ── API client ──
export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api/${path}`, { method: init?.method ?? "GET", headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your internet connection and try again.");
  }
  const text = await r.text();
  let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (r.status === 401 && !path.startsWith("auth/")) window.dispatchEvent(new Event("plutus:signed-out"));
  if (!r.ok) throw new ApiError(r.status, j?.error ?? (r.status === 401 || r.status === 403 ? "Please sign in again." : `Server error (${r.status}).`));
  return j as T;
}

const parseAddr = (s: string | null): string[] | null => { if (!s) return null; try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch { return null; } };
const mapLine = (l: any): Line => ({ description: l.description, comments: l.comments, itemSageId: l.item_id, unit: l.unit, quantity: l.quantity, unitPriceExclCents: l.unit_price_excl_cents, discountPercent: l.discount_percent, exclusiveCents: l.exclusive_cents, taxRate: l.tax_rate, taxCents: l.tax_cents, totalCents: l.total_cents });
export const mapDoc = (d: any): Doc => ({
  sageId: d.id, kind: d.kind, status: d.status, number: d.number ?? "Draft", customerSageId: d.customer_id, date: d.date, dueDate: d.due_date, expiryDate: d.kind === "quote" ? d.due_date : null,
  reference: d.reference, discountCents: d.discount_cents ?? 0, exclusiveCents: d.exclusive_cents ?? 0, taxCents: d.tax_cents, totalCents: d.total_cents, amountDueCents: d.sage_amount_due_cents ?? null,
  sageStatus: d.sage_status, fromDocument: d.from_number, lines: Array.isArray(d.lines) ? d.lines.map(mapLine) : [], firstLine: d.first_line, lineCount: d.line_count, version: d.version,
  message: d.message, vat: d.vat_rate ? d.vat_rate !== "0" : (d.tax_cents ?? 0) > 0,
  source: d.source, payments: Array.isArray(d.payments) ? d.payments.map(mapPayment) : undefined,
  paidCents: Array.isArray(d.payments) ? d.payments.filter((p: any) => !p.voided_at).reduce((a: number, p: any) => a + p.amount_cents, 0) : (d.paid_cents ?? 0),
  customerSnapshot: parseObj<Snapshot>(d.customer_snapshot_json), companySnapshot: parseObj<CompanySnapshot>(d.company_snapshot_json),
});

// Mutable store (module-level so existing selectors keep working).
export let data: Data = { companyId: "logia-services", companies: [], customers: [], items: [], recurring: [], documents: [], invoiceMessage: null, sequences: [] };
export let customersById = new Map<number, Customer>();
export let itemsById = new Map<number, Item>();
export let invoices: Doc[] = [];
export let quotes: Doc[] = [];

export async function loadData(companyId: string) {
  const b = await api<any>(`bootstrap?company=${encodeURIComponent(companyId)}`);
  const companies: Company[] = b.companies.map((c: any) => ({ id: c.id, displayName: c.display_name, registeredName: c.registered_name, registrationNumber: c.registration_number, email: c.email, telephone: c.telephone, address: parseAddr(c.address_json), setUp: !!c.set_up, defaultMessage: c.default_message }));
  const customers: Customer[] = b.customers.map((c: any) => ({ sageId: c.id, name: c.name, category: c.category, contactName: c.contact_name, email: c.email, telephone: c.telephone, mobile: c.mobile, vatNumber: c.vat_number, postalAddress: parseAddr(c.postal_address_json), deliveryAddress: parseAddr(c.delivery_address_json), active: !!c.active, sageBalanceCents: c.sage_balance_cents, version: c.version }));
  const items: Item[] = b.items.map((i: any) => ({ sageId: i.id, code: i.code, description: i.description, category: i.category, unit: i.unit, priceExclCents: i.price_excl_cents, active: !!i.active, version: i.version }));
  const linesBy = new Map<number, Line[]>();
  for (const l of b.recurringLines) { const a = linesBy.get(l.template_id) ?? []; a.push(mapLine(l)); linesBy.set(l.template_id, a); }
  const recurring: Recurring[] = b.recurring.map((r: any) => ({
    ...mapDoc({ ...r, kind: "invoice", status: "issued", number: r.sage_number, due_date: null, sage_status: null, from_number: null }),
    lines: linesBy.get(r.id) ?? [], frequency: r.frequency, startDate: r.start_date, lastRunDate: r.last_run_date, active: !!r.active, message: r.message,
  }));
  const documents: Doc[] = b.documents.map(mapDoc);
  const co = companies.find((c) => c.id === companyId);
  data = { companyId, companies, customers, items, recurring, documents, invoiceMessage: co?.defaultMessage ?? null, sequences: b.sequences };
  customersById = new Map(customers.map((c) => [c.sageId, c]));
  itemsById = new Map(items.map((i) => [i.sageId, i]));
  invoices = documents.filter((d) => d.kind === "invoice");
  quotes = documents.filter((d) => d.kind === "quote");
}

export const customerName = (id: number, fallback?: string) => customersById.get(id)?.name ?? fallback ?? "Unknown customer";
export function nextNumber(kind: "invoice" | "quote") {
  const s = data.sequences.find((x) => x.kind === kind);
  return s ? s.prefix + String(s.next_value).padStart(s.width, "0") : "";
}

// ── Dates ──
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function dateParts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, month: MONTHS_LONG[m - 1], monthShort: MONTHS[m - 1], d, weekday: DAYS[dow] };
}
function addMonths(iso: string, n: number, day: number) {
  const [y, m] = iso.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
export function nextRun(r: Recurring): string | null {
  if (!r.active) return null;
  const day = Number(r.startDate.slice(8, 10));
  if (!r.lastRunDate) return r.startDate;
  return addMonths(r.lastRunDate, r.frequency === "annually" ? 12 : 1, day);
}

// ── Plain-language statuses ──
export type Tone = "ok" | "warn" | "bad" | "info" | "plain";
export function invoiceStatus(d: Doc): { label: string; tone: Tone } {
  if (d.status === "draft") return { label: "Draft", tone: "info" };
  const paid = d.paidCents ?? 0;
  if (paid > 0 && paid >= d.totalCents) return { label: "Paid", tone: "ok" };
  if (paid > 0) return { label: "Part paid", tone: "info" };
  if (d.sageStatus === "Paid") return { label: "Paid", tone: "ok" };
  if (d.sageStatus === "Partially Paid") return { label: "Part paid", tone: "info" };
  if (d.source === "app") return d.dueDate && d.dueDate < todayISO() ? { label: "Overdue", tone: "bad" } : { label: "Unpaid", tone: "warn" };
  return { label: "Not checked", tone: "plain" };
}
export function quoteStatus(d: Doc): { label: string; tone: Tone } {
  if (d.status === "draft") return { label: "Draft", tone: "info" };
  if (d.sageStatus === "Invoiced") return { label: "Accepted", tone: "ok" };
  if (d.sageStatus === "Pending") return { label: "Waiting for customer", tone: "info" };
  if (d.sageStatus === "Expired") return { label: "Expired", tone: "plain" };
  if (!d.sageStatus) return { label: "Issued", tone: "info" }; // "Sent" only once emailing exists and an email actually went out
  return { label: d.sageStatus, tone: "plain" };
}
