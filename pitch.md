# Spreadsheet Enhancer

**Upload a spreadsheet, get a real app.** Multi-sheet workbooks become a relational application with forms, filters, reports, and charts — running entirely in the browser, installable to your home screen, working offline.

## The pitch in one sentence

It's Microsoft Access, rebuilt for a phone, with no install and no server.

That analogy carries the whole feature set:

| Access concept | Here |
|---|---|
| Tables | Each sheet becomes a typed table |
| Relationships | Interlinked sheets detected as foreign keys — tap a customer, see their orders |
| Forms | Auto-generated record views with the right input per column type |
| Queries | Search, filter chips, sort |
| Reports | Charts, dashboards, PDF export |

## Two layers

**The shell** — your library. Every spreadsheet you've ever uploaded is a tile: name, row count, theme, last opened. Tap one to enter it, or upload a new workbook. This is the home screen.

**The generated apps** — each uploaded workbook becomes its own self-contained, independently themed application with its own data store. Ten spreadsheets, ten apps, one install.

## Core flow

1. **Upload from anywhere** — phone, tablet, desktop, iCloud, Drive, email attachment
2. **Inference** — real header row found, column types detected (date, currency, phone, email, enum), junk rows discarded, and cross-sheet relationships identified by matching key columns
3. **Review** — a plain-language confirmation screen: *"Status looks like a dropdown with 4 options. Correct?"* Editable, one time, then never again
4. **Use it** — full CRUD, validated, persisted, offline
5. **Get your data back** — export to XLSX, CSV, or PDF report, any time

## Mobile first. Tablet second. Desktop last.

**Phone** is the primary target and the design constraint: card lists, not tables. Sticky search, horizontal filter chips, full-screen record views, bottom-sheet pickers, thumb-zone actions. Phone numbers dial. Addresses open Maps. Dates use the native picker. Currency gets the numeric keypad.

**Tablet** in landscape earns the split view — record list left, detail right — which is the format this kind of app was born in.

**Desktop** gets the dense table and the multi-pane layout, built last, from the same components.

## Charts are first-class, not a dashboard afterthought

A real chart builder inside every generated app:

- Pick columns, pick a type — bar, line, pie, scatter, stacked
- **Cross-sheet charts** using the detected relationships: revenue by customer region, jobs per technician per month
- Save named charts to the app; pin favorites to its home view
- Charts are touch-native — tap a bar to filter the list beneath it
- Export any chart to PNG, or the whole dashboard to PDF

For most buyers this *is* the feature. They've never gotten a decent chart out of their spreadsheet and they'd like one on their phone.

## Themes

A set of built-in themes — and per-app customization, so each spreadsheet gets its own identity. Colors, accent, density, light/dark, maybe a logo. The invoicing workbook looks nothing like the inventory one.

This is more than polish: it's why a prospect stops seeing "a generic tool" and starts seeing "*my* app." It's also a free demo trick — same data, five skins, in ten seconds.

## Technical shape

- Static site on GitHub Pages, no backend, nothing to pay for
- Service worker + manifest → installable PWA, fully offline
- IndexedDB, namespaced per app, holding schema + data + theme + saved charts
- SheetJS for parsing, client-side rendering for charts, client-side PDF generation
- Data never leaves the device — which is a privacy feature, not a limitation, and matches the Forge story exactly