# 30 — Piece 6: 100% Sage-Free Production Completion (`2026-11-01`)

## Overview
With Sage Business Cloud Accounting scheduled for permanent shutdown at the end of November 2026, Piece 6 closes the final 5 operational gaps identified in the comprehensive audit so Plutus operates as a 100% self-sufficient accounting system for **Logia Services (Pty) Ltd** and **Logi-Ink (Pty) Ltd**.

---

## 1. Full Recurring Template CRUD (`Recurring.tsx`, `worker/index.ts`)
- **API Endpoints:**
  - `POST /api/recurring`: Creates a new recurring template and its line items atomically, auto-assigning the next `RINV` sequence number and validating line math with `calcDocument`.
  - `PUT /api/recurring/:id`: Updates customer, frequency (`monthly` | `annually`), anchor/start date, active status, reference, message, VAT toggle (`0%` or `15%`), and line items atomically.
  - `POST /api/recurring/:id/toggle`: One-click Pause / Resume toggle (`active = 0 | 1`).
  - `DELETE /api/recurring/:id`: Safely unlinks historical generated invoices (`recurring_template_id = NULL`) and deletes the recurring template and its lines.
- **UI (`app/src/pages/Recurring.tsx`):**
  - Added **New recurring invoice** button and inline **Edit** and **Pause / Resume** actions on every recurring row.
  - Full `RecurringEditor` form with customer search-as-you-type picker, item picker, VAT checkbox (allowing immediate cleanup of legacy templates such as `RINV0000158`), and template deletion.

---

## 2. Credit Notes (`CRN`) & Invoice Reversal (`Documents.tsx`, `Editor.tsx`, `Paper.tsx`, `Customers.tsx`, `App.tsx`, `worker/index.ts`)
- **End-to-End Credit Note Lifecycle:**
  - Routes `#/credit-notes`, `#/credit-notes/new`, `#/credit-notes/:id`, and `#/credit-notes/:id/edit` wired in `App.tsx`.
  - One-click **Credit note** button on any issued invoice (`#/credit-notes/new?from=<invoiceId>`) pre-populates a draft Credit Note (`CRN`) with the invoice's customer, lines, and reference (`Credit for INV...`).
  - `Paper.tsx` renders `"Credit Note"`, `"Credited to"`, `"Credits Inv."`, and `"Total Credit"`.
- **Automatic Invoice Balance Reduction:**
  - Issued Credit Notes linked to an invoice (`from_document_id` or `from_number`) are automatically included in `INVOICE_SETTLED_SQL` (`paid_cents`) across `bootstrap`, `getDocument`, `addPayment`, `getOpenInvoices`, and `handleBankMatch`, reducing the credited invoice's open balance immediately without double-counting on Customer Statements.
  - Linked Credit Notes are listed directly inside the **Payments & Credits** card on the invoice view.

---

## 3. Split / Multi-Invoice Bank Deposit Matching (`Banking.tsx`, `worker/index.ts`, `data.ts`)
- **Multi-Invoice Deposit Allocation:**
  - `listBankTransactions` computes `allocatedCents` and `remainingCents` per bank deposit from active `payments` matching `bank-reconcile-tx-<txId>-doc-%`, and aggregates all matched invoice numbers (`matched_numbers`).
  - `handleBankMatch` supports custom or automatic partial allocations: when a deposit is larger than a single invoice, it allocates the invoice's open balance (or a custom rand amount entered by the user) and keeps the deposit in the **Needs Action** queue with its remaining unallocated balance until `allocatedCents >= amountCents`.
  - `suggestMatchForTx` uses the deposit's `remainingCents` so subsequent invoices matching the remaining balance are automatically suggested.
  - `handleBankUnmatch` reverses all payments linked to a bank deposit across one or multiple invoices in a single atomic batch.

---

## 4. Rich HTML + Printable Attachment for Outbound Emails & Test Email (`worker/index.ts`, `Other.tsx`)
- **Formatted HTML Email + Attachment:**
  - `renderDocumentHtml` and `renderStatementHtml` generate self-contained, print-ready A4 HTML documents for Invoices, Quotations, Credit Notes, and Statements of Account.
  - `sendDocument` and `sendCustomerStatement` send plain text (`text`), rich HTML (`html`), and a downloadable/printable `.html` document attachment (`attachments`) via Resend.
- **Live Email Verification:**
  - `POST /api/settings/test-email` and the **Verify Outbound Email (Resend)** card in `Settings` (`Other.tsx`) allow sending a verification email at any time.

---

## 5. Editable Company Settings & Historical Sage Cutover Settlement (`Other.tsx`, `worker/index.ts`)
- **Editable Company Details (`PUT /api/companies/:id`):**
  - Full form in `Settings` (`Other.tsx`) to edit Display Name, Registered Name, Registration Number, VAT Number, Accounts Email, Telephone, Physical Address, Default Banking/Invoice Message, and Company Active (`setUp`) status (also enabling self-service activation of **Logi-Ink (Pty) Ltd**).
- **Historical Sage Cutover Settlement (`POST /api/companies/:id/settle-sage`):**
  - Marks imported `source = 'sage'` invoices dated on or before a chosen cutover date (e.g. `2026-10-31`) as settled (`sage_status = 'Paid'`), with a one-click Undo (`unsettle`).
  - `getCustomerStatement` now accounts for settled historical Sage invoices (`source = 'sage' AND sage_status = 'Paid'`) in both opening balances, period ledger entries, and aging buckets so Customer Statements reflect true current open balances.
