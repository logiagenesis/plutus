# Product requirements — proposed baseline
Date: 27 October 2026.
Authority: current user request first; source documents provide context and ideas. Detailed behaviour below is a recommendation, not an assertion that Dennis has approved each item.

## Confirmed intent
Internal Logi-Ink accounting software focused on quotes, invoices, recurring invoicing, statements, bank statement import and matching. An exceptional glass-and-black interface, durable hosting with minimal recurring cost, and organised documentation in GitHub and Drive.

## Proposed v1
| Area | Behaviour | Acceptance evidence |
|---|---|---|
| Access | Invite-only identities; admin, finance and read-only roles | Server denies unauthorised reads and writes; no public registration |
| Business setup | Business profile, logo, currency, tax settings, numbering and terms | No fabricated company/VAT/bank details; required settings validated |
| Customers/items | Search, edit, archive, reusable service lines | Archived items remain on historical documents |
| Quotes | Draft, issue, PDF, expiry, acceptance/rejection, conversion | Retried conversion produces one linked invoice |
| Invoices | Draft, issue, due date, PDF, delivery record, balances | Issued line/customer/tax snapshots remain stable |
| Recurring | Monthly first, period tokens, preview, draft generation, pause | Concurrent and retried runs create one document per schedule/period |
| Statements | Opening balance + invoices/credits/payments + closing balance | Totals reconcile to source events for the date range |
| Bank import | CSV mapping, row preview, validation, saved mapping, duplicate review | Repeat/overlapping files do not silently create duplicates |
| Matching | Suggested reasons, manual match, partial and split allocations, reversal | No over-allocation under concurrent requests; audit trail retained |
| Reports | Outstanding, overdue, receipts, customer balances, unmatched items | Each total is traceable and its date basis labelled |
| Operations | Export, audit history, backup status and failed-job visibility | Restore succeeds in an isolated environment |

## State model
Keep document lifecycle, delivery and settlement separate.
- Quote lifecycle: draft, issued, accepted, rejected, expired, converted. Conversion is tied to a saved invoice.
- Invoice lifecycle: draft, issued, corrected/voided under policy. Settlement: unpaid, partially paid, paid, credit balance where applicable. Overdue is derived from due date and remaining balance.
- Delivery: queued, accepted by provider, failed; do not call provider acceptance "delivered" or "viewed" without evidence.
- Bank row: staged, validated, imported, excluded; review/matching states are separate.
- Draft generation and email sending are separate idempotent jobs.

## Financial integrity requirements
Use exact decimal arithmetic with explicit rounding rules. Store final monetary amounts in integer minor units where appropriate; quantities, rates and intermediate calculations need defined precision. Never use unrounded binary floating-point totals as authoritative money.
Calculate totals server-side; reject client-supplied totals that disagree. Enforce unique document numbers per business/type and unique recurring schedule/period keys in the database. Keep allocation writes and their checks atomic. Use optimistic concurrency for edits.
Preserve issued document snapshots and auditable reversals. A simple receivables event ledger is proposed; this app must not claim to provide a complete general ledger, profit-and-loss, balance sheet or statutory filing service without implementing those capabilities.
Unallocated receipts, deposits, credits and reversals must have explicit handling. They cannot disappear into a Paid toggle.

## Import safety
Do not assume a bank's columns or date format. Show detected encoding, delimiter, date interpretation, amount signs and sample rows before commit. Preserve original row values and source file hash.
File hash prevents exact-file replay; row fingerprints only flag possible duplicates. Two legitimate same-day payments can share amount and description. Use bank transaction identifiers where present; otherwise provide an explicit review path.
Use staged chunks and resumable batch states for large files. Reject malformed rows with reasons; never silently skip them. Treat CSV formula-like cells safely on export. Never execute uploaded content.

## Proposed exclusions
Payroll, stock/inventory valuation, supplier accounting, multi-currency, multi-entity UI, live bank login/feeds, payment gateways, customer portal, AI financial decisions, tax submission and native mobile apps.
These are scope-control recommendations derived from the narrow brief, not permanent prohibitions.

## Business-input register
| Input needed | Why | Safe progress before answer |
|---|---|---|
| Legal entity, VAT registration, inclusive/exclusive pricing | Correct issued documents and tax treatment | Fictional fixture company; configurable tax engine |
| Existing invoice sequence and cutover date | Avoid duplicates and migration ambiguity | Separate demo numbering |
| Anonymised bank CSV samples | Real parser and duplicate rules | Generic mapping UI and parser fixtures |
| Users, identity provider, domain | Access configuration | Local/demo role simulation clearly labelled |
| Email sender and permission | Real delivery and sender authentication | Preview/download only |
| Monthly volumes and history size | Quotas, indexes, backup size | Clearly labelled synthetic load tests |
| Credits/deposits/refunds policy | Correct customer balances | Implement explicit event types; no production postings |
| Migration exports and opening balances | Reconciled cutover | Import contract and validation tooling |

Production settings must be collected through onboarding or a concise decision list. Do not guess them. Design and technical spikes can proceed independently.
