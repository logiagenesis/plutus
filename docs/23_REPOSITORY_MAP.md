# 23 — Repository map: what lives where (30 October 2026)

This replaces 17_DRIVE_FILE_INDEX.md (the 28 Oct inventory, kept as history). Inventory taken 30 Oct 2026 by listing every folder in the Drive Plutus tree and every file in GitHub, and comparing each mirrored document byte-for-byte.

Two homes:
- GitHub: https://github.com/logiagenesis/plutus — code, tests and every numbered document. No customer data.
- Google Drive (shared drive, private): https://drive.google.com/drive/folders/19wJFooMd-9_11eNlf5antaifsXl4J3RL — every numbered document, the source code as dated snapshots, the customer data, Sage exports, backups, originals from Dennis, and audit reports.
- Pointer copy in Claude Folder › Projects › Plutus: https://drive.google.com/drive/folders/1S6_yJ8nF0CN8tUhR8O6l11-7VBZoMB43 (plan summary only; the full repository is the shared-drive folder above).

## Drive folder layout
| Folder | What goes in it | GitHub equivalent |
|---|---|---|
| 00_Project_Control | All numbered docs 00–23 except 03, 04, 06, 09; the scheduled audit note | docs/ |
| 00_Project_Control/Audits | Full audit reports (dated) | Not in GitHub while the repo is public |
| 00_Project_Control/_Superseded | Older copies replaced by a newer dated upload | — |
| 01_Research | Research.txt (original) | references/Research.txt |
| 02_Reference_Audits | GPT5.5, Opus5.5, Grok4.7 transcripts (originals); monthly audit reports land here | references/ |
| 03_Development | Instructions - Design.txt (original) | references/Instructions-Design.txt |
| 03_Development/01_Design | 03_DESIGN_SPECIFICATION.md | docs/03 |
| 03_Development/02_Architecture_and_Hosting | 04_HOSTING_AND_ARCHITECTURE.md, 09_CLOUDFLARE_ACCOUNT_CHECK.md | docs/04, docs/09 |
| 03_Development/03_Build_Prompt | 06_MASTER_BUILD_PROMPT.md | docs/06 |
| 03_Development/04_Prototype/2026-10-27_v01 | Milestone 1 prototype HTML and screenshots (real customer names, so Drive only) | docs/15 describes it |
| 03_Development/05_Brand | Official PLU+US logo files | brand/ |
| LOGO (top level) | The logo files exactly as Dennis supplied them, plus download.zip | brand/ (same images) |
| 04_Data/2026-10-27_Sage_Export | Raw Sage export, import files v01/v02, review workbook | Never in GitHub (customer data) |
| 04_Data/Backups | Plutus backup files | Never in GitHub |
| 05_Source_Code | Dated zip snapshot of the GitHub repository, one per working round | The repository itself |

## Document status (both homes)
| Doc | GitHub | Drive (current copy) | Notes |
|---|---|---|---|
| 00_START_HERE | docs/00 | 00_START_HERE_2026-10-30.md | Old Drive copy 16WhNg84… is out of date |
| 01, 02, 05, 07, 08, 12, 13, 15, 16, 18, 19 | docs/ | 00_Project_Control, same names | Byte-identical on 30 Oct |
| 03, 04, 06, 09 | docs/ | 03_Development subfolders | Byte-identical on 30 Oct |
| 10_CONVERSATION_RECORD | docs/10 | 10_CONVERSATION_RECORD_2026-10-30.md | Old Drive copy 1ZLa90zh… lacked item 17 onward |
| 11_ACTION_AND_EVIDENCE_LEDGER | docs/11 | 11_ACTION_AND_EVIDENCE_LEDGER_2026-10-30.md | Old Drive copy 1Mdqf1QS… lacked 28 Oct login and 30 Oct |
| 14_SAGE_IMPORT_REPORT | docs/14 (bank account shown as last 4 digits) | 14_SAGE_IMPORT_REPORT.md (full number) | Deliberate difference: Drive is private |
| 17_DRIVE_FILE_INDEX | docs/17 | 17_DRIVE_FILE_INDEX.md | History; replaced by this file. 00_ARCHIVE_INDEX.md at Drive top level is an identical copy |
| 20_MOVE_TO_LOGIA_CLOUDFLARE_ACCOUNT | docs/20 | 20_MOVE_TO_LOGIA_CLOUDFLARE_ACCOUNT_2026-10-30.md | Old copies 1VigA57U… (Plutus) and 1TMHV8Xe… (Claude Folder) are out of date |
| 21_AUDIT_FIXES_2026-10-30 | docs/21 | 21_AUDIT_FIXES_2026-10-30.md | Identical |
| 22_SCHEDULED_AUDIT_SETUP_2026-10-27 | docs/22 | 2026-10-27_Plutus_Scheduled_Audit_Setup.md | Identical text; was Drive-only until 30 Oct |
| 23_REPOSITORY_MAP | docs/23 | 23_REPOSITORY_MAP.md | This file |
| Comprehensive audit 30 Oct 2026 | Not yet (repo is public) | 00_Project_Control/Audits/2026-10-30_Plutus_Comprehensive_Audit.md | Add to GitHub once the repo is private |
| Source code | app/, scripts/, brand/, references/ | 05_Source_Code/Plutus_source_<commit>.zip | Snapshot per round |

## Files to drag into 00_Project_Control/_Superseded (Dennis)
Claude's Drive connection can create files in the shared drive but cannot move, rename or delete them, so these stay where they are until moved by hand:
1. 00_Project_Control/00_START_HERE.md (old)
2. 00_Project_Control/10_CONVERSATION_RECORD.md (old)
3. 00_Project_Control/11_ACTION_AND_EVIDENCE_LEDGER.md (old)
4. 00_Project_Control/20_MOVE_TO_LOGIA_CLOUDFLARE_ACCOUNT.md (old)
5. Top level 00_ARCHIVE_INDEX.md (duplicate of 17)
6. Top level plutus-backup-2026-10-28-08-29-22.json → move to 04_Data/Backups instead
7. Claude Folder › Projects › Plutus › 20_MOVE_TO_LOGIA_CLOUDFLARE_ACCOUNT.md → that folder's _Superseded

## Never in GitHub (by design)
Customer data, Sage exports, import files, the review workbook, backups, the prototype (real customer names), full bank details, passwords and secrets.

## Rule for every round from now on
Every new or changed document goes to GitHub docs/ and to Drive in the same round, plus a dated source zip in 05_Source_Code and a chat summary in Claude Folder › Chat Logs. Drive copies that change get a dated name, and the older copy is listed here for moving to _Superseded.
