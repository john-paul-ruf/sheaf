# M16 — XLSB adapter (`src/import/formats/xlsb/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Module Contracts / Format
> adapters.

## Contract

- **Owns:** Streaming XLSB (BIFF12) record parsing into the same M65 fact
  contract as OOXML, including macro-sheet detection.
- **Exports (planned, F03 S04):** `readXlsbInventory` (M65 `InventoryReaderV1`),
  `xlsbAdapter` (M65 `WorkbookAdapterV1`).
- **Depends on:** M13 (`zip.ts`), M65, and **M17's `Ptg` formula decoder**
  (`src/import/formats/biff/ptg.ts`) — BIFF8 and BIFF12 share the parsed-token
  formula representation and its function-id table, so there is exactly one
  decoder. This is the only adapter-to-adapter edge in the registry.
- **Contract:** as M15, adapted to binary records: the inventory reads
  `xl/workbook.bin` and each sheet's `BrtWsDim` through a bounded prefix and
  never iterates cell records; an undecodable formula token stream keeps its
  cached value and becomes an inert `formula` preserved part with a diagnostic,
  never a guessed formula.

## Dependency must-nots (ship as tests)

- As M15; the single permitted adapter edge is `xlsb → biff/ptg`.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
