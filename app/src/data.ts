// Loads the company dataset. The real Logia Services data (imported from Sage) lives in
// src/data/company-data.json, which is git-ignored and never committed.
import raw from "./data/company-data.json";

export type Line = {
  description: string; comments: string | null; itemSageId: number | null; unit: string | null;
  quantity: string; unitPriceExclCents: number; discountPercent: string;
  exclusiveCents: number; taxRate: string; taxCents: number; totalCents: number;
};
export type Doc = {
  sageId: number; number: string; customerSageId: number; customerName?: string; date: string;
  dueDate?: string | null; expiryDate?: string | null; reference: string | null;
  discountCents: number; exclusiveCents: number; taxCents: number; totalCents: number;
  amountDueCents: number | null; sageStatus: string | null; fromDocument: string | null; lines: Line[];
};
export type Recurring = Doc & { frequency: string; startDate: string; lastRunDate: string | null; active: boolean; message: string | null };
export type Customer = {
  sageId: number; name: string; category: string | null; contactName: string | null; email: string | null;
  telephone: string | null; mobile: string | null; vatNumber: string | null;
  postalAddress: string[] | null; deliveryAddress: string[] | null; active: boolean; sageBalanceCents: number;
};
export type Item = { sageId: number; code: string | null; description: string; category: string | null; unit: string | null; priceExclCents: number; salesTaxSageTypeId: number; active: boolean };
export type Company = { id: string; displayName: string; registeredName?: string; registrationNumber?: string; email?: string; telephone?: string; address?: string[] | null; note?: string };

type Data = {
  sourceExtractedAt: string; companies: Company[]; customers: Customer[]; items: Item[];
  recurring: Recurring[]; invoices: Doc[]; quotes: Doc[]; creditNotes: Doc[]; invoiceMessage: string | null;
};
export const data = raw as unknown as Data;

export const customersById = new Map(data.customers.map((c) => [c.sageId, c]));
export const itemsById = new Map(data.items.map((i) => [i.sageId, i]));
export const customerName = (id: number, fallback?: string) => customersById.get(id)?.name ?? fallback ?? "Unknown customer";

const byDateDesc = (a: Doc, b: Doc) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.number.localeCompare(a.number));
export const invoices = [...data.invoices].sort(byDateDesc);
export const quotes = [...data.quotes].sort(byDateDesc);

// Next numbers continue Sage's sequences.
function nextNumber(prefix: string, docs: Doc[]) {
  const nums = docs.map((d) => d.number).filter((n) => n.startsWith(prefix));
  const max = nums.reduce((m, n) => Math.max(m, parseInt(n.slice(prefix.length), 10) || 0), 0);
  const width = Math.max(...nums.map((n) => n.length - prefix.length));
  return prefix + String(max + 1).padStart(width, "0");
}
export const nextInvoiceNumber = () => nextNumber("INV", data.invoices);
export const nextQuoteNumber = () => nextNumber("QUO", data.quotes);

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
export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
// Add months, clamping to month end (31 Jan + 1 month → 28/29 Feb).
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
  const step = r.frequency === "annually" ? 12 : 1;
  return addMonths(r.lastRunDate, step, day);
}

// ── Plain-language statuses ──
export type Tone = "ok" | "warn" | "bad" | "info" | "plain";
export function invoiceStatus(d: Doc): { label: string; tone: Tone } {
  if (d.sageStatus === "Paid") return { label: "Paid", tone: "ok" };
  if (d.sageStatus === "Partially Paid") return { label: "Part paid", tone: "info" };
  return { label: "Not checked", tone: "plain" };
}
export function quoteStatus(d: Doc): { label: string; tone: Tone } {
  if (d.sageStatus === "Invoiced") return { label: "Accepted", tone: "ok" };
  if (d.sageStatus === "Pending") return { label: "Waiting for customer", tone: "info" };
  if (d.sageStatus === "Expired") return { label: "Expired", tone: "plain" };
  return { label: d.sageStatus ?? "—", tone: "plain" };
}
