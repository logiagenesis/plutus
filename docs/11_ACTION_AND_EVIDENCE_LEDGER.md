# Plutus — action and evidence ledger
Date: 27 October 2026.
Scope: actions performed in this conversation. This is an explicit operational summary, not raw tool telemetry.

## Source discovery and reads
- Drive root: 19wJFooMd-9_11eNlf5antaifsXl4J3RL.
- Initial children: Development, Audits, Reasearch.
- All three initial children listed; all five text files fetched and read.
- Full inventory, IDs, reported sizes, conflicts and missing inputs: 01_SOURCE_AUDIT.md.
- Repository metadata, main recursive tree, README, initial ref and commit read through GitHub.
- Initial commit 88684324ffb610c420acfd78044042fbc5dcff4f; initial tree 7f4c70b38f92c160a372fa5b720d08692a3effe7.
- Initial tree contained README.md only; recursive response was not truncated.

## Research actually performed
Official Cloudflare Workers/D1 pricing, limits, recovery, database API, placement, R2 pricing/activation; Firebase pricing/functions/scheduling; Render Free; Vercel Hobby.
Design evidence: Apple software announcement, Apple iOS page CSS via MiroMiro, Figma trends, W3C WCAG, Carbon data tables and Google Web Vitals.
Exact applied source URLs and limitations are in the design and hosting specifications.
No claim of signed-in Sage testing, exhaustive external-link review or 20/20/25-site audits.

## Drive changes
Renamed folders without replacing their IDs:
- Reasearch -> 01_Research, ID 1r-8e7bN4mPiRI_i-dNMmpuqiTKB6yIZI.
- Audits -> 02_Reference_Audits, ID 1Wz9t7Bt1c3WASniwkfU-nv4uw2Xr3Qj4.
- Development -> 03_Development, ID 1n1g_KJ2X1qVNs4c2oOU3YJrSxOt3F_3b.

Created:
- 00_Project_Control: 1Px6qt_D7rTdJ4Ry2POL9LEXMpjBvLvpM.
- 03_Development/01_Design: 1zUS6pQpNJ03vieRcz-mczqXbTtFVThnp.
- 03_Development/02_Architecture_and_Hosting: 19CylMiMp723rqiBFSkb4oPG6hYw0ce2s.
- 03_Development/03_Build_Prompt: 1RkhtpMb87_ahNIpu0CfOQraI8Jsl8u8b.

Saved documents 00–07, verification manifest 08 and Cloudflare addendum 09. Updated index 00 in place after the account check. Original source file content was re-fetched and compared successfully after initial publication; no originals were rewritten or deleted.
Conversation/action records 10–11 are added as part of the current documentation instruction.

## GitHub publication history
| Commit | Change |
|---|---|
| 893f649d41f9ffeb1e7aaf94ae6784703761a455 | Eight planning docs, five source snapshots, README index |
| 6a0b34228318a6be3567a90746699b7b904b9ff5 | Original verification manifest |
| b0c26aadc753230fdc1dacd76ea9da1714c7260c | Cloudflare account check and index update |

Branch updates used expected-head checks; no forced rewrite was requested. Current-turn transcript/log publication is a later commit visible in repository history.

## Verification evidence
- Initial 14 GitHub file readbacks matched prepared text: eight docs, five reference snapshots and README.
- Initial eight Drive planning file readbacks matched prepared text.
- Verification manifest matched in GitHub and Drive after decoding Drive's JSON response.
- All five original Drive source files were re-read and still matched the originally retrieved text.
- Before the latest addendum, all eight current Drive/GitHub planning document pairs were compared again and matched.
- The original 08 manifest deliberately identifies the historical commit it checks; it is not a blanket certificate for later edits.
- Current additions require destination readback before being reported complete.

## Cloudflare inspection
Read-only account inventory succeeded; account ID ddcd0a9eefadc42e5826dcbc4ef94cd4.
Workers scripts, D1 databases and Pages projects returned zero.
Subscription inspection failed with HTTP 403 / 10000; OAuth connection does not cover the billing endpoint. A separate permitted credential would be required to inspect it.
No resources, database, subscription, deployment or charge were created by these actions.
Details and implications: 09_CLOUDFLARE_ACCOUNT_CHECK.md.

## Failed attempts and recovery
| Attempt | Observed result | Recovery / consequence |
|---|---|---|
| Initial Drive folder-list call used folder_id | Required url argument missing | Used canonical folder URL successfully |
| Initial GitHub repository call used incompatible arguments | Invalid arguments | Used supported GitHub fetch URL |
| Initial create-folder calls used parent_id/parent | Invalid arguments | Read schema and used parent_folder |
| PowerShell workspace inspection | FileSystem initialisation failure; rg unavailable; workspace access denied | Used authenticated remote connectors; wrote temporary artifacts in permitted Temp directory via Node |
| Large combined source output | Tool display truncated repeated content | Stored retrieved results and read source content in smaller sections |
| Apple HIG materials fetch | JavaScript page; Markdown fetch unsupported | Marked unsuccessful; used retrievable Apple announcement and CSS evidence |
| Early cross-cell commit lookup | Stored result not yet available while prior call running | Waited for completion and used returned commit SHA |
| First Cloudflare grouped inspection | Subscription error rejected grouped result | Re-ran inventory calls with per-resource error handling |
| Drive JSON manifest text equality | Empty readable-text field | Decoded returned JSON bytes; equality passed |

These failures were not presented as successful work. No failed action is evidence of an existing resource or completed deployment.

## Open work
Implementation/prototype, runtime compatibility and CPU/PDF/import benchmark, auth and permissions tests, financial concurrency tests, restore exercise, real business setup, migration reconciliation, sender/domain setup and production hosting decision.
This ledger and the conversation record cover available current-session material. They do not fabricate missing historical chats or pretend that design/application tests have already run.

## 27 October 2026 — continuation session
- Gmail read-only search of Sage mail; findings in 13_SAGE_INBOX_FINDINGS.md.
- app/ scaffold committed (d0f3a0f). Requirements updated for two invoicing companies (73193c6).
- Sage data extraction through the built-in browser: read-only GET/list calls only. Export SHA-256 bc9a54a8…7dc6 matched before and after transfer. Normaliser output was reproduced twice byte-identically. Totals and line arithmetic were checked programmatically (see 14_SAGE_IMPORT_REPORT.md). Review workbook recalculated with 0 formula errors.
- Drive: created 04_Data/2026-10-27_Sage_Export with the raw export, import JSON and review workbook (written through the local synced shared-drive folder).
- GitHub: normaliser script and report only. Real customer data is excluded by .gitignore.
- Fix: quantities like 20 had been written as "2E+1" by the normaliser. Corrected; the import file was re-issued as v02 in Drive (v01 kept).
- Milestone 1 prototype (commit 1060c0f): the money engine reproduces all 3,100 Sage lines; Playwright navigation and invoice flow pass; screenshots and a standalone HTML are in Drive 03_Development/04_Prototype/2026-10-27_v01; a private Claude page was published.

## 28 October 2026 — rename to Plutus (actions and evidence)
- Cloudflare Worker renamed in the dashboard (Settings › General › Name). New address https://plutus.denweb82.workers.dev. The Worker's Cloudflare Access policy and AUD tag carried over unchanged; Access application renamed to "plutus - Cloudflare Workers".
- New D1 database "plutus" (d0ce91f8-0ae6-4844-99a8-846ed46caaf6, WEUR) created and given the schema. Data was copied from the previous database by a temporary, sign-in-protected route (tested locally first), then the route and the link to the previous database were removed (commit 5b8f39a).
- Copy check (queried both databases afterwards): customers 112/112, items 212/212, documents 945/945, document lines 3,076/3,076, recurring templates 16/16, recurring lines 24/24, number sequences 6/6, audit events 1/1, import batches 1/1. Invoices 625, total 117,005,445 cents (R 1,170,054.45); quotes 317, total 455,383,912 cents (R 4,553,839.12); credit notes 3, total 1,102,649 cents. Line totals, IDs, customer links, recurring totals, item prices, sequences (next INV00006946, QUO001302, CRN0000125) identical in both.
- Live app checked after sign-in: home screen loads from the new database (October R 14,890.00 from 18 invoices; R 8,159.00 recurring on 25 Nov).
- GitHub repository renamed to logiagenesis/plutus (Settings › General). Workers Builds kept working after the rename (later builds succeeded).
- Code: import format id is now plutus-import/1; browser storage key and package name renamed; all docs updated.
- Drive: project folder renamed to Plutus (same ID). Files renamed in place (same IDs, links still work) and their contents updated: import files v01/v02, review workbook, prototype page, screenshots (re-taken from the renamed prototype), scheduled audit note, archive index and all numbered docs. The scheduled-audit chat log in Claude Folder › Chat Logs was re-created with the new name and the old copy moved to Drive trash.
- Logo: official PLU+US files copied to brand/ in GitHub and to Drive 03_Development/05_Brand. The stand-in logo files were moved to Drive trash and removed from GitHub.
- Scheduled audit task renamed "Plutus monthly audit (22nd, before recurring run)" and its instructions updated to the new repo, folder, file names and database.
- Not changed by Claude (needs Dennis): the previous D1 database still exists (deleting it is permanent); the Cloudflare API token used by builds is still named after the old project; this Claude project and the ChatGPT project are still named after the old project; old Git commit messages and the first conversation records in chat history still contain the old name.

## Ongoing documentation rule
For every substantive project round, preserve requests, decisions, sources, code/config changes, verification results, failures, unresolved work and artifact locations in GitHub and the organised Drive project. Include reviewable screenshots/test evidence when those artifacts exist. Never claim an unsaved or unverified copy exists.
