# Milestone 1 — clickable prototype
Date: 27 October 2026. Status: browser prototype on real Logia Services data (imported from Sage). There is no database yet: anything created is kept in memory and lost on reload.

## Dennis's brief for this round
Focus on design, look and feel. High quality. Ease of use is top priority. He is used to Sage, so keep it simple. He is a business owner, not an accountant.

## What was built (app/)
- Navigation that mirrors Sage's main areas: Home, Invoices, Quotes, Customers, Recurring, Items, Bank (placeholder for the next step), Settings. A company switcher for Logia Services and Logi-Ink (Logi-Ink shows what is needed to set it up).
- Home: next recurring run (date, amount, customers), invoiced this month and this year, quotes waiting, payments to check, customers, and recent activity.
- Invoices and quotes: search by number, customer or item; filter by year and status; 25 per page; a document view showing the invoice exactly as the customer gets it.
- New invoice and new quote: search-as-you-type customer; one click to reuse the customer's last invoice lines; an item picker that fills in the price; quantity, price and discount; one "Add VAT (15%)" switch; live totals and a live paper preview. Due date defaults to month end, which matches all 284 Sage invoices since January 2025. Numbering continues from Sage (INV00006946, QUO001302). A quote can be turned into an invoice.
- Customers: list ordered by most recent invoice, with contact details, recurring billing and invoice history.
- Recurring: all 16 templates with their next run date and amount. 25 Nov 2026 is verified as a Wednesday.
- Plain language throughout. Invoices without a recorded payment show "Not checked", with an explanation, never "Overdue", because Sage was not used to record payments.

## Design
"Obsidian Glass" from 03_DESIGN_SPECIFICATION.md: a reflective near-black canvas with static cool light, translucent navigation and summary tiles that light up under the pointer (keyboard focus gets the same light), and solid surfaces for tables and inputs so numbers stay readable. The typeface is Geist, an open licence (OFL-1.1) font, bundled in the app, with tabular numerals for money. The one bold element is the lit calendar day on Home for the next recurring run. Reduced-motion and reduced-transparency settings are respected.

## Verification
- Money engine (app/src/money.ts): it recomputes all 3,100 imported Sage lines and 961 documents exactly (vitest; the test runs only where the private dataset exists). One finding while doing this: Sage rounds the discounted amount half-up and treats the discount as the remainder. The engine now does the same.
- Home figures were cross-checked by script: October 18 invoices, R 14,890.00; 2026 to date R 114,145.08; 2 quotes waiting, R 9,366.00; 621 invoices with no payment recorded.
- TypeScript strict build passes. Playwright clicked through every navigation item and the company switcher. A full invoice was created by reusing a customer's last invoice (R 1,740.00), saved as draft INV00006946. No page errors.
- No horizontal page scroll at 390, 768, 1440 or 1920 px.
- Not yet done: a formal contrast measurement, Firefox/Safari testing, and Lighthouse.

## Privacy
Real customer data is never committed. app/src/data/ is git-ignored. Screenshots and the published preview contain real data, so they are stored in Drive (03_Development/04_Prototype) and in a private Claude page only.

## Not built yet (next)
Database and saving (Milestone 2), sending email, PDF download, bank statement import and matching, adding or editing customers and items, credit notes, Logi-Ink setup.
