# 28 — Piece 5: Customer Account Statements & Running Balance Ledger (30 October 2026)

## Summary of Changes

### 1. Statement Engine & Ledger Calculations (`app/worker/index.ts`)
* Implemented `GET /api/customers/:id/statement`:
  * Supports dynamic date windowing via `from` and `to` query parameters (defaulting to 90-day window).
  * **Opening Balance Calculation**: Sums all historical issued invoices, minus historical credit notes and non-voided payments prior to `fromDate`.
  * **Chronological Ledger Collation**: Queries invoices, credit notes, and settled payments within the date range, sorting chronologically by date and transaction sequence.
  * **Running Balance Calculation**: Computes progressive balance at every ledger row:
    $$\text{Balance}_i = \text{Balance}_{i-1} + \text{Debit}_i - \text{Credit}_i$$
  * **Four-Tier Aging Analysis**: Evaluates all outstanding open invoices as of `toDate` and categorizes unallocated balances into standardized aging buckets:
    * Current (0–30 days)
    * 30 Days (31–60 days)
    * 60 Days (61–90 days)
    * 90+ Days (91+ days)
    * Total Outstanding Due (matches closing balance)
  * Returns comprehensive snapshots of issuing company and customer profiles.

### 2. Outbound Statement Email Delivery (`app/worker/index.ts`)
* Implemented `POST /api/customers/:id/statement/send`:
  * Validates recipient email syntax.
  * Generates professional plain-text and structured email body matching Sage format with:
    * Statement period and customer reference.
    * Summary of opening balance, total invoiced, total payments received, and closing balance due.
    * Itemized aging analysis table.
    * Official FNB banking details and payment reference instructions.
  * Integrates with Resend API for transactional delivery and records audit logs (`statement_email_sent`).

### 3. Frontend Statement Presentation (`app/src/pages/Statement.tsx`)
* Created dedicated `CustomerStatement` page component:
  * Interactive period presets: "This Month", "Last 30 Days", "Last 60 Days", "Last 90 Days", "Year to Date", "All Time", and custom HTML5 date pickers.
  * Toolbar actions: One-click "Print / PDF" using native browser print dialogue and "Email Statement" modal.
  * Printable `.paper` layout:
    * Company header with registration, contact, and VAT details.
    * Customer "Bill To" block with postal/delivery address.
    * Statement metadata (Account Ref, Period, Currency).
    * Ledger table showing Date, Transaction, Reference, Debit, Credit, and Running Balance.
    * Highlighted Opening and Closing Balance rows.
    * Aging breakdown card (`.p-aging`) with 5-column breakdown.
    * Banking details remittance box (`.p-bank`) with FNB account numbers and POP email.
* Updated `app/src/pages/Customers.tsx`: Added "Statement" button directly to the customer profile toolbar.
* Updated `app/src/App.tsx`: Added route `customers/:id/statement`.

### 4. Typography & Print Stylesheet (`app/src/styles.css`)
* Added `.paper .p-aging` styles with 5-column grid layout, uppercase tracking labels, and bold tabular numbers.
* Extended `@media print` rules for clean, border-accurate A4 portrait rendering without interface rails.

### 5. Automated Regression Test Suite (`app/tests/worker-regression.mjs`)
* Added 6 regression assertions verifying:
  * Customer statement payload structure (company, customer, lines, aging).
  * Closing balance equals final ledger line's running balance.
  * Aging analysis correctly aggregates open invoice balances.
  * Opening balance correctly reflects transactions before the filter window.
  * Email recipient validation and audit trail logging.
* All 54 regression tests pass with 0 errors.
