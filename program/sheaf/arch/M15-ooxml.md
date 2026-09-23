# M15 — OOXML adapter (`src/import/formats/ooxml/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table), § Module Contracts / Format adapters,
> § Import Architecture Stages 1–2 and § Fidelity and preservation.
> Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Streaming XLSX/OPC facts: relationships, shared strings, cells,
  formulas (including shared and array formulas), styles and number formats,
  data validations, declared tables, merges, defined names, charts, pivots,
  drawings, comments, external links and the unsupported-part inventory.
- **Exports:** `ooxmlInventoryReader` (an M65 `InventoryReaderV1` — metadata
  only), `ooxmlAdapter` (an M65 `WorkbookAdapterV1` —
  `parseSheets(container, selection, options)` →
  `AsyncGenerator<WorkbookFactStreamItemV2>`).
- **Depends on:** M13 (`zip.ts` container, `xml.ts` tokenizer, `opc.ts`), M65.
- **Contract:**
  - **The inventory never opens a worksheet part.** It reads
    `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` and its rels, table
    parts and the worksheet `<dimension>` element **only through a bounded
    prefix read** that stops at `<sheetData>`. A spy-source test proves no byte
    of any `sheetData` is read during pre-flight.
  - A macro signal (`vbaProject.bin`, a macro-enabled content type, an
    `xl/macrosheets/` part, a renamed `.xlsm`) is an inventory outcome that
    refuses the whole import before a stage exists; the parser never sees it.
  - Incremental and cancellable; sparse (a far-corner `<dimension>` never
    allocates); every allocation compared to the active import budget.
  - Formula text is carried, never evaluated. Cached values become ordinary
    value facts; the formula is a separate fact.
  - External links are never fetched; their text and cached value are preserved
    and identified as inert.

## Landed surface (SESSION-01)

Exports: `ooxmlInventoryReader` (the `readOoxmlInventory` role, as an
`InventoryReaderV1` value) and `ooxmlAdapter` (`index.ts`). Internal files:
`parts.ts` (namespaces for Strict + Transitional,
`parseCellRef`/`parseRange`/`parseSqref` — out-of-grid ⇒
`impossible-dimension`), `drawings.ts` (`readDrawingObjects`,
`readCommentAnchors`), `inventory.ts` (`MIN_CELL_MARKUP_BYTES = 12`,
`SHEET_PREFIX_MAX_BYTES = 1 MiB`, `macroSignalOf`, `readWorkbookPart`,
`sheetPartsOf`, `readDeclaredDimension`, `readTablePart`), `styles.ts`,
`shared-strings.ts` (`SHARED_STRINGS_MAX_COUNT = 1_048_576`,
`SHARED_STRINGS_MAX_CHARACTERS = 33_554_432`), `sheet.ts`, `parse.ts`.

Inventory is metadata only; the worksheet prefix read stops at `<sheetData>`
(spy-proven, `tests/unit/import/ooxml/preflight.test.ts`). Consumed by S06's
worker registration (`src/workers/import/adapters.ts`, D35) and proven through
the first narrow journey (S06 CP3) and every subsequent e2e/gate proof.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/application/`, any third-party package (zip.js is reached only through
  M13's `zip.ts`), or any other adapter directory. Swept by
  `tests/unit/import/module-boundaries.test.ts`.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-01 (`dd1ff9e`..`64bc49a`); registered and
  proven through the real worker by SESSION-06 (`4287569`..`677b947`) — the
  first narrow journey (CP3) parses the pinned demo `.xlsx` through this
  adapter.
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-01 delta
  folded into "Landed surface"; no contradiction found.

<!-- formulas-queries-charts SESSION-02 -->
### F04 delta — SESSION-02 (M15 — OOXML adapter (`src/import/formats/ooxml/`))

- New `charts.ts`: `readChartDefinition(zip, partPath) → PartDefinitionReadV1<ChartPartDefinitionV1>`. It does a bounded streaming read to the end of `c:chart`. The first `c:plotArea` plot element sets the type; a combo (more than one plot) → `other`. Cached points are never read.
  - Also exports `PartDefinitionReadV1<T>` (`{definition, refusal: null} | {definition: null, refusal}`), `PartDefinitionRefusalV1` (`not-declared | over-bounds | unsupported-source | UnreadableDetailV1`) and `refusedDefinition`.
  - A refusal (DTD, bounds, no plot) is contained: the fact stays F03's, without a definition.
- New `pivots.ts`: `readPivotDefinition(zip, pivotPart)`. It reads `pivotTableDefinition` (rowFields/dataFields), follows the pivot part's own `pivotCacheDefinition` relationship, and reads `cacheSource`/`worksheetSource`/`cacheFields`. `pivotCacheRecords` is never opened.
- `sheet.ts`: `preservedPart(...)` takes an optional 5th `definition` argument. The drawing (chart) and `pivottable` relationship cases attach definitions. Chart sheets reach charts through their drawing, so the same path applies.
- No new import edges: the `ooxml` → M13 (`source/*`) and M65 (`facts/*`) edges already existed.
