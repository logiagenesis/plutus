# 25 — Piece 2: Outbound Email Delivery from accounts@logia.co.za (30 October 2026)

## Summary of Changes

### 1. Database Schema & State Tracking (`app/worker/schema.ts`)
* Added `email_messages` table to store complete outbound email logs:
  * `id INTEGER PRIMARY KEY AUTOINCREMENT`
  * `company_id TEXT REFERENCES companies(id)`
  * `document_id INTEGER REFERENCES documents(id)`
  * `recipient_email TEXT NOT NULL`
  * `cc_email TEXT`
  * `subject TEXT NOT NULL`
  * `body_text TEXT NOT NULL`
  * `status TEXT NOT NULL DEFAULT 'sent'` (`sent` or `queued`)
  * `provider_id TEXT` (stores Resend / external delivery ID)
  * `created_by TEXT NOT NULL`
  * `created_at TEXT DEFAULT now`
* Added index `emails_document ON email_messages(document_id)` for high-performance invoice lookups.
* Added `sent_at` and `sent_to` columns to `documents` table to track direct delivery timestamps and primary recipients.
* Fixed blank-database caching in `ensureSchema` so isolate memory does not cache unmigrated state before restore.

### 2. Cloudflare Worker Outbound Email API (`app/worker/index.ts` & `app/worker/auth.ts`)
* Implemented `POST /api/documents/:id/send`:
  * Enforces active authenticated session.
  * Ensures only `issued` documents can be sent (drafts cannot be emailed).
  * Validates recipient email format and optional CC address.
  * Generates professional email text matching Logia Services / Sage historical format:
    * Standard subject: `Invoice <number> from Logia Services (Pty) Ltd`
    * Itemized financial summary (Amount, Date, Due Date)
    * Complete FNB Cheque Account payment instructions
    * Proof-of-payment remittance notice to `accounts@logia.co.za`
  * Direct Resend API transport support: automatically dispatches via HTTPS when `RESEND_API_KEY` is configured in Worker secrets.
  * Atomically records the message in `email_messages`, updates `documents.sent_at` and `documents.sent_to`, and logs an `audit_events` record.
* Updated `bootstrap` and `getDocument` queries to return `sent_at`, `sent_to`, and full `emails` history.

### 3. Frontend Email Actions & History Panel (`app/src/pages/Documents.tsx` & `app/src/ui.tsx`)
* Added `mail` icon to `app/src/ui.tsx`.
* Added prominent **Email Invoice** / **Email Quotation** button to the document action bar for issued documents.
* Built **`EmailModal`** dialog allowing the user to review/edit recipient email, CC email (`accounts@logia.co.za`), subject line, and custom note before sending.
* Added an **Email History** section to the document summary panel, displaying recipient addresses, timestamps, and delivery status badges.
* Updated document status badge logic in `app/src/data.ts`: documents with recorded deliveries display the `Sent` badge.
