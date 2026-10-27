"""Normalise a Sage Business Cloud Accounting (ZA) JSON export into the Accounting666 import format.

Usage: python3 normalize.py <sage_export.json> <out_dir>
Money is converted to integer cents with exact Decimal arithmetic; the script fails if any
value has more than 2 decimals or if any document's lines do not reconcile to its header.
Real customer data must never be committed to Git; out_dir belongs in Drive only.
"""
import json, sys, hashlib, os
from decimal import Decimal, ROUND_HALF_UP

COMPANY_ID = "logia-services"
PLACEHOLDER_EMAILS = {"blank@blank.co.za", "email@email.com", "email@email.co.za"}
FREQ = {5: "monthly", 9: "annually"}  # observed: 'Monthly' / 'annual' references match these ids


def cents(x):
    d = Decimal(str(x)) * 100
    if d != d.to_integral_value():
        raise ValueError(f"sub-cent amount {x}")
    return int(d)


def qty(x):  # quantities kept as exact decimal strings
    return format(Decimal(str(x)).normalize(), "f")


def clean(s):
    s = (s or "").strip()
    return s or None


def addr(o, p):
    lines = [clean(o.get(f"{p}{i:02d}")) for i in range(1, 6)]
    return [l for l in lines if l] or None


def email(e):
    e = clean(e)
    return None if (e or "").lower() in PLACEHOLDER_EMAILS else e


def lines(doc, kind):
    out = []
    for n, l in enumerate(doc["Lines"], 1):
        gross = (Decimal(str(l["Quantity"])) * Decimal(str(l["UnitPriceExclusive"]))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        if abs(gross - Decimal(str(l["Discount"])) - Decimal(str(l["Exclusive"]))) > Decimal("0.01"):
            raise ValueError(f"{kind} {doc['DocumentNumber']} line {n} does not reconcile")
        out.append({
            "lineNo": n, "description": l["Description"], "comments": clean(l.get("Comments")),
            "itemSageId": l.get("SelectionId"), "unit": clean(l.get("Unit")),
            "quantity": qty(l["Quantity"]), "unitPriceExclCents": cents(l["UnitPriceExclusive"]),
            "discountPercent": format((Decimal(str(l["DiscountPercentage"])) * 100).normalize(), "f"),
            "discountCents": cents(l["Discount"]), "exclusiveCents": cents(l["Exclusive"]),
            "taxRate": str(Decimal(str(l["TaxPercentage"]))), "taxSageTypeId": l["TaxTypeId"],
            "taxCents": cents(l["Tax"]), "totalCents": cents(l["Total"]),
        })
    t = sum(x["totalCents"] for x in out)
    if abs(t - cents(doc["Discount"]) + cents(doc["Rounding"]) - cents(doc["Total"])) > 2 and t != cents(doc["Total"]):
        raise ValueError(f"{kind} {doc['DocumentNumber']} header does not reconcile")
    return out


def header(d, kind):
    return {
        "sageId": d["ID"], "companyId": COMPANY_ID, "number": d["DocumentNumber"], "customerSageId": d.get("CustomerId"),
        "customerName": d.get("CustomerName"), "date": d["Date"][:10], "dueDate": (d.get("DueDate") or "")[:10] or None,
        "expiryDate": (d.get("ExpiryDate") or "")[:10] or None, "reference": clean(d.get("Reference")),
        "message": clean(d.get("Message")), "pricesInclusive": d["Inclusive"],
        "discountCents": cents(d["Discount"]), "exclusiveCents": cents(d["Exclusive"]), "taxCents": cents(d["Tax"]),
        "roundingCents": cents(d["Rounding"]), "totalCents": cents(d["Total"]),
        "amountDueCents": cents(d["AmountDue"]) if "AmountDue" in d else None,
        "sageStatus": d.get("Status"), "fromDocument": clean(d.get("FromDocument")),
        "postalAddress": addr(d, "PostalAddress"), "deliveryAddress": addr(d, "DeliveryAddress"),
        "lines": lines(d, kind),
    }


def main(src, out):
    raw = open(src, "rb").read()
    D = json.loads(raw)
    co = D["company"]
    cats = {c["ID"]: c["Description"] for c in D["CustomerCategory"]}
    res = {
        "format": "accounting666-import/1", "source": "Sage Business Cloud Accounting (ZA)",
        "sourceExtractedAt": D["extractedAt"], "sourceSha256": hashlib.sha256(raw).hexdigest(),
        "companies": [
            {"id": COMPANY_ID, "displayName": co["DisplayName"], "registeredName": co["RegisteredName"],
             "registrationNumber": co["RegistrationNumber"], "vatNumber": clean(co.get("TaxNumber")),
             "sageCompanyTaxNumberField": clean(co.get("CompanyTaxNumber")), "email": co["Email"],
             "ccEmail": co.get("CCEmail"), "telephone": clean(co.get("Telephone")), "contactName": co.get("ContactName"),
             "address": addr(co, "PostalAddress"), "currency": "ZAR", "sageCompanyId": co["ID"]},
            {"id": "logi-ink", "displayName": "Logi-Ink (Pty) Ltd", "note": "Details not supplied yet; no Sage data"},
        ],
        "taxTypes": [{"sageId": t["ID"], "name": t["Name"], "rate": str(t["Percentage"])} for t in D["TaxType"]],
        "customers": [], "items": [], "recurringTemplates": [], "invoices": [], "quotes": [], "creditNotes": [], "receipts": [],
    }
    for c in D["Customer"]:
        res["customers"].append({
            "sageId": c["ID"], "companyId": COMPANY_ID, "name": c["Name"], "category": (c.get("Category") or {}).get("Description"),
            "contactName": clean(c.get("ContactName")), "email": email(c.get("Email")), "emailRaw": clean(c.get("Email")),
            "telephone": clean(c.get("Telephone")), "mobile": clean(c.get("Mobile")), "web": clean(c.get("WebAddress")),
            "vatNumber": None if (c.get("TaxReference") or "").strip().upper() in ("", "TBC") else c["TaxReference"].strip(),
            "postalAddress": addr(c, "PostalAddress"), "deliveryAddress": addr(c, "DeliveryAddress"),
            "active": c["Active"], "dueDateMethodSage": [c.get("DueDateMethodId"), c.get("DueDateMethodValue")],
            "sageBalanceCents": cents(c["Balance"]), "sageCreated": c.get("Created"),
        })
    for i in D["Item"]:
        res["items"].append({
            "sageId": i["ID"], "companyId": COMPANY_ID, "code": clean(i.get("Code")), "description": i["Description"],
            "category": (i.get("Category") or {}).get("Description"), "unit": clean(i.get("Unit")),
            "priceExclCents": cents(i["PriceExclusive"]), "priceInclCents": cents(i["PriceInclusive"]),
            "salesTaxSageTypeId": i.get("TaxTypeIdSales"), "active": i["Active"], "physical": i["Physical"],
        })
    for r in D["RecurringInvoiceFull"]:
        h = header(r, "recurring")
        s, p = r["Schedule"], r["RecurringProfile"]
        h.update({"frequency": FREQ.get(s["ScheduleFrequencyId"], f"sage-{s['ScheduleFrequencyId']}"),
                  "startDate": s["StartDate"][:10], "lastRunDate": (s.get("LastRunDate") or "")[:10] or None,
                  "active": s["Active"], "autoCreate": p["AutoCreate"], "dueDateMethodSage": [p["DueDateMethodId"], p["DueDateMethodValue"]],
                  "ccEmail": p.get("CarbonCopyEmail")})
        res["recurringTemplates"].append(h)
    res["invoices"] = [header(d, "invoice") for d in D["TaxInvoiceFull"]]
    res["quotes"] = [header(d, "quote") for d in D["QuoteFull"]]
    res["creditNotes"] = [header(d, "creditNote") for d in D["CustomerReturnFull"]]
    for r in D["CustomerReceipt"]:
        res["receipts"].append({"sageId": r["ID"], "companyId": COMPANY_ID, "customerSageId": r.get("CustomerId"),
                                "date": r["Date"][:10], "totalCents": cents(r["Total"]), "description": clean(r.get("Description")),
                                "reference": clean(r.get("Reference"))})
    os.makedirs(out, exist_ok=True)
    p = os.path.join(out, "accounting666_import_logia-services.json")
    json.dump(res, open(p, "w"), ensure_ascii=False, indent=1)
    print(p, {k: len(v) for k, v in res.items() if isinstance(v, list)})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
