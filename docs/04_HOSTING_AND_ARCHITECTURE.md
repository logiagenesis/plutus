# Hosting and architecture decision
Checked: 27 October 2026. Status: recommended direction, subject to a technical spike and actual account/volume verification. No service provisioned.

## Recommendation
Start with React + TypeScript + Vite for the authenticated application, Workers Static Assets for its built frontend, a same-origin Worker API and D1 for relational records. Use a small, explicit backend rather than adding a separate always-on server and PostgreSQL bill before there is evidence they are needed.
This is an engineering recommendation, not a statement that the existing project already uses this stack.

## Verified provider comparison
| Option | Current documented constraint | Implication |
|---|---|---|
| Cloudflare Workers Free | 100,000 dynamic requests/day; 10 ms CPU per invocation; static asset requests free | Credible candidate for small use; imports/PDF rendering require measured design |
| Cloudflare D1 Free | 5m rows read/day; 100k written/day; 5 GB account total | Index queries; count scanned rows and writes, not just HTTP calls |
| D1 per-database limit | 500 MB on Free; 10 GB on Paid; Time Travel 7 days Free / 30 days Paid | 5 GB is not the free size of one database; independent backup remains necessary |
| Workers Paid | Minimum USD 5/month, included usage and overages | Low-cost fallback; not a fixed all-in price |
| Firebase Firestore Spark | 1 GiB stored; 50k document reads/day; 20k writes/day | Viable alternative, with different document-model and reporting trade-offs |
| Firebase server functions | Deploying Cloud Functions requires Blaze | Native scheduled backend work is not an all-Spark architecture |
| Render free web/DB | Web sleeps after 15 idle minutes; free PostgreSQL expires after 30 days | Reject as a long-term free production database |
| Vercel Hobby | Personal, non-commercial use | Reject for the business app on Hobby; paid plan would need separate costing |

Sources:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://firebase.google.com/pricing
- https://firebase.google.com/docs/functions
- https://render.com/docs/free
- https://vercel.com/docs/plans/hobby

No rand conversion is supplied because an exchange-rate estimate would not establish the actual card, VAT or billing cost.

## Other costs and dependencies
- PDF/file storage: R2 Standard includes 10 GB-month, 1m Class A and 10m Class B operations monthly, with paid usage beyond allowances. Activation uses an R2 subscription checkout. Do not describe included usage as a universal billing cap. Sources: https://developers.cloudflare.com/r2/pricing/ and https://developers.cloudflare.com/r2/get-started/
- Email: provider and sender not selected. Existing business email may be reusable after API, limits and permissions are verified. Sending is not assumed free.
- Identity: use a maintained identity solution or verified existing identity provider. Do not build ad-hoc password security. Provider selection and costs remain open.
- Domain: use a provider URL for preview; a custom domain has ownership and renewal considerations.
- Backups, monitoring, CI minutes and maintenance have limits or labour cost. Existing Drive capacity is not assumed unlimited.
- Cloudflare account plan, other applications' shared quota consumption and commercial terms must be checked before production activation. Public pricing is not an account inspection.

## Architecture contracts
Browser calls the same-origin API; only backend code can mutate financial records. Every request authenticates identity, checks role and scopes company data. Keep credentials server-side.
Separate domain calculations from framework/storage code. Use versioned SQL migrations and parameterised queries. Enforce unique keys and conditional updates in the database. Validate D1's supported atomic batch pattern against concurrent numbering, conversion and allocation tests; never assume arbitrary PostgreSQL transaction APIs work on D1.
Use a transactional outbox for document/email jobs. Job idempotency must survive retries and restarts. A scheduler checks due recurring periods and records one result per schedule/period; draft generation runs without an open browser.
Keep PDFs, attachments and source imports outside database BLOBs. Store metadata/checksum, ownership and private object keys in D1. File access requires authorisation or short-lived signed access.
Browser-generated PDFs can serve a design prototype; unattended invoice email needs a tested server-side renderer or controlled rendering service. Benchmark this before promising Free-plan production. An issued PDF must reflect server-authoritative immutable data.

## Proposed data domains
Company/settings; identity memberships; customers; items; quotes/lines; invoices/lines; credit/reversal events; recurring schedules/lines/runs; bank accounts; import batches/staged rows/transactions; receipts/allocations; document snapshots; email outbox/delivery events; append-only audit events.
Foreign keys and business-level uniqueness are mandatory. Do not store several independently editable versions of the same balance. Reports derive from authoritative events/allocations.

## Technical spike: pass before production selection
1. Authenticate a test user and enforce read-only versus finance permissions at API level.
2. Demonstrate rollback/atomicity and race safety for numbering, quote conversion and allocation.
3. Import synthetic CSVs in bounded chunks; measure CPU, request count and D1 rows scanned/written.
4. Generate representative multipage PDFs and prove scheduled generation without a browser.
5. Re-run the same recurring period concurrently; one invoice and one intended outbound job result.
6. Measure database/API latency from the expected South African usage location.
7. Export and restore schema, records and documents into an isolated environment.
8. Estimate quota use from measured records and actual expected volume.
If Free fails CPU or reliability needs, document the paid fallback or architecture adjustment. Never silently enable billing.

## Durability and exit
D1's limits page is authoritative for the Free 7-day recovery window; the general Time Travel overview describes a 30-day window without the same plan distinction. Sources: https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/reference/time-travel/
Propose encrypted daily off-platform SQL/data exports plus document manifests, weekly restore drills during rollout and monthly thereafter. Retention is a business policy to confirm. Target RPO <=24 h and RTO <=4 h are proposed goals, not achieved guarantees.
Exports must include schema version, stable IDs, relationships, checksums and a restore guide. Test migration to ordinary SQLite and assess PostgreSQL conversion separately; portability is work, not automatic compatibility.
Inspect data placement using https://developers.cloudflare.com/d1/configuration/data-location/ before provisioning. Do not assume an edge network means the database is stored in South Africa. Privacy, retention and cross-border decisions need explicit review before real customer records are loaded.
