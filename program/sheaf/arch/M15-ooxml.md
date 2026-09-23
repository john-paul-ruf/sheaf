# M15 — OOXML adapter (`src/import/formats/ooxml/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table), § Module Contracts / Format adapters,
> § Import Architecture Stages 1–2 and § Fidelity and preservation.

## Contract

- **Owns:** Streaming XLSX/OPC facts: relationships, shared strings, cells,
  formulas (including shared and array formulas), styles and number formats,
  data validations, declared tables, merges, defined names, charts, pivots,
  drawings, comments, external links and the unsupported-part inventory.
- **Exports (planned, F03 S01):** `readOoxmlInventory` (an M65
  `InventoryReaderV1` — metadata only), `ooxmlAdapter` (an M65
  `WorkbookAdapterV1` — `parseSheets(container, selection, options)` →
  `AsyncGenerator<WorkbookFactStreamItemV2>`).
- **Depends on:** M13 (`zip.ts` container, `xml.ts` tokenizer), M65.
- **Contract:**
  - **The inventory never opens a worksheet part.** It reads
    `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml` and its rels, table
    parts and the worksheet `<dimension>` element **only through a bounded
    prefix read** that stops at `<sheetData>`. A spy-source test proves no byte
    of any `sheetData` is read during pre-flight (architecture § Parser and
    fidelity corpus, first assertion).
  - A macro signal (`vbaProject.bin`, a macro-enabled content type, an
    `xl/macrosheets/` part, a renamed `.xlsm`) is an inventory outcome that
    refuses the whole import before a stage exists; the parser never sees it.
  - Incremental and cancellable; sparse (a far-corner `<dimension>` never
    allocates); every allocation compared to the active import budget.
  - Formula text is carried, never evaluated. Cached values become ordinary
    value facts; the formula is a separate fact.
  - External links are never fetched; their text and cached value are preserved
    and identified as inert.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/application/`, any third-party package (zip.js is reached only through
  M13's `zip.ts`), or any other adapter directory. Swept by
  `tests/unit/import/module-boundaries.test.ts`.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).

<!-- workbook-fidelity SESSION-01 -->
### workbook-fidelity SESSION-01 (2026-09-22, commits dd1ff9e..64bc49a)

**M15 — OOXML adapter (`src/import/formats/ooxml/`) — created**
- Exports: **`ooxmlInventoryReader`** (the planned `readOoxmlInventory` name, as an `InventoryReaderV1` value) and `ooxmlAdapter` (`index.ts`). Internal files: `parts.ts` (namespaces for Strict + Transitional, `parseCellRef`/`parseRange`/`parseSqref` — out-of-grid ⇒ `impossible-dimension`), `drawings.ts` (`readDrawingObjects`, `readCommentAnchors`), `inventory.ts` (`MIN_CELL_MARKUP_BYTES = 12`, `SHEET_PREFIX_MAX_BYTES = 1 MiB`, `macroSignalOf`, `readWorkbookPart`, `sheetPartsOf`, `readDeclaredDimension`, `readTablePart`), `styles.ts`, `shared-strings.ts` (`SHARED_STRINGS_MAX_COUNT = 1_048_576`, `SHARED_STRINGS_MAX_CHARACTERS = 33_554_432`), `sheet.ts`, `parse.ts`.
- Inventory is metadata only; the worksheet prefix read stops at `<sheetData>` (spy-proven, `tests/unit/import/ooxml/preflight.test.ts`).
