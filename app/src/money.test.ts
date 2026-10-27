import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { calcLine, calcDocument, rand } from "./money";

describe("calcLine", () => {
  it("handles quantity × price with no tax", () => {
    expect(calcLine({ quantity: "5", unitPriceExclCents: 19500, discountPercent: "0", taxRate: "0" }))
      .toEqual({ grossCents: 97500, discountCents: 0, exclusiveCents: 97500, taxCents: 0, totalCents: 97500 });
  });
  it("applies a 50% discount", () => {
    const r = calcLine({ quantity: "2", unitPriceExclCents: 60000, discountPercent: "50", taxRate: "0" });
    expect(r.exclusiveCents).toBe(60000);
    expect(r.discountCents).toBe(60000);
  });
  it("adds 15% VAT", () => {
    expect(calcLine({ quantity: "1", unitPriceExclCents: 25900, discountPercent: "0", taxRate: "0.15" }).totalCents).toBe(29785);
  });
  it("rounds half up to the cent", () => {
    // 0.5 × R0.01 = 0.5c → 1c
    expect(calcLine({ quantity: "0.5", unitPriceExclCents: 1, discountPercent: "0", taxRate: "0" }).exclusiveCents).toBe(1);
    // 15% of 3c = 0.45c → 0c
    expect(calcLine({ quantity: "1", unitPriceExclCents: 3, discountPercent: "0", taxRate: "0.15" }).taxCents).toBe(0);
  });
  it("rejects malformed numbers", () => {
    expect(() => calcLine({ quantity: "1e3", unitPriceExclCents: 1, discountPercent: "0", taxRate: "0" })).toThrow();
  });
});

describe("calcDocument", () => {
  it("sums lines", () => {
    const d = calcDocument([
      { quantity: "5", unitPriceExclCents: 19500, discountPercent: "0", taxRate: "0" },
      { quantity: "1", unitPriceExclCents: 16500, discountPercent: "0", taxRate: "0" },
      { quantity: "2", unitPriceExclCents: 60000, discountPercent: "50", taxRate: "0" },
    ]);
    expect(d.totalCents).toBe(174000);
  });
});

describe("rand", () => {
  it("formats rands", () => {
    expect(rand(115755126)).toBe("R 1,157,551.26");
    expect(rand(0)).toBe("R 0.00");
    expect(rand(-5)).toBe("-R 0.05");
  });
});

// Reproduce every line and document Sage calculated. Runs only where the private dataset exists.
const DATA = new URL("./data/company-data.json", import.meta.url);
const has = existsSync(DATA);
describe.skipIf(!has)("matches Sage history", () => {
  it("recomputes every imported line and document total exactly", () => {
    const D = JSON.parse(readFileSync(DATA, "utf8"));
    let lines = 0, docs = 0;
    for (const kind of ["invoices", "quotes", "recurring", "creditNotes"]) {
      for (const d of D[kind]) {
        const r = calcDocument(d.lines);
        d.lines.forEach((l: any, i: number) => {
          expect(r.lines[i].exclusiveCents, `${d.number} line ${i + 1}`).toBe(l.exclusiveCents);
          expect(r.lines[i].taxCents, `${d.number} line ${i + 1} tax`).toBe(l.taxCents);
          lines++;
        });
        expect(r.totalCents, d.number).toBe(d.totalCents);
        docs++;
      }
    }
    expect(lines).toBe(3100);
    expect(docs).toBe(961);
  });
});
