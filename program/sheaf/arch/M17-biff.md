# M17 — BIFF adapter (`src/import/formats/biff/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table), § Import Architecture Stage 1 (CFB)
> and § Module Contracts / Format adapters.

## Contract

- **Owns:** BIFF8 (and readable BIFF5) workbook-stream records inside a CFB
  container: code pages, SST, formats/XF, cell records (`LABELSST`, `NUMBER`,
  `RK`, `MULRK`, `BOOLERR`, `FORMULA` + `STRING`), data validations, merges,
  the 1900/1904 date epoch, and VBA/XLM refusal signals. Also owns the shared
  `Ptg` formula decoder and function-id table that M16 imports.
- **Exports (planned, F03 S04):** `readBiffInventory` (M65 `InventoryReaderV1`),
  `biffAdapter` (M65 `WorkbookAdapterV1`), `decodePtgFormula` + the function
  table (`ptg.ts`).
- **Depends on:** M13 (`cfb.ts` bounded directory/stream reader), M65.
- **Contract:** The CFB container is read only through M13's bounded reader
  (sector-chain caps, loop detection). The inventory reads `BOF`/`BOUNDSHEET8`/
  `CODEPAGE`/`DATEMODE`/`DIMENSIONS` through workbook-globals and per-sheet
  prefix reads and never iterates cell records. A `_VBA_PROJECT_CUR` storage, a
  macro sheet (`BOUNDSHEET8` type) or an XLM `FNGROUPNAME` refuses the whole
  import. An encrypted workbook (`FILEPASS` / `EncryptedPackage`) is identified
  and refused as unreadable, never guessed at.

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
