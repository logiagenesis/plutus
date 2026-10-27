# Accounting666 — preparation pack
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
GitHub: https://github.com/logiagenesis/accounting666

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
