# M20 — HTML-table adapter (`src/import/formats/html-table/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Fidelity and preservation.

## Contract

- **Owns:** A non-executing tokenizer for legacy HTML table exports (typically
  disguised as `.xls`), producing value-only M65 facts.
- **Exports (planned, F03 S05):** `readHtmlTableInventory` (M65
  `InventoryReaderV1`), `htmlTableAdapter` (M65 `WorkbookAdapterV1`).
- **Depends on:** M13 (`RandomAccessSource`), M65. Its own tokenizer — **not**
  M13's XML tokenizer, because legacy HTML is not well-formed XML.
- **Contract:** Scripts, styles, event attributes, images, links and external
  resources are ignored; only table structure (`table`/`tr`/`td`/`th`,
  `colspan`/`rowspan` expanded sparsely and bounded) and decoded text become
  value-only facts. Each `<table>` is one sheet in document order. Entities are
  decoded from a fixed table plus numeric references; nothing is fetched, no
  markup reaches any snapshot, and the ignored active content is inventoried as
  inert (`script`, `external-link`, `image`) rather than silently dropped
  (FR-9).

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
