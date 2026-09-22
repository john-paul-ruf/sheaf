# M65 — Workbook facts (`src/import/facts/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Module Contracts / Format adapters ("a shared stream of WorkbookFact values
> plus PreservedPartDescriptor and ImportDiagnostic") and the M19 fragment's
> standing instruction that `facts.ts` is "the file to relocate unchanged when
> [the workbook adapters] land, not to copy". New module ID (IDs are never
> reused; M64 was the last).

## Contract

- **Owns:** The format-neutral fact vocabulary every import adapter emits, the
  adapter and metadata-inventory interfaces, the diagnostic vocabulary, and the
  fact → canonical-CBOR value mapping staging encodes.
- **Exports (planned, F03 S01):** `WorkbookFactV2` (a strict superset of the F02
  `WorkbookFactV1` — the `row`, `value`, `diagnostic` variants keep their exact
  F02 shapes), `WorkbookFactBatchV1`, `WorkbookSummaryV1`,
  `WorkbookFactStreamItemV2`, `CancellationTokenV1`, `ImportDiagnosticV1` +
  `IMPORT_DIAGNOSTIC_CODES`, `PreservedPartDescriptorV1` + `PRESERVED_PART_KINDS`,
  `SheetInventoryItemV1`, `WorkbookInventoryV1`, `WorkbookAdapterV1`,
  `InventoryReaderV1`, `factStreamItemToCanonicalValue`.
- **Depends on:** M01 `values` only. Nothing else in the repository, no
  third-party package.
- **Contract:**
  - **Positional sheet scoping.** A `sheet` fact opens a sheet; every following
    `row`/`value`/format/formula/table/validation/merge/preserved-part fact
    belongs to it until the next `sheet` fact or the terminal summary. A stream
    with no `sheet` fact is exactly one implicit sheet — which is what every F02
    delimited stream already is, so F02 streams are valid V2 streams unchanged.
  - **Sparsity stays the contract** (inherited from M19): a value fact exists
    only where a cell has a value; below a row's `cellCount` with no value fact
    ⇒ `blank`, at or above ⇒ `missing`. Never collapse them.
  - **Terminal summary ⇒ completed.** A cancelled stream ends with no summary.
  - **Nothing unsupported is ignored.** Anything an adapter cannot make
    interactive becomes a `preserved-part` fact with a closed kind, a
    user-understandable location, and a closed reason key (FR-9).
  - A macro signal is never a fact: it is an inventory outcome that refuses the
    whole import before any stage exists (invariant 8).

## Transition (F03 only)

S01 creates this module and turns `src/import/formats/delimited/facts.ts` into a
re-export of the V1 subset so the seven F02 consumers compile unchanged. S06
migrates every consumer to import from here and deletes the re-export. Between
the two, the re-export is the only sanctioned duplicate path.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/application/`, any adapter directory, or any third-party package.
  Swept by `tests/unit/import/module-boundaries.test.ts` (S01 adds this
  directory to the pipeline sweep).

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
