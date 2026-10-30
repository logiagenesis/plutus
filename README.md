# Plutus

Logi-Ink's in-house invoicing app, built to replace Sage Business Cloud Accounting. React + TypeScript front end and a Cloudflare Worker API on a D1 (SQLite) database, in app/.

Start here: [docs/00_START_HERE.md](docs/00_START_HERE.md) · What lives where: [docs/23_REPOSITORY_MAP.md](docs/23_REPOSITORY_MAP.md) · Latest work: [docs/21_AUDIT_FIXES_2026-10-30.md](docs/21_AUDIT_FIXES_2026-10-30.md)

Google Drive project (private, holds the customer data, backups and originals): https://drive.google.com/drive/folders/19wJFooMd-9_11eNlf5antaifsXl4J3RL

Build and test (from app/): npm ci, then npm run build and npm test. Every push to main deploys through Cloudflare Workers Builds (root /app).

Customer data, Sage exports and backups are never committed (see .gitignore). Production readiness is not claimed: Sage is still the live system until a full recurring run from Plutus has been checked against it.
