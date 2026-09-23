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

<!-- workbook-fidelity SESSION-05 -->
### workbook-fidelity SESSION-05 (2026-09-22, commits 871924f..5df4b01)

**M18 — ODS adapter (`src/import/formats/ods/`) — created**

- **Exports (landed):** `readOdsInventory` (M65 `InventoryReaderV1`, format `"ods"`), `odsAdapter` (M65 `WorkbookAdapterV1`) from `index.ts`. Internal, exported for tests: `convertOpenFormula` (`formula.ts`), `ODS_MAX_REPEATED_CELLS = 250_000` (`parse.ts`), `MIN_ODS_CELL_MARKUP_BYTES = 40`, `ODS_MIMETYPES`, `CHART_MEDIA_TYPE` (`inventory.ts`).
- **Files:** `vocabulary.ts` (ODF namespaces, ODF range addresses → Excel spelling / `RangeV1`), `formula.ts`, `styles.ts` (data styles → Excel-style format codes + class; cell-style inheritance; hidden table styles), `declarations.ts` (the parse-time pre-pass over `content.xml`: tables, content validations, named ranges, database ranges, automatic styles, document scripts, DDE links), `inventory.ts`, `parse.ts`, `index.ts`. (Custom Rule 7: `vocabulary.ts`, `formula.ts`, `declarations.ts` are beyond the planned file list — ODS declares validations and database ranges outside the sheet, so a pre-pass is structural.)
- **Edges:** M13 (`bounds`, `opc.partEvents`, `xml.tokenizeXml`, `zip` types), M65, M01 `values`. No other adapter, no third party (pipeline sweep green).
- **Inventory contract:** reads `mimetype`, `META-INF/manifest.xml`, `meta.xml`, `settings.xml`, and **no byte of `content.xml`** (spy-proven). Refusals: other ODF type / no mimetype → `unrecognized-content`; `manifest:encryption-data` → `encrypted-workbook`; any `Basic/` or `Scripts/` entry (archive or manifest) → `macro{script-part}`. `Configurations2/` (`application/vnd.sun.xml.ui.configuration`) is **not** a macro signal — every LibreOffice file carries it.
- **Sheet-name fallback:** names from `settings.xml`'s `Tables` view map when they agree with `meta:table-count`; otherwise `sheetListKnown: false` with `Table 1…n` placeholders (n = `meta:table-count`, else 1). The adapter reads **every** table for any non-empty selection when the list is unknown, none for an empty one.
- **Estimates:** workbook cells = `min(meta:cell-count, content.xml size / 40)`, split evenly over the sheets; `estimatedRowCount: null`; inventory reports every sheet `visible`, no declared tables, date system `1900` (all stated only inside `content.xml`; the stream carries the truth). Workbook-level part counts from the manifest: charts, embedded objects, pictures.
- **Stream contract:** repeats expanded sparsely (blank runs move the cursor; the million-row empty tail costs nothing); cells a repeat adds beyond those written count against `ODS_MAX_REPEATED_CELLS` → `expansion-limit` before emission; populated cell past the grid → `impossible-dimension`. Values: `float`/`percentage`/`currency` → canonical decimal; `date`/`time` → Excel 1900-system serial decimal (phantom 1900-02-29 kept) + date/datetime/time `cell-format`; `boolean`; `string` → NFC text; `calcext:value-type="error"` → invalid-preserved + `error-value`; misfit → invalid-preserved + `malformed-value`. Formulas: OpenFormula → Excel text where mechanical (`[.A1]`→`A1`, `[$S.$A$1:.$B$2]`→`S!$A$1:$B$2`, `;`→`,`, inline arrays), else `text: null` (+`isExternal` for another document); matrix spans → `isArray`. Validations (`table:content-validation` conditions: in-list inline/range, whole/decimal/date/time with between/compare, text-length, is-true-formula) coalesced into ranges; unsupported condition → `unsupported-validation` part. Merges from `number-*-spanned`; database ranges → `declared-table` (columns from the header row; LibreOffice's anonymous autofilter ranges skipped); named ranges/expressions → `defined-name` (first selected sheet); frames → `chart`/`embedded-object`/`image`/`drawing`/`form-control`; annotations → `comment`; `text:a` → `hyperlink`; `table:table-source`/`cell-range-source` → `external-link`; DDE → `data-connection`; event listeners → `script`; one `conditional-formatting` and one `cell-styling` per sheet.

<!-- workbook-fidelity OWNER-IMPORT-F03-SEAMS -->
### workbook-fidelity OWNER-IMPORT-F03-SEAMS (2026-09-23, commits 3a32561, 87da253)

- **Stream order (corrected):** per selected sheet, `sheet` → (first sheet only: `defined-name`, document `script`, `data-connection`) → the sheet's `declared-table` facts (database ranges) → rows → at the end, validations and the per-sheet `conditional-formatting` / `cell-styling` parts. Declared tables now precede the sheet's first `row` fact, the same as OOXML/XLSB (M21's ordering rule; previously they followed the rows, and inference split each table into a 1-row declared table plus a region).
- **Header pre-pass:** ODS gives a database range's column names only in its header row's cells, and declares the range after the last table. When a selected sheet has a range with `contains-header`, a second read of `content.xml` runs before any fact is emitted. It uses the same `SheetReader` with a discard emitter and a separate repeat budget. Each sheet is read only up to its last header row, and the pass stops after the last sheet that needs one. Memory stays bounded. Workbooks without named database ranges skip the pass.
- `content.xml` walking is shared by both passes through the internal `tableEvents(zip)` (open / inner event / close for each top-level `table:table`).
