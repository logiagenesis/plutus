# Plutus — start here (current as of 28 October 2026)

Plutus is the Logi-Ink in-house replacement for Sage Business Cloud Accounting. It invoices as Logia Services (Pty) Ltd now; Logi-Ink (Pty) Ltd is waiting for its company details.

## Where everything lives
- Live app (Cloudflare Access sign-in required): https://plutus.denweb82.workers.dev
- Code and docs: https://github.com/logiagenesis/plutus (private). Every push to main builds and deploys automatically (Cloudflare Workers Builds, root /app).
- Cloudflare: Worker "plutus", D1 database "plutus" (d0ce91f8-0ae6-4844-99a8-846ed46caaf6), account ddcd0a9eefadc42e5826dcbc4ef94cd4, Access team https://denweb.cloudflareaccess.com.
- Drive: shared drive Google Desktop › Plutus (folder 19wJFooMd-9_11eNlf5antaifsXl4J3RL). Customer data lives only here (04_Data), never in GitHub.
- Logo: brand/ in GitHub and Drive 03_Development/05_Brand (official PLU+US files from Dennis).
- Monthly audit: scheduled task "Plutus monthly audit (22nd, before recurring run)", 05:00 SAST on the 22nd.

## What works today (verified 28 Oct 2026)
- All Sage data is in the live database: 112 customers, 212 items, 16 recurring invoices, 625 invoices (R 1,170,054.45), 317 quotes, 3 credit notes. Next numbers: INV00006946, QUO001302, CRN0000125.
- Create, save and issue invoices and quotes (numbers assigned on issue), add and edit customers and items, import from Sage.

## Not built yet
Sending email from accounts@logia.co.za, PDF download, bank statement (FNB CSV) import and matching, the automatic recurring run on the 25th (Sage still sends these), nightly backup to Drive, Logi-Ink setup, editing company settings.

## Open questions for Dennis
- Is Logia Services VAT-registered? (No VAT number in Sage; no VAT charged since September 2023.)
- Logi-Ink details: registration and VAT numbers, bank details, logo use, sender address, last invoice number.
- FNB statement CSV exports for building the bank matching.

## Read next
10_CONVERSATION_RECORD.md (what Dennis asked and decided), 11_ACTION_AND_EVIDENCE_LEDGER.md (what was done and how it was checked), 14_SAGE_IMPORT_REPORT.md, 15_MILESTONE1_PROTOTYPE.md, 18_BRAND_PLUTUS.md, 17_DRIVE_FILE_INDEX.md.

---

## Preserved preparation snapshot

# Plutus — preparation pack
Date: 27 October 2026 (Africa/Johannesburg)
Status: planning complete for the proposed first build; application not built or deployed.

## Direction
Build an internal Logi-Ink quoting, invoicing, recurring billing, customer statement and bank-import matching application. Design is a first-class requirement: reflective black, cool illumination, tactile glass tiles, refined Apple-inspired layering. The supplied model audits are context, information and ideas, as Dennis clarified in this conversation. They are not approved specifications, proof of vendor behaviour, or an instruction to reproduce every suggested module.

## Read in this order
1. 01_SOURCE_AUDIT.md — all supplied files, repository state, contradictions and missing evidence.
2. 02_PRODUCT_REQUIREMENTS.md — confirmed intent, proposed scope and open business inputs.
3. 03_DESIGN_SPECIFICATION.md — visual direction, screen specifications and quality gates.
4. 04_HOSTING_AND_ARCHITECTURE.md — verified provider constraints and recommended approach.
5. 05_DELIVERY_AND_OPERATIONS.md — milestones, tests, migration, backup and documentation.
6. 06_MASTER_BUILD_PROMPT.md — reusable implementation prompt.

## Where everything belongs
Google Drive root: https://drive.google.com/drive/folders/19wJFooMd-9_11eNlf5antaifsXl4J3RL
GitHub: https://github.com/logiagenesis/plutus

| Drive folder | Contents | GitHub equivalent |
|---|---|---|
| 00_Project_Control | Index, source audit, scope, delivery plan, session record | docs/00, 01, 02, 05 and 07 files |
| 01_Research | Original Research.txt | references/Research.txt |
| 02_Reference_Audits | Original GPT5.5, Opus5.5 and Grok4.7 transcripts | references/ files |
| 03_Development | Original design instructions | references/Instructions-Design.txt |
| 03_Development/01_Design | Design specification | docs/03_DESIGN_SPECIFICATION.md |
| 03_Development/02_Architecture_and_Hosting | Hosting and architecture | docs/04_HOSTING_AND_ARCHITECTURE.md |
| 03_Development/03_Build_Prompt | Master build prompt | docs/06_MASTER_BUILD_PROMPT.md |

Original files retain their contents and IDs. Folder names are normalised for navigation. GitHub reference copies are readable text snapshots retrieved through Drive, not claimed byte-for-byte downloads.

## Recommended decision
Prototype React + TypeScript with Cloudflare Workers Static Assets/API and D1. Validate authentication, transactional writes, representative import CPU, PDF generation, latency and restore before committing production data. Free hosting is conditional on measured usage and provider terms. The documented paid Workers fallback starts at USD 5/month plus applicable overages and separate services. No hosting account, billing subscription or deployment is created by this pack.

## What is settled and what is not
Settled: the source inventory was read; the repository initially held only README.md; design direction and core workflow intent are documented.
Proposed: architecture, detailed states, acceptance gates, implementation order and visual tokens.
Unresolved: legal entity/VAT setup, real bank formats and volumes, access list, domain and email sender, opening balances and migration scope.
No claim is made that 20 competitors, 20 training websites or 25 design websites were fully audited. Those numbers appear in contextual source briefs. This pack uses focused current provider and design evidence and does not invent completed research.

## Latest account check
See [09_CLOUDFLARE_ACCOUNT_CHECK.md](https://github.com/logiagenesis/plutus/blob/main/docs/09_CLOUDFLARE_ACCOUNT_CHECK.md) for the verified Cloudflare inventory, billing-access limitation and documentation review. A matching copy is saved in Drive under 03_Development/02_Architecture_and_Hosting. The original verification manifest covers its named historical commit, not later updates.

## Conversation and action records
- [10_CONVERSATION_RECORD.md](https://drive.google.com/file/d/1ZLa90zh9YB7c7kGeFiuTkqWaQmsHVx2M/view?usp=drivesdk) — user instructions and chronological decisions.
- [11_ACTION_AND_EVIDENCE_LEDGER.md](https://drive.google.com/file/d/1Mdqf1QSyMyARz-PwuAd_TvKaa-Jyh_L-/view?usp=drivesdk) — actions, failures, checks, commits and outstanding work.
- 12_ASSISTANT_MESSAGE_ARCHIVE.md — assistant messages through the stated capture boundary.
All three records are in Drive/00_Project_Control and GitHub/docs. These cover this project conversation, not unavailable historical chats. Append dated records every substantive round.
