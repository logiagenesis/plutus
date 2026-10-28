# Moving Plutus to the dennis@logia.co.za Cloudflare account

Started 28 October 2026, 10:15 SAST. Dennis asked: "Move everything to this Cloudflare environment. Everything. Redeploy the entire instance on a different Cloudflare environment. Move to dennis@logia.co.za."

## Accounts
| | Old (current live) | New (target) |
|---|---|---|
| Login | denweb82@gmail.com | dennis@logia.co.za |
| Account ID | ddcd0a9eefadc42e5826dcbc4ef94cd4 | 8cabaf8ffc36147476b494c0cc35a34e |
| Worker | plutus (plutus.denweb82.workers.dev) | not created yet |
| D1 database | plutus, d0ce91f8-0ae6-4844-99a8-846ed46caaf6 | not created yet |
| Cloudflare Access | team denweb.cloudflareaccess.com, app "plutus" | none (not needed, see below) |

Cross-invites (Dennis, 10:14–10:15): dennis@logia.co.za invited as Super admin to the old account (Pending); denweb82@gmail.com invited as Super admin to the new account (Pending).

## How the data moves (no passwords or API tokens handled by Claude)
Plutus can't be copied by the Claude Cloudflare connector into a second account (the connector only reaches the old account; it has no account switch here), and Dennis's PC has no Node.js (`npx` not found), so wrangler can't run there. So Plutus got a built-in backup and restore (commit 5532193):

1. Settings > Backup > Download backup: every table except login sessions, read in pages of 500 rows, checked against row counts, saved as one JSON file.
2. A brand-new Plutus whose database is empty and whose setting RESTORE_ENABLED is "1" shows a Restore screen instead of sign-in. It needs the backup file plus the email and Plutus password of a user in the backup (checked against the hash in the file). It recreates the tables, inserts rows in foreign-key order (150 per request), checks every table's row count, builds the indexes, then locks itself (a second restore is refused because the database is no longer empty).
3. After the restore, RESTORE_ENABLED is removed from the config.

Tested end to end on two local instances (945 documents, 3,150 lines): all tables byte-identical, auto-number counters identical, wrong password refused, second restore refused, unauthenticated backup refused (401).

## Progress log
- 10:22 Backup/restore built; typecheck and tests pass; pushed to main (5532193). Old account rebuilt automatically.
- ~10:28 Backup downloaded from plutus.denweb82.workers.dev in Dennis's Chrome (with his OK): 4,399 rows from 13 tables. Matches the live database counts (users 1, customers 112, items 212, documents 945, document lines 3,076, recurring templates 16, recurring lines 24, companies 2, number sequences 6, audit events 2, import batches 1, migrations 2; sessions excluded).
- Blocked: both Chrome windows connected to Claude are signed in to Cloudflare as denweb82@gmail.com, which can't open the new account until it accepts the pending invite.

## Still to do
- New account: create D1 "plutus", connect Workers Builds to logiagenesis/plutus (root /app), point wrangler.jsonc at the new database with RESTORE_ENABLED "1".
- Dennis restores (the password step is his).
- Verify counts against the numbers above, then remove RESTORE_ENABLED and the old Access settings.
- Disconnect the old account's build so it stops deploying; keep the old Worker and database until Dennis says to delete them.
- Update the monthly audit task, 00_START_HERE.md, ledger, Drive and Claude Folder.
