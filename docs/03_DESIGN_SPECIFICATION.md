# Design specification — Obsidian Glass
Date: 27 October 2026. Proposed art direction, not a completed interface or user-approved mockup.

## Intent
Make Logi-Ink's daily finance workspace feel meticulously crafted: reflective near-black surfaces, cool light, translucent navigation, softly illuminated tiles and precise typography. Beauty must survive a screen full of actual invoices, long customer names and import errors.

## Evidence and application
| Source read/inspected | Finding used | Application |
|---|---|---|
| Apple software design announcement, 9 June 2025: https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/ | Reflective/translucent material supports controls, navigation and content focus | Place glass in interface framing and selected summary surfaces |
| Apple iOS page CSS, inspected with MiroMiro: https://www.apple.com/os/ios/ | Extracted rounded surfaces, inset highlights, short transitions and system typography | Inspiration for material construction, not a copy of Apple's assets or native renderer |
| Figma 2026 trends: https://www.figma.com/resource-library/web-design-trends/ | Dark themes, purposeful motion, accessibility and lean delivery are relevant themes | Use a coherent dark theme and restrained interaction feedback |
| W3C WCAG 2.2 reference: https://www.w3.org/WAI/WCAG22/quickref/ | Contrast, keyboard access, focus and reflow requirements | Target AA; test actual composed glass backgrounds |
| IBM Carbon data table guidance: https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines | Sorting, filtering, selection and progressive disclosure support data work | Stable finance tables with a purposeful toolbar |
| Google Web Vitals: https://web.dev/articles/vitals | LCP, INP and CLS describe loading, responsiveness and stability | Performance targets below |

The Apple HIG materials page was attempted but its Markdown response could not be retrieved by the web tool; it is not counted as successfully read. The MiroMiro result is marketing-page CSS, not proof of native iOS implementation. This is a focused design review, not a claimed ranking or audit of 25 websites.

## Proposed tokens
These values are original starting choices to validate in rendered screens, not extracted brand standards.
| Token | Starting value |
|---|---|
| Canvas | #070A0F |
| Solid work surface | #111820 |
| Elevated surface | #18222E |
| Main text | #F4F7FB |
| Secondary text | #AEBBCD |
| Accent | #5BE4EF |
| Secondary glow | #7A92FF |
| Success / warning / danger | #70E0AE / #FFD17B / #FF8E9C |
| Glass fill | rgba(20, 29, 42, 0.80), adjusted after contrast testing |
| Hairline | rgba(220, 238, 255, 0.16) |
| Radius | 12 px controls; 20–24 px feature tiles; 16 px panels |
| Spacing | 4, 8, 12, 16, 24, 32, 48 px |
| Type | Licensed system sans or open-licensed Inter; tabular numerals for money |
| Motion | 140–220 ms interaction transitions; short, subtle panel transitions |

No logo was supplied in the audited folder. Use a text wordmark in prototypes. Do not invent a logo and describe it as the existing Logi-Ink mark.

## Material construction
Layer a deep canvas, low-intensity static radial illumination, tinted panel fill, a restrained blur, thin edge highlight and soft shadow. Keep the number and area of blurred layers low. A hover may increase the edge light and add a local highlight; it must not shift rows, move buttons or obscure values.
Implement hover effects only on hover-capable devices. Keyboard focus must be equally visible. Provide reduced-motion and reduced-transparency modes and an opaque CSS fallback. No continuously animated video or WebGL background is needed.
Dense tables, numeric inputs, validation messages and PDF pages use stable solid surfaces. Glass surrounds them without compromising their legibility.

## Layout
Desktop: compact sidebar, top context/search bar and spacious main workspace. Navigation: Overview, Customers, Quotes, Invoices, Recurring, Statements, Banking, Reports, Settings. Items may sit under settings or a small secondary route.
Tablet: collapsible navigation; preserve work area. Mobile: compact navigation with labelled destinations; stack editors and matching panels. A table may have an explicit horizontal scroll container; the whole page must not overflow.
Primary action stays consistent per screen. Avoid a wall of equal-weight buttons. Keep contextual actions in row menus and details panels.

## Key screen briefs
1. Overview: four meaningful summary tiles, overdue work queue, unmatched bank count, recurring runs requiring attention and recent activity. Label time ranges and data freshness. Empty state explains setup; zero is not fabricated activity.
2. Invoice list: customer/name search, status/date filters, sortable columns, amount/paid/balance alignment, selection only where useful. Clicking opens a stable details view.
3. Invoice editor: customer and dates, keyboard-friendly line grid, visible subtotal/discount/tax/total, notes and terms, save-state feedback, accessible line controls. Desktop PDF preview beside editor; mobile preview tab. Explicit issue/send confirmation.
4. Banking: import wizard with upload, mapping, preview/validation and commit. Reconciliation workspace places the bank row alongside candidate documents, with amount remaining and exact allocation total always visible.
5. Recurring: next run, frequency, status and preview; distinguish template edits from one-off draft edits. Preview period tokens and month-end behaviour before activation.
6. Statements: customer/date range, opening balance, movements, closing balance and PDF preview. Outstanding-only is a separate view.
7. Settings: business identity, numbering, tax, sender, access, exports and backup status; show incomplete production configuration clearly.

## Interaction and accessibility gates
Target WCAG 2.2 AA. Normal text at least 4.5:1, qualifying large text 3:1, essential UI boundaries/indicators 3:1 where required. Test on actual composite backgrounds and all states. Statuses use text/icons as well as colour.
Use semantic headings, labelled inputs, visible focus, accessible dialogs, keyboard navigation and recoverable inline errors. Prefer 44 px touch controls; verify WCAG target-size rules and exceptions rather than claiming 44 px is the AA minimum. Support 200% zoom and small-screen reflow.
Every screen needs loading, empty, populated, error, permission-denied, saving, saved and stale/conflict states as relevant. Never claim success until persisted.

## Performance and review
Aim for field p75 LCP <=2.5 s, INP <=200 ms, CLS <=0.1. Before real traffic exists, report lab results and conditions honestly; do not label a Lighthouse run as field evidence.
Review 390, 768, 1440 and 1920 px layouts, long names, large amounts, many rows, keyboard-only use and reduced effects. Test Chromium, Firefox and Safari/WebKit where available; record unavailable coverage.
First design milestone must demonstrate Overview, Invoice Editor and Bank Matching in a browser with explicitly fictional data. Capture screenshots and record concrete defects fixed. A polished landing page alone does not satisfy this brief.

## Design acceptance rubric
Score craft, hierarchy, readability, interaction, responsiveness and accessibility from 1–5 with screenshot/test evidence. Aim for 4+ in each, but no subjective score overrides a broken task, inaccessible control or incorrect number.
Reject default component-library styling, oversized empty dashboards, gratuitous glow, low-contrast grey text, glass on every table row, distracting animation and fake financial activity.
