# M17 — BIFF adapter (`src/import/formats/biff/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table), § Import Architecture Stage 1 (CFB)
> and § Module Contracts / Format adapters. Reconciled against the tree at
> `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** BIFF8 (and readable BIFF5) workbook-stream records inside a CFB
  container: code pages, SST, formats/XF, cell records (`LABELSST`, `NUMBER`,
  `RK`, `MULRK`, `BOOLERR`, `FORMULA` + `STRING`), data validations, merges,
  the 1900/1904 date epoch, and VBA/XLM refusal signals. Also owns the shared
  `Ptg` formula decoder and function-id table that M16 imports.
- **Exports:** `readBiffInventory` (M65 `InventoryReaderV1`), `biffAdapter`
  (M65 `WorkbookAdapterV1`), `decodePtgFormula` + the function table
  (`ptg.ts`).
- **Depends on:** M13 (`cfb.ts` bounded directory/stream reader), M65.
- **Contract:** The CFB container is read only through M13's bounded reader
  (sector-chain caps, loop detection). The inventory reads `BOF`/`BOUNDSHEET8`/
  `CODEPAGE`/`DATEMODE`/`DIMENSIONS` through workbook-globals and per-sheet
  prefix reads and never iterates cell records. A `_VBA_PROJECT_CUR` storage, a
  macro sheet (`BOUNDSHEET8` type) or an XLM `FNGROUPNAME` refuses the whole
  import. An encrypted workbook (`FILEPASS` / `EncryptedPackage`) is identified
  and refused as unreadable, never guessed at.

## Landed surface (SESSION-04)

- **Exports (`index.ts`):** `readBiffInventory` (M65 `InventoryReaderV1`,
  format `xls`), `biffAdapter` (M65 `WorkbookAdapterV1`), and the shared
  decoder surface from `ptg.ts`: `decodePtgFormula(rgce, ctx, rgcb?) →
  PtgDecodeResultV1` (`{text}` | `{undecodable: PtgUndecodableReasonV1}`,
  never throws), `ptgExpOf`, `FUNCTION_NAMES` (frozen, ids 0–380, MS-XLS
  Ftab), `FIXED_ARITY`, `ERROR_TEXT`, `PTG_UNDECODABLE_REASONS` (closed:
  truncated, unknown-token, unbalanced-stack, shared-formula-reference,
  data-table, structured-reference, unknown-function, macro-function,
  unknown-name, unknown-sheet, relative-without-cell), types `PtgContextV1
  {format, sheetNames, supbooks, externSheets, definedNames, cell,
  isSharedFormula}`, `PtgSupbookV1`, `PtgExternSheetV1`, `PtgCellV1`,
  `PtgFormatV1 ("biff8"|"biff12")`. `ptg.ts` also exports `columnLetters`,
  `cellText`, `rangeText`, `quoteSheetName`, `locationOf` (both binary
  adapters use them).
- **Files (Custom Rule 7):** `globals.ts` (workbook globals: code page, 1904,
  `BOUNDSHEET8`, `SUPBOOK`/`EXTERNNAME`/`EXTERNSHEET`, `NAME`, `FORMAT`,
  `XF`, SST across `CONTINUE`, `FILEPASS`, `FNGROUPNAME`, `DCONN`;
  `storageMacroSignal`, `ptgContextOf`, `definedNamesOf`), `sheet.ts`
  (`streamBiffSheet`). Planned files: `records.ts` (bounded record reader
  `openRecordStream` with `peekType`/`next`/`skipTo`, `ContinuedCursorV1`,
  `rkNumber`, `RT`, `CELL_RECORD_TYPES`), `codepage.ts` (`codePageDecoder`, a
  bounded WHATWG label map, unknown → ASCII + U+FFFD + `isLossy`),
  `inventory.ts`, `parse.ts`, `ptg.ts`, `index.ts`.
- **Contract as landed:**
  - Inventory reads the CFB directory, the globals (SST skipped unread) and,
    per sheet, `BOF`…`DIMENSIONS` only; it stops at the first cell/`ROW`
    record header and never reads a cell record body. Estimated cells =
    `min(declared area, sheet substream bytes / 6)`
    (`MIN_CELL_RECORD_BYTES = 6`, one `MULRK` entry). An explicitly empty
    `DIMENSIONS` → `declaredRange: null`, rows/cells `0`; no `DIMENSIONS` →
    `declaredRange: null`, rows `null`, cells = size bound.
  - Refusals: VBA storage → `macro{vba-project}`; `BOUNDSHEET8` macro sheet /
    `FNGROUPNAME` → `macro{xlm-macro-sheet}`; VB module sheet →
    `macro{vba-project}`; `FILEPASS` → `unreadable{encrypted-workbook}`;
    `DIMENSIONS` past the grid → `impossible-dimension`.
  - **Known limit (M13 seam):** `CfbHandleV1.streamStream` has no ranged
    read, so `skipTo` a later sheet's `BOF` still fetches (never parses) the
    earlier sheets' sectors. Proof is record-level (poisoned twins) + byte-
    level for the last sheet's tail. Owner: next session leasing
    `src/import/source/cfb.ts` (non-blocking hardening; see `M13-import-source.md`).
  - Adapter: M65 fact order and sparsity exactly as M15. Shared formulas:
    master = text + `sharedGroup`, members = `text: null` + group; array
    master = text + `isArray`, array members no formula fact; `PtgTbl`,
    undecodable tokens and BIFF5 token streams → `formula{text:null}` +
    `preserved-part{formula}` at the cell, cached value kept. Blank cells
    widen `cellCount`, never a value fact. Preserved parts: `NOTE`→comment,
    `HLINK`→hyperlink, `OBJ` picture→image, controls→form-control,
    shapes→drawing (anchors `null`), embedded chart substream and chart
    sheets → chart, `CONDFMT`/`CONDFMT12` → one conditional-formatting per
    sheet, visually styled XF → one cell-styling per sheet; external
    `SUPBOOK`s → workbook external-link, `DCONN` → data-connection. Defined
    names: BIFF8 `NAME` decoded through `ptg.ts`; function/macro names and
    undecodable names omitted; built-ins spelled `_xlnm.<Name>`; BIFF5 names
    not read.
  - DV lists: `fStrLookup` string lists → `listSource inline` + `formula1` in
    OOXML's `"a,b,c"` spelling; range lists → `listSource range`; undecodable
    DV formula → `preserved-part{unsupported-validation}` per range.
- **Edges:** M13 (`bounds`, `cfb` type-only for the handle), M65
  (`facts/index`), M01 `values`. No third-party import (pipeline sweep
  green).

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-04 (`4805e2c`..`5e92124`); registered and
  proven through the real worker by SESSION-06 (`4287569`..`677b947`, incl.
  the CFB-fixture expectation shift for garbage-content `.xls`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-04 delta
  folded into "Landed surface"; the CFB no-ranged-read known limit
  cross-referenced against its owner note in `M13-import-source.md`.
