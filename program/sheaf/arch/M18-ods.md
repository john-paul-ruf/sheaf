# M18 — ODS adapter (`src/import/formats/ods/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Module Contracts / Format
> adapters.

## Contract

- **Owns:** Streaming ODS content/styles/validation/formula/chart facts and
  preserved unsupported objects, in the M65 fact contract.
- **Exports (planned, F03 S05):** `readOdsInventory` (M65 `InventoryReaderV1`),
  `odsAdapter` (M65 `WorkbookAdapterV1`).
- **Depends on:** M13 (`zip.ts`, `xml.ts`), M65.
- **Contract:** The inventory reads `mimetype`, `META-INF/manifest.xml`,
  `meta.xml` (`meta:document-statistic` table/cell counts) and `settings.xml`
  (per-table configuration) — **never `content.xml`'s cell elements**. When the
  metadata is silent, sizes are estimated from the `content.xml` central-
  directory sizes and presented as estimates, never measured by reading cells.
  `table:number-columns-repeated` / `number-rows-repeated` are expanded sparsely
  and bounded against the budget — a repeated-blank run is never materialised.
  Basic/script parts (`Basic/`, `Scripts/`, manifest script entries) refuse the
  whole import as macro content. OpenFormula text (`of:=`) is carried as
  formula text, never evaluated.

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
