# M18 — ODS adapter (`src/import/formats/ods/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Module Contracts / Format
> adapters. Reconciled against the tree at `425562d` (F03 final; code ≡
> `30396a9`).

## Contract

- **Owns:** Streaming ODS content/styles/validation/formula/chart facts and
  preserved unsupported objects, in the M65 fact contract.
- **Exports:** `readOdsInventory` (M65 `InventoryReaderV1`), `odsAdapter` (M65
  `WorkbookAdapterV1`).
- **Depends on:** M13 (`zip.ts`, `xml.ts`), M65.
- **Contract:** The inventory reads `mimetype`, `META-INF/manifest.xml`,
  `meta.xml` (`meta:document-statistic` table/cell counts) and `settings.xml`
  (per-table configuration) — **never `content.xml`'s cell elements** during
  pre-flight. When the metadata is silent, sizes are estimated from
  `content.xml`'s central-directory size. `table:number-columns-repeated` /
  `number-rows-repeated` are expanded sparsely and bounded against the
  budget. Basic/script parts refuse the whole import as macro content.
  OpenFormula text (`of:=`) is carried as formula text, never evaluated.

## Landed surface (SESSION-05, ordering corrected by OWNER-IMPORT-F03-SEAMS)

- **Exports (landed):** `readOdsInventory` (format `"ods"`), `odsAdapter`
  from `index.ts`. Internal, exported for tests: `convertOpenFormula`
  (`formula.ts`), `ODS_MAX_REPEATED_CELLS = 250_000` (`parse.ts`),
  `MIN_ODS_CELL_MARKUP_BYTES = 40`, `ODS_MIMETYPES`, `CHART_MEDIA_TYPE`
  (`inventory.ts`).
- **Files:** `vocabulary.ts`, `formula.ts`, `styles.ts` (data styles → Excel-
  style format codes + class; cell-style inheritance; hidden table styles),
  `declarations.ts` (the parse-time pre-pass over `content.xml`: tables,
  content validations, named ranges, database ranges, automatic styles,
  document scripts, DDE links), `inventory.ts`, `parse.ts`, `index.ts`.
  (Custom Rule 7: `vocabulary.ts`, `formula.ts`, `declarations.ts` — ODS
  declares validations and database ranges outside the sheet, so a pre-pass
  is structural.)
- **Edges:** M13 (`bounds`, `opc.partEvents`, `xml.tokenizeXml`, `zip`
  types), M65, M01 `values`. No other adapter, no third party.
- **Inventory contract:** reads `mimetype`, `META-INF/manifest.xml`,
  `meta.xml`, `settings.xml`, and **no byte of `content.xml`** (spy-proven).
  Refusals: other ODF type / no mimetype → `unrecognized-content`;
  `manifest:encryption-data` → `encrypted-workbook`; any `Basic/` or
  `Scripts/` entry → `macro{script-part}`. `Configurations2/`
  (`application/vnd.sun.xml.ui.configuration`) is **not** a macro signal —
  every LibreOffice file carries it.
- **Sheet-name fallback:** names from `settings.xml`'s `Tables` view map when
  they agree with `meta:table-count`; otherwise `sheetListKnown: false` with
  `Table 1…n` placeholders. The adapter reads **every** table for any
  non-empty selection when the list is unknown, none for an empty one.
- **Estimates:** workbook cells = `min(meta:cell-count, content.xml size /
  40)`, split evenly over the sheets; `estimatedRowCount: null`; inventory
  reports every sheet `visible`, no declared tables, date system `1900`.
  Workbook-level part counts from the manifest: charts, embedded objects,
  pictures.
- **Stream contract:** repeats expanded sparsely; cells a repeat adds beyond
  those written count against `ODS_MAX_REPEATED_CELLS` →
  `expansion-limit` before emission; populated cell past the grid →
  `impossible-dimension`. Values: `float`/`percentage`/`currency` →
  canonical decimal; `date`/`time` → Excel 1900-system serial decimal
  (phantom 1900-02-29 kept) + date/datetime/time `cell-format`; `boolean`;
  `string` → NFC text; `calcext:value-type="error"` → invalid-preserved +
  `error-value`; misfit → invalid-preserved + `malformed-value`. Formulas:
  OpenFormula → Excel text where mechanical, else `text: null`
  (+`isExternal`); matrix spans → `isArray`. Validations coalesced into
  ranges; unsupported condition → `unsupported-validation` part. Merges from
  `number-*-spanned`; database ranges → `declared-table`; named
  ranges/expressions → `defined-name`; frames → `chart`/`embedded-object`/
  `image`/`drawing`/`form-control`; annotations → `comment`; `text:a` →
  `hyperlink`; `table:table-source`/`cell-range-source` → `external-link`;
  DDE → `data-connection`; event listeners → `script`; one
  `conditional-formatting` and one `cell-styling` per sheet.

## F03 correction: declared-table ordering (OWNER-IMPORT-F03-SEAMS, closed)

**Stream order (as corrected):** per selected sheet, `sheet` → (first sheet
only: `defined-name`, document `script`, `data-connection`) → the sheet's
`declared-table` facts (database ranges) → rows → at the end, validations and
the per-sheet `conditional-formatting`/`cell-styling` parts. Declared tables
now precede the sheet's first `row` fact, matching OOXML/XLSB (M21's
ordering rule). Before the fix, they followed the rows and inference split
each table into a 1-row declared table plus a region — a real defect,
verified with a negative control and closed by `3a32561`
(`fieldwork-jobs-customers.ods` now infers `s0.t0` = 60 rows and `s1.t0` = 12
rows, unchanged fact counts, only the position of `declared-table` moved;
promotion writes 72 records, the same as before).

**Header pre-pass:** ODS gives a database range's column names only in its
header row's cells, and declares the range after the last table. When a
selected sheet has a range with `contains-header`, a second read of
`content.xml` runs before any fact is emitted (bounded header pre-pass, its
own repeat budget). Each sheet is read only up to its last header row.
Memory stays bounded; workbooks without named database ranges skip the pass.
`content.xml` walking is shared by both passes through the internal
`tableEvents(zip)`.

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-05 (`871924f`..`5df4b01`); registered and
  proven through the real worker by SESSION-06 (`4287569`..`677b947`).
- 2026-09-23 — declared-table ordering counterexample closed by
  OWNER-IMPORT-F03-SEAMS (`3a32561`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-05 and
  OWNER-IMPORT-F03-SEAMS deltas folded into "Landed surface" and the
  ordering-correction section, so the fragment states the **current**
  stream order once rather than the defective order followed by a patch.
