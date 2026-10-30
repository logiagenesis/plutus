# 24 — Piece 1: Document Banking Details, PDF Print Styling, and Security Lockdown (30 October 2026)

## Summary of Changes

### 1. Dedicated Banking & Payment Instructions (`app/src/pages/Paper.tsx`)
* Added a structured **Banking & Payment Details** box to all invoices rendered in `Paper.tsx`.
* Directly displays verified FNB Cheque Account details:
  * **Bank**: First National Bank (FNB)
  * **Account Name**: Logia Services (Pty) Ltd (`co.registeredName || co.displayName`)
  * **Account Number**: `62932184469`
  * **Account Type**: Current / Cheque Account
  * **Branch Code**: `250 655` (Menlyn Maine)
  * **Payment Reference**: `p.number` (or `Draft` if unissued)
  * **Proof of Payment**: `accounts@logia.co.za`
* Enhanced issuer header with company registration number (`2021/986147/07`), physical address, and contact details.

### 2. One-Click Print & PDF Generation (`app/src/pages/Documents.tsx` & `app/src/ui.tsx`)
* Added `print` icon to the icon library in `app/src/ui.tsx`.
* Added a prominent **Print / PDF** action button to `DocView` in `app/src/pages/Documents.tsx` that triggers `window.print()`.

### 3. Print & PDF Vector Styling (`app/src/styles.css`)
* Added `.p-bank` box styles for clean on-screen contrast in the Obsidian Glass interface.
* Added comprehensive `@media print` rules ensuring that printing or selecting "Save as PDF" produces a pure white background, hides dark UI sidebars, navigation bars, toolbars, and buttons, and outputs an A4 portrait layout with 15mm margins.

### 4. Cloudflare Security Flag Lockdown (`app/wrangler.jsonc`)
* Updated `app/wrangler.jsonc` to set `"RESTORE_ENABLED": "0"`, closing the temporary database restoration window following the database migration.
