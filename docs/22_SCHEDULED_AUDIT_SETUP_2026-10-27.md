# Plutus — scheduled monthly audit (set up 27 Oct 2026)

Scheduled task ID: trig_016UvNY6yPn5WQEFDMvEagqH
Name: Plutus monthly audit (22nd, before recurring run)
Schedule: 22nd of every month, 05:00 SAST (cron: CRON_TZ=Africa/Johannesburg 0 5 22 * *). First run: 22 Nov 2026.
Runs in the cloud (no access to Dennis's computer or live Sage).
Approval setting: automatic.

Checks:
1. Code health — clone logiagenesis/plutus, build, tests, lint, security, dependency audit, commits since last audit.
2. Data integrity — recompute baseline counts/totals from the 27 Oct 2026 Sage export (112 customers, 625 invoices, R 1,170,054.45, monthly recurring R 8,159.00).
3. Recurring run check — every invoice due on the 25th, recomputed; SAFE / NOT SAFE verdict.
4. Docs vs reality — repo + Drive docs vs actual code.

Mode: read-only. No commits, PRs or Sage changes.

Output:
- Report: Plutus/02_Reference_Audits/YYYY-MM-DD_Plutus_Monthly_Audit.md
- Summary note: Claude Folder/Chat Logs
- Full report emailed to denweb82@gmail.com (Gmail), plus push + platform email notification.
