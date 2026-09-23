# M16 — XLSB adapter (`src/import/formats/xlsb/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Module Contracts / Format
> adapters. Reconciled against the tree at `425562d` (F03 final; code ≡
> `30396a9`).

## Contract

- **Owns:** Streaming XLSB (BIFF12) record parsing into the same M65 fact
  contract as OOXML, including macro-sheet detection.
- **Exports:** `readXlsbInventory` (M65 `InventoryReaderV1`), `xlsbAdapter`
  (M65 `WorkbookAdapterV1`).
- **Depends on:** M13 (`zip.ts`, `opc.ts`), M65, and **M17's `Ptg` formula
  decoder** (`src/import/formats/biff/ptg.ts`) — BIFF8 and BIFF12 share the
  parsed-token formula representation and its function-id table, so there is
  exactly one decoder. This is the only adapter-to-adapter edge in the
  registry.
- **Contract:** as M15, adapted to binary records: the inventory reads
  `xl/workbook.bin` and each sheet's `BrtWsDim` through a bounded prefix and
  never iterates cell records; an undecodable formula token stream keeps its
  cached value and becomes an inert `formula` preserved part with a
  diagnostic, never a guessed formula.

## Landed surface (SESSION-04)

- **Exports (`index.ts`):** `readXlsbInventory` (M65 `InventoryReaderV1`,
  format `xlsb`), `xlsbAdapter` (M65 `WorkbookAdapterV1`).
- **Files:** `records.ts` (BIFF12 varint record reader `openXlsbRecords`,
  `BodyReaderV1`, `BRT`, `CELL_RECORD_TYPES`, `gridRange`, `rkNumber`,
  `MAX_RECORD_BYTES = 16 MiB`), `workbook.ts` (Custom Rule 7:
  `readXlsbWorkbook` — `BrtBundleSh`, `BrtWbProp` 1904, `BrtName`, externals
  `BrtSupSelf/Same/Addin/BookSrc/SupTabs/PlaceholderName/ExternSheet`;
  `ptgContextOf`, `definedNamesOf`, `parsedFormula`), `parts.ts` (Custom
  Rule 7: `readTablePart` (`BrtBeginList`/`BrtBeginListCol`),
  `readDrawingObjects` (DrawingML XML), `readCommentAnchors`
  (`BrtBeginComment`), `readCellStyles` (`BrtFmt`/`BrtXF` in cell XFs),
  `readSharedStrings` (`BrtSSTItem`)), `inventory.ts`, `sheet.ts` (Custom
  Rule 7: `streamXlsbSheet`, `sheetPartFacts`), `parse.ts`, `index.ts`.
- **Contract as landed:** inventory reads content types, rels,
  `workbook.bin`, table/drawing/comment parts and each worksheet's prefix up
  to `BrtWsDim` (or `BrtBeginSheetData`) — never a cell record, never
  `sharedStrings.bin`, never a chart-sheet part. Estimated cells = `min(
  declared area, part size / 7)` (`MIN_CELL_RECORD_BYTES = 7`, a
  `BrtShortBool`). Macro signals: `vbaProject.bin`, `xl/macrosheets/`,
  `xl/activeX/`, macro-enabled embeddings, VBA/macro-sheet/ActiveX content
  types, `xlMacrosheet`/`xlIntlMacrosheet` workbook relationships (the
  `.xlsb` main content type's `macroEnabled` is **not** a signal). Adapter:
  same fact rules as M17/M15; `BrtShort*` cells take the previous cell's
  column + 1; `BrtShrFmla`/`BrtArrFmla` groups matched by master row +
  containing range; relationship-declared parts (tables, drawings, comments,
  pivots, OLE, controls) emitted after the `sheet` fact as M15 does.
- **Edges:** M13 (`bounds`, `opc`, `xml` via `opc`, `zip` type-only), M65, M01
  `values`, and **M17 `biff/ptg.ts` only** (the pre-declared adapter edge). No
  third-party import.
- **Known limit:** BIFF12 layouts (`BrtDVal`, `BrtBeginListCol`,
  `BrtBeginComment 635`, `BrtSupAddin 666`, `BrtPlaceholderName 361`,
  `BrtShort*` 4-byte, the 14-byte BIFF12 `PtgArray` header) are unverified
  against a real Excel-authored file — self-consistent with the project's own
  fixtures only. Owner: GATE-F03 reviewer, or F04 planning with a real file.

## Dependency must-nots (ship as tests)

- As M15; the single permitted adapter edge is `xlsb → biff/ptg`.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-04 (`4805e2c`..`5e92124`); registered and
  proven through the real worker by SESSION-06 (`4287569`..`677b947`, incl.
  `xlsb/fieldwork-jobs.xlsb` as the relationship-survival fixture).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-04 delta
  folded into "Landed surface"; the known-limit note (unverified BIFF12
  layouts) carried up from the session's surprise list into the fragment
  proper, where a future reader will look for it.
