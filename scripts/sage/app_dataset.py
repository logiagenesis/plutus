"""Build the compact dataset the prototype app reads (app/src/data/company-data.json, gitignored).
Usage: python3 app_dataset.py <plutus_import.json> <out.json>"""
import json, sys
N = json.load(open(sys.argv[1]))
def doc(d, extra=()):
    o = {k: d[k] for k in ("sageId", "number", "customerSageId", "customerName", "date", "dueDate", "expiryDate", "reference",
                           "discountCents", "exclusiveCents", "taxCents", "totalCents", "amountDueCents", "sageStatus", "fromDocument") if k in d}
    o["lines"] = [{k: l[k] for k in ("description", "comments", "itemSageId", "unit", "quantity", "unitPriceExclCents",
                                     "discountPercent", "exclusiveCents", "taxRate", "taxCents", "totalCents")} for l in d["lines"]]
    for k in extra: o[k] = d.get(k)
    return o
out = {
    "sourceExtractedAt": N["sourceExtractedAt"], "companies": N["companies"],
    "customers": [{k: c[k] for k in ("sageId", "name", "category", "contactName", "email", "telephone", "mobile", "vatNumber",
                                     "postalAddress", "deliveryAddress", "active", "sageBalanceCents")} for c in N["customers"]],
    "items": [{k: i[k] for k in ("sageId", "code", "description", "category", "unit", "priceExclCents", "salesTaxSageTypeId", "active")} for i in N["items"]],
    "recurring": [doc(r, ("frequency", "startDate", "lastRunDate", "active", "message")) for r in N["recurringTemplates"]],
    "invoices": [doc(d) for d in N["invoices"]],
    "quotes": [doc(d) for d in N["quotes"]],
    "creditNotes": [doc(d) for d in N["creditNotes"]],
    "invoiceMessage": next((d["message"] for d in sorted(N["invoices"], key=lambda x: x["date"], reverse=True) if d.get("message")), None),
}
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
print(sys.argv[2], len(json.dumps(out)))
