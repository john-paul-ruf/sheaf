# M65 — Workbook facts (`src/import/facts/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Module Contracts / Format adapters ("a shared stream of WorkbookFact
> values plus PreservedPartDescriptor and ImportDiagnostic") and the M19
> fragment's standing instruction that `facts.ts` is "the file to relocate
> unchanged when [the workbook adapters] land, not to copy". Reconciled
> against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

## Contract

- **Owns:** The format-neutral fact vocabulary every import adapter emits, the
  adapter and metadata-inventory interfaces, the diagnostic vocabulary, and the
  fact → canonical-CBOR value mapping staging encodes.
- **Exports:** `WorkbookFactV2` (a strict superset of the F02 `WorkbookFactV1`
  — the `row`, `value`, `diagnostic` variants keep their exact F02 shapes),
  `WorkbookFactBatchV1`, `WorkbookSummaryV1`, `WorkbookFactStreamItemV2`,
  `CancellationTokenV1`, `ImportDiagnosticV1` + `IMPORT_DIAGNOSTIC_CODES`,
  `PreservedPartDescriptorV1` + `PRESERVED_PART_KINDS`, `SheetInventoryItemV1`,
  `WorkbookInventoryV1`, `WorkbookAdapterV1`, `InventoryReaderV1`,
  `factStreamItemToCanonicalValue`, and (F04) the chart/pivot part-definition
  types (below).
- **Depends on:** M01 `values` only. Nothing else in the repository, no
  third-party package.
- **Contract:**
  - **Positional sheet scoping.** A `sheet` fact opens a sheet; every following
    `row`/`value`/format/formula/table/validation/merge/preserved-part fact
    belongs to it until the next `sheet` fact or the terminal summary. A stream
    with no `sheet` fact is exactly one implicit sheet — every F02 delimited
    stream is a valid V2 stream unchanged.
  - **Sparsity stays the contract** (inherited from M19's F02 rule): a value
    fact exists only where a cell has a value; below a row's `cellCount` with
    no value fact ⇒ `blank`, at or above ⇒ `missing`. Never collapse them.
  - **Terminal summary ⇒ completed.** A cancelled stream ends with no summary.
  - **Nothing unsupported is ignored.** Anything an adapter cannot make
    interactive becomes a `preserved-part` fact with a closed kind, a
    user-understandable location, and a closed reason key (FR-9).
  - A macro signal is never a fact: it is an inventory outcome that refuses the
    whole import before any stage exists (invariant 8).
  - **F04:** a chart or pivot definition, when readable within bounds, is an
    **additive optional** field on the existing `preserved-part` fact — it
    changes no existing fact, kind, or bound; the part still gets its
    unchanged F03 `preserved-part` fact even when the definition cannot be
    read.

## Landed surface (SESSION-01, F03; extended SESSION-02, F04)

- `workbook-facts.ts`: V1 moved unchanged (`WorkbookFactV1`,
  `WorkbookFactBatchV1`, `WorkbookSummaryV1`, `WorkbookFactStreamItemV1`,
  `ImportDiagnosticV1`, `ImportDiagnosticCodeV1`, `CancellationTokenV1`,
  `CanonicalFactValueV1`); `IMPORT_DIAGNOSTIC_CODES_V1` (F02 six) and
  `IMPORT_DIAGNOSTIC_CODES` (V1 + `error-value`, `malformed-value`); V2:
  `WorkbookFactV2`, `WorkbookStructureFactV1`, `WorkbookFactKindV2`,
  `WorkbookFactBatchV2`, `WorkbookSummaryV2`, `WorkbookFactStreamItemV2`,
  `ImportDiagnosticV2`, `ImportDiagnosticCodeV2`, `RangeV1`,
  `SHEET_KINDS`/`SheetKindV1`, `SHEET_VISIBILITIES`/`SheetVisibilityV1`,
  `DateSystemV1`, `FORMAT_CLASSES`/`FormatClassV1`, `VALIDATION_RULES`,
  `VALIDATION_OPERATORS` (kebab-case), `ValidationListSourceV1`,
  `PRESERVED_PART_KINDS` (D40), `PRESERVED_REASON_KEYS` (F04: 10, was 8 —
  adds `chart-not-rebuilt`, `formula-not-supported`), `PRESERVED_REASON_BY_KIND`,
  `WORKBOOK_FACTS_PER_BATCH = 1024`, `factStreamItemToCanonicalValue` (total
  over V2, all integers bigint).
- Field naming: the discriminator is `kind`, so the sheet's kind is
  **`sheetKind`** and the preserved part's kind is **`partKind`**.
- `numbers.ts` (Custom Rule 7 — S04's XLSB/BIFF share the same doubles and
  Excel format model): `decimalTextOfDouble`, `decimalCellOfDouble`,
  `BUILTIN_NUMBER_FORMATS` (0–22, 37–49), `classifyNumberFormat`,
  `NumberFormatClassV1`.
- `adapter.ts`: `WORKBOOK_FORMATS`/`WorkbookFormatV1`, `ContainerHandleV1`,
  `MACRO_SIGNAL_KINDS`/`MacroSignalV1 {kind, partPath}`,
  `PreservedPartCountsV1` (full record; counts only separately-stored
  parts), `DeclaredTableSummaryV1`, `SheetInventoryItemV1`,
  `DefinedNameSummaryV1`, `WorkbookInventoryV1`, `InventoryOutcomeV1`,
  `InventoryReaderV1`, `ParseSheetsOptionsV1`, `WorkbookAdapterV1`.
- `index.ts` barrel. Edges: value import `domain/model/values` only;
  **type-only** imports of M13 (`bounds`, `cfb`, `source`, `zip`) — enforced
  by the sweep.

### F04: chart/pivot part definitions (SESSION-02)

`preserved-part` gains `readonly definition?: ChartPartDefinitionV1 |
PivotPartDefinitionV1`. Present only on `partKind` `chart` (chart definition)
or `pivot-table` (pivot definition) whose part was read within its bounds;
otherwise the key is absent (never `undefined`). No new fact kind, reason
key, or diagnostic code.

New closed sets: `CHART_PART_TYPES` (`bar|line|pie|scatter|area|other`),
`CHART_BAR_DIRECTIONS` (`bar|col`), `CHART_GROUPINGS`
(`clustered|stacked|percentStacked|standard`), `PIVOT_SUBTOTALS`
(`sum|count|average|min|max`).

New types: `ChartPartSeriesV1 {name, categoriesRef, valuesRef, xRef, yRef}`
(all `string|null`), `ChartPartDefinitionV1 {chartType, barDirection|null,
grouping|null, title|null, series[]}`, `PivotPartDefinitionV1 {sourceSheet|
null, sourceRef, rowFields: string[], dataFields: {cacheFieldName,
subtotal}[]}`.

Bounds: `CHART_PART_MAX_SERIES` 64, `CHART_PART_MAX_REF_LENGTH` 1024,
`CHART_PART_MAX_TITLE_LENGTH` 256 (code points, NFC), `PIVOT_PART_MAX_FIELDS`
256. Guard: `isChartPartDefinition(definition)`.

Canonical mapping: the `definition` key is appended to the preserved-part map
only when present. Chart map keys: `chartType, barDirection, grouping,
title, series[{name, categoriesRef, valuesRef, xRef, yRef}]`. Pivot map
keys: `sourceSheet, sourceRef, rowFields, dataFields[{cacheFieldName,
subtotal}]`.

## F03: migration off `delimited/facts.ts` (D30/D32, closed)

F02 landed the fact vocabulary in M19's `formats/delimited/facts.ts`. S01
created this module and moved V1 unchanged into `workbook-facts.ts`, leaving
`delimited/facts.ts` as a V1-only re-export so the seven F02 consumers
compiled unchanged during the transition. **S06 migrated every consumer to
import from here directly** (`4287569`). The re-export's last remaining
reason to exist — S01's own pin in
`tests/unit/import/facts/workbook-facts.test.ts` — was removed together with
`delimited/facts.ts` itself by OWNER-IMPORT-F03-SEAMS (`87da253`). **M65
`src/import/facts/` is the sole home of the fact vocabulary; no other file in
the repository defines it, in F03 or F04.**

## F03: ODS declared-table ordering counterexample (OWNER-IMPORT-F03-SEAMS, closed)

No vocabulary change. Fact counts per sheet and kind are unchanged for every
ODS fixture; only the position of the `declared-table` fact moved (it now
precedes the sheet's rows, matching OOXML/XLSB — see `M18-ods.md` for the
adapter-side fix and `M21-inference.md` for the inference rule this
corrects). `fieldwork-jobs-customers.ods` infers `s0.t0` (60 rows) and
`s1.t0` (12 rows); promotion writes 72 records, the same total as before the
fix.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  `src/application/`, any adapter directory, or any third-party package.
  Swept by `tests/unit/import/module-boundaries.test.ts` (S01 adds this
  directory to the pipeline sweep).

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — created and landed by SESSION-01 (`dd1ff9e`..`64bc49a`).
- 2026-09-23 — migrated to sole ownership: consumers redirected by SESSION-06
  (`4287569`..`677b947`); the F02 re-export and its pin deleted by
  OWNER-IMPORT-F03-SEAMS (`87da253`, D32 complete).
- 2026-09-23 — ODS declared-table ordering counterexample closed by
  OWNER-IMPORT-F03-SEAMS (`3a32561`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three deltas and a
  trailing standalone "## D32" heading folded into "Landed surface" and two
  named F03 subsections, so the transition from "V1 lives in M19" to "V1 and
  V2 live only in M65" reads as one completed history rather than three
  separate, chronologically ambiguous notes.
- 2026-09-23 — F04: the additive chart/pivot `definition` field and its
  bounded types landed by SESSION-02 (`1f77153`..`15b4d5b`); consumed by
  S07's mapping (`M21-inference.md`) and the CA-33 reason-key extension
  (`M01-domain-model.md`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): the SESSION-02 delta
  folded into a new "F04: chart/pivot part definitions" section; the
  "sole home of the fact vocabulary" sentence extended to state it still
  holds at F04 close (a fact this module's own contract makes worth
  re-asserting each time a feature adds to the vocabulary).
