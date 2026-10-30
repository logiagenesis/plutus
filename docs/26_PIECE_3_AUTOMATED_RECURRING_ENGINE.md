# 26 — Piece 3: Automated 25th Recurring Run Engine (30 October 2026)

## Summary of Changes

### 1. Database Schema & Idempotency Constraints (`app/worker/schema.ts`)
* Added `recurring_template_id` and `recurring_period` columns to the `documents` table.
* Created a strict database-level unique index:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS doc_recurring_unique
  ON documents(recurring_template_id, recurring_period) WHERE status <> 'void';
  ```
  This guarantees mathematical idempotency: SQLite strictly prevents generating more than one active invoice for the same template in the same billing cycle (e.g. `2026-11`), even if a cron fires twice or a user double-clicks.

### 2. Cloudflare Cron Trigger (`app/wrangler.jsonc`)
* Added automated monthly cron trigger running at 06:00 UTC (08:00 SAST) on the 25th of every month:
  ```jsonc
  "triggers": {
    "crons": ["0 6 25 * *"]
  }
  ```
* Implemented the `scheduled(event, env, ctx)` handler in `app/worker/index.ts` to automatically execute the monthly batch for active recurring profiles.

### 3. Backend Batch Generator & Preview API (`app/worker/index.ts`)
* Implemented `GET /api/recurring/preview`:
  * Returns upcoming run metrics: period, total active templates, count due to generate, count already generated, and projected total amount in cents.
* Implemented `POST /api/recurring/run`:
  * Enables manual execution (for November testing and verification).
  * Advances atomic invoice numbers sequentially (`number_sequences`).
  * Copies line items from `recurring_lines` into `document_lines`.
  * Computes end-of-month payment due dates.
  * Captures frozen customer and company snapshots.
  * Updates `recurring_templates.last_run_date`.
  * Records detailed audit events for each generated invoice and batch completion.

### 4. Interactive Frontend Dashboard (`app/src/pages/Recurring.tsx`)
* Added an **Upcoming 25th Batch** status card displaying live projected totals and generated progress.
* Added a **Run Invoices Now** button with confirmation guard, allowing immediate execution and real-time feedback directly from the UI.
* Linked batch runs to automatic store updates via `loadData()`.
