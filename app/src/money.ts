// Money rules for Plutus.
// All stored amounts are integer cents. Quantities, unit prices, discount % and tax rate
// are combined with exact integer arithmetic, then rounded half-up to the cent per line,
// matching how Sage Business Cloud Accounting computed every line in the imported history.

export type LineInput = {
  quantity: string;          // decimal string, e.g. "1", "2.5"
  unitPriceExclCents: number;
  discountPercent: string;   // decimal string, e.g. "0", "50"
  taxRate: string;           // fraction string, e.g. "0.15" or "0"
};

export type LineAmounts = {
  grossCents: number;
  discountCents: number;
  exclusiveCents: number;
  taxCents: number;
  totalCents: number;
};

// Parse a non-negative decimal string into [integer numerator, power-of-ten scale].
function parseDecimal(s: string): [bigint, bigint] {
  const t = String(s ?? "0").trim() || "0";
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`Invalid number: ${s}`);
  const [whole, frac = ""] = t.split(".");
  return [BigInt(whole + frac), 10n ** BigInt(frac.length)];
}

// Round numerator/denominator half-up to an integer (inputs non-negative).
function roundHalfUp(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (den * 2n);
}

export function calcLine(l: LineInput): LineAmounts {
  const [qn, qd] = parseDecimal(l.quantity);
  const gross = roundHalfUp(qn * BigInt(l.unitPriceExclCents), qd);
  const [dn, dd] = parseDecimal(l.discountPercent);
  // Sage rounds the discounted amount (not the discount) half-up; the discount is the remainder.
  if (dn > dd * 100n) throw new Error("Discount above 100%");
  const exclusive = roundHalfUp(gross * (dd * 100n - dn), dd * 100n);
  const discount = gross - exclusive;
  const [rn, rd] = parseDecimal(l.taxRate);
  const tax = roundHalfUp(exclusive * rn, rd);
  return {
    grossCents: Number(gross),
    discountCents: Number(discount),
    exclusiveCents: Number(exclusive),
    taxCents: Number(tax),
    totalCents: Number(exclusive + tax),
  };
}

export function calcDocument(lines: LineInput[]) {
  const per = lines.map(calcLine);
  const sum = (k: keyof LineAmounts) => per.reduce((a, x) => a + x[k], 0);
  return {
    lines: per,
    discountCents: sum("discountCents"),
    exclusiveCents: sum("exclusiveCents"),
    taxCents: sum("taxCents"),
    totalCents: sum("totalCents"),
  };
}

const fmt = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });

// "R 1,234.56" — Sage's style on Logia's documents (comma thousands, point decimals).
export function rand(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}R ${whole}.${dec}`;
}

export function randShort(cents: number): string {
  const r = cents / 100;
  if (Math.abs(r) >= 1_000_000) return `R ${(r / 1_000_000).toFixed(2)}m`;
  return rand(cents).replace(/\.00$/, "");
}

export { fmt as _intl };
