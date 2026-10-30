# 27 — Piece 4: FNB Bank Statement CSV Reconciliation (30 October 2026)

## Summary of Changes

### 1. Database Schema & Audit Logging (`app/worker/schema.ts`)
* Implemented `bank_statements` table:
  * Stores imported statement metadata (`company_id`, `filename`, `row_count`, `checksum`, `imported_by`, `imported_at`).
* Implemented `bank_transactions` table:
  * Tracks individual statement line items (`statement_id`, `company_id`, `date`, `description`, `amount_cents`, `balance_cents`, `transaction_hash`, `matched_document_id`, `matched_at`, `match_type`, `status`).
* Added strict database constraints and performance indexes:
  * `bank_tx_hash_unique`: Unique index on `(company_id, transaction_hash)` to enforce strict idempotency during overlapping statement imports.
  * `bank_tx_company_status`: Composite index for filtering transactions by reconciliation status.
  * `bank_tx_matched_doc`: Index linking transactions to documents for reverse lookups.

### 2. FNB Bank Statement CSV Parser & Deduplication (`app/worker/index.ts`)
* Implemented `parseCsvRows`: RFC-compliant CSV parser handling quoted multi-line entries and embedded commas.
* Resilient header and column detection: Automatically detects Date, Amount, Balance, and Description columns regardless of leading account metadata.
* Multi-format date parser (`parseBankDate`): Handles `YYYY/MM/DD`, `DD/MM/YYYY`, `DD Mon YYYY` (e.g. `25 Oct 2026`), and ISO variants.
* Resilient South African Rand amount parser (`parseBankAmountCents`): Strips currency symbols (`R`, `ZAR`), normalizes spaces, handles accounting parenthesis `(100.00)`, explicit `Cr` / `Dr` suffixes, and converts to integer cents.
* Cryptographic deduplication (`hashBankTx`): Generates SHA-256 fingerprints of `company_id|date|amount_cents|balance_cents|description` to guarantee duplicate row skips on re-upload.

### 3. Smart Matching Engine (`app/worker/index.ts`)
* Scans open issued invoices (`status = 'issued'` with `(total_cents - paid_cents) > 0`).
* Three-tier matching heuristic:
  1. **Invoice Number Reference Match**: Extracts `INV...` or numeric sequences from the description. If exact open amount matches, assigned `high` confidence; if partial, assigned `medium` confidence.
  2. **Customer Name & Exact Amount Match**: Matches key non-generic customer tokens against description. If open balance equals transaction deposit, assigned `high` confidence.
  3. **Unique Open Amount Match**: Flags unique open invoices matching exact cent amount with `medium` confidence.
* Surfaces plain-language rationale explaining why each invoice candidate was suggested.

### 4. Reconciliation REST API (`app/worker/index.ts`)
* `POST /api/bank/import`: Ingests FNB CSV, executes deduplication, and returns import statistics.
* `GET /api/bank/transactions`: Returns paginated transactions with attached match suggestions, open invoices, and company-wide reconciliation KPIs.
* `POST /api/bank/match`: Records payment against invoice via atomic `addPayment` with idempotent client keys (`bank-reconcile-tx-...`), links transaction, updates status to `matched`, and writes audit log.
* `POST /api/bank/ignore`: Excludes non-customer entries (transfers, bank fees) from matching.
* `POST /api/bank/unmatch`: Voids recorded payment and resets transaction status to `unmatched`.

### 5. Frontend Bank Reconciliation Dashboard (`app/src/pages/Banking.tsx` & `app/src/App.tsx`)
* Replaced the placeholder screen with a full Bank Reconciliation dashboard.
* Removed the "Soon" tag from the main navigation rail (`NAV`).
* Features:
  * Real-time KPI summary tiles: Unmatched Deposits, Reconciled Total, Total Transactions, Ignored Entries.
  * Drag-and-drop CSV file uploader and direct text paste area with instant import progress feedback.
  * Filter tabs: "Needs Action (Unmatched Deposits)", "All Transactions", "Reconciled", "Ignored".
  * Search bar filtering by bank description, invoice number, or customer name.
  * Smart Match badges with confidence ratings, one-click "Match" confirmation, fallback invoice picker dropdown, and "Undo" controls.

### 6. Automated Regression Tests (`app/tests/worker-regression.mjs`)
* Added 9 comprehensive regression assertions verifying:
  * Full statement CSV parsing and database ingestion.
  * Strict duplicate row skipping upon re-upload.
  * Exact invoice reference match with high confidence rating.
  * Settlement execution: payment recorded on document and open balance reduced to 0.
  * Rejection of matching against already-settled invoices.
  * Reversal: unmatching transaction successfully voids payment and restores open balance.
* All 48 worker regression tests pass with 0 errors.
