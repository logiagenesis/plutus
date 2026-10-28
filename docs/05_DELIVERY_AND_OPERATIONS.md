# Delivery, verification and operations
Date: 27 October 2026. Proposed implementation plan; no application tests have yet run.

## Milestones
| Stage | Deliverable | Exit gate |
|---|---|---|
| 0 — Preparation | Source inventory, reconciled scope, design/hosting spec, prompt | Files present in GitHub and Drive, readback verified |
| 1 — Design prototype | Overview, invoice editor, banking workspace with fictional fixtures | Browser review, responsive screenshots, keyboard and contrast checks |
| 2 — Architecture spike | Auth, transactional writes, import/PDF/job/restore benchmarks | Hosting choice validated against measured limits |
| 3 — Core workflows | Customers, items, quotes, invoices, PDFs | Totals, snapshots, numbering and conversion tests pass |
| 4 — Recurring and statements | Period-safe drafts, customer event statements | Retry/concurrency and opening/closing balance tests pass |
| 5 — Banking | Mapping, staged import, duplicate review, suggestions, splits/reversals | Re-import and allocation integrity tests pass |
| 6 — Production preparation | Real configuration, reconciled migration, access, backups, sender | Security checks, restore drill, business acceptance and deployment evidence |

Audit logging, validation and access control start with the first persistent write, not at the end.

## Meaningful test scenarios
- Decimal quantities, line/document discounts, inclusive/exclusive configured tax, rounding boundaries and zero amounts.
- Retried/concurrent issue, numbering and quote conversion; crash between related writes.
- Schedule retries, month-end dates, leap year, paused schedules, catch-up and a job running twice.
- Duplicate CSV, overlapping statement exports, legitimate identical rows, invalid dates, debit/credit sign changes, malformed encoding.
- One payment across invoices, partial payment, overpayment, deposit, refund/credit, unmatch/reversal and simultaneous allocations.
- Statement opening balance before range; transactions on range boundaries; credit/reversal impacts.
- User cannot access another company/customer's documents by changing an ID; read-only user cannot call write APIs.
- Expired session, failed upload, retryable network error, stale edit and quota exhaustion produce honest recoverable states.
- Restore a backup to a separate database; reconcile row counts, financial totals and document hashes.
- Browser tasks at target widths, long data, zoom, keyboard and reduced motion/transparency.

## Production checklist
Use separate development/staging/production data. No real bank files in test fixtures. Keep secrets out of GitHub, frontend bundles, Drive planning files and screenshots. Set least-privilege deployment credentials and documented rotation/recovery.
Choose and verify domain, sender, identity provider and roles. Configure error reporting without customer financial content. Monitor failed recurring jobs, failed email, import failures, backup age, database size and quota usage.
Document every migration with pre-change export and rollback/recovery steps. Restore compatible application/schema versions together.

## Migration and cutover
Obtain actual source exports and identify the authoritative cutover date. Map customers and document IDs; preserve source numbers and provenance. Reconcile opening balances and outstanding invoices with the business before enabling live posting. Prevent sending historical invoices accidentally. Keep source exports read-only and access-restricted.
Do not claim an automated Sage importer exists until tested against real anonymised exports.

## Documentation on every build round
Save source changes, migration scripts, dependency lockfile, tests, decision log, change summary, screenshots and known limitations to GitHub. Mirror reviewable documentation and a versioned source/release export into the supplied Drive project with a manifest linking the Git commit.
Suggested naming: YYYY-MM-DD_Plutus_<Artifact>_vNN.ext. Repository documentation may keep stable names and rely on commit history.
Never mark a round complete until both copies are verified. If one destination fails, report the exact partial state.
Future build exports belong in a dedicated Releases folder created when an actual release exists. Do not fill empty folders with misleading "done" files.
Preserve user-visible conversation decisions and action summaries. Do not fabricate missing historical chat logs or claim a summary is verbatim history.

## Open decisions, in order of need
Before live data: business/tax profile, real bank samples, access list and migration scope.
Before email: sender, domain ownership and sending permissions.
Before production hosting: measured size/load, chosen region, backup destination, account quotas and acceptable fallback spend.
Before cutover: balance reconciliation, numbering, correction policy and recovery exercise.
Until then, proceed with explicitly fictional data and configurable settings.
