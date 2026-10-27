# Sage import — Logia Services
Date: 27 October 2026. Requested by Dennis: "All current clients and line items imported. All info."
This file holds counts and totals only. Customer-level data is not stored in GitHub. It lives in Drive: Accounting666/04_Data/2026-10-27_Sage_Export/.

## How the data was taken
1. Dennis signed in to Sage Business Cloud Accounting in the browser on his computer.
2. Read-only GET/list requests (the same ones Sage's own screens use) pulled the company, customers, items, tax types, recurring invoices, tax invoices, quotes, credit notes and receipts, each with every line. Nothing in Sage was created, changed or sent.
3. The result was gzipped and downloaded with Dennis's permission (sage_export_2026-10-27.json.gz, 258,145 bytes).
4. The JSON's SHA-256 inside the browser and after transfer both equal bc9a54a8a89238836d23dbab220ba20f88d8318ac5db25737c9ba6bc87e57dc6.
5. scripts/sage/normalize.py converted it to the Accounting666 import format (accounting666-import/1), with all money in integer cents.

## Drive files
| File | Contents |
|---|---|
| 2026-10-27_Sage_Raw_Export.json.gz | Untouched Sage data |
| 2026-10-27_Accounting666_Import_Logia-Services_v01.json | Normalised import dataset |
| 2026-10-27_Accounting666_Sage_Import_Review_v01.xlsx | Review workbook: Summary, Customers, Items, Recurring, Invoices (+ lines), Quotes (+ lines), Credit notes |

## Counts (all verified against the raw export)
| Record | Count |
|---|---|
| Customers | 112 (all active in Sage) |
| Items | 212 (211 active) |
| Recurring templates | 16 (24 lines): 15 monthly, 1 annual |
| Tax invoices | 625 (1,419 lines), INV0000001 – INV00006945, 21 Dec 2021 – 26 Oct 2026 |
| Quotes | 317 (1,643 lines), QUO000982 – QUO001301 |
| Credit notes | 3 (CRN0000122 – CRN0000124) |
| Customer receipts | 4 (all February 2022) |

## Integrity checks (programmatic)
- 0 amounts with more than 2 decimals.
- All 3,100 document lines satisfy quantity × unit price − discount = line exclusive.
- Every document's lines sum to its header total.
- Normalised totals equal raw totals: invoices R 1,170,054.45; quotes R 4,553,839.12; credit notes R 11,026.49; customer balances R 1,136,862.76.
- Review workbook: 14 formulas, 0 errors after recalculation. Its totals match the import file.
- The October recurring run (13 invoices, R 7,719.00) equals the active monthly templates (R 8,159.00) minus the two templates that start on 25 Nov 2026 (2 × R 220.00).

## Findings that need Dennis's decision
1. Payments are not recorded in Sage. 622 of 625 invoices show Unpaid/Overdue/Partially paid, and the only receipts are from February 2022. Sage's "amount due" (R 1,157,551.26) and customer balances (R 1,136,862.76) are therefore not real debt. Do not import them as opening balances until they are checked against the FNB statements.
2. VAT: Sage's company VAT number field is empty. 150 of 625 invoices charged 15% VAT (R 85,828.82 in total), all dated Dec 2021 – 25 Sep 2023. No invoice since then has VAT. One recurring template, the annual RINV0000158, is still set to 15% VAT. Is Logia Services VAT-registered now? This decides the tax setting for new invoices.
3. Sage's "Company tax number" field holds 62932184469, which is also the FNB account number printed on invoices. This looks like a data-entry mix-up in Sage, not a real tax number. Not corrected.
4. 11 customers have a blank or placeholder email (blank@blank.co.za, email@email.com, email@email.co.za). They are imported with no email; the original value is kept in emailRaw.
5. 98 customers have VAT number "TBC" or blank. They are imported as no VAT number.
6. The latest invoice is INV00006945 (26 Oct 2026). Accounting666 continues from INV00006946, QUO001302 and CRN0000125 unless Dennis says otherwise.
7. Two monthly templates start on 25 Nov 2026 and have never run yet.

## Not yet done
- Loading into a live Accounting666 database. None exists yet; Milestone 2 creates it. The prototype can read this dataset locally.
- Supplier data, bank transactions and the general ledger were not exported.
- Invoice PDFs and Customer Zone access codes were not exported.
