# M35 — Queries (`src/application/queries/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Queries. Reconciled against the tree at `425562d`
> (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Safe internal query plans and truthful bounded results.
- **Exports:** `recordQuery`, `planRecordPage`, `RecordQueryV1`,
  `RecordPageV1`, `RecordScopeV1`, `MAX_RECORD_PAGE_SIZE`,
  `DEFAULT_RECORD_PAGE_SIZE`, `planHistoryPage`, `HistoryPageV1`,
  `HistoryEntryV1`, `isRestorable`, `MAX_HISTORY_PAGE_SIZE`,
  `DEFAULT_HISTORY_PAGE_SIZE`, and (F03) `planRecordReferences`,
  `planRelatedRecords`, `planRelatedChildrenPage`, `planReferenceCandidates`,
  `planDeletedRecord`, `planSheetSnapshots`, `planSnapshotSheet`,
  `planInertItems`, `planInferenceDecisions`. (`RelationshipResult`/
  `MetricResult`/`ChartDataset` for F04's typed filters remain unbuilt.)
- **Depends on:** domain model and the `ProjectionEnginePort`.
- **Contract:** Every partial response carries the known included scope,
  omitted scope/count when knowable, cause, and remedy. Export never consumes
  a partial query result (F07). Counts are exact only when actually exact
  (CA-14).

## F02 query set (unchanged)

Table list, record page (stable `record_pk` order), FTS search over the
hydrated table, record detail (cells + issues), change history page, exact row
count. Typed filter/sort compilation is F04 (FR-13).

- `RecordPageV1` states `scope` (`table` | `search`) beside its rows, and
  `totalCount` is always the **table's** `count(*)` with `isTotalExact: true`.
- A page size outside the bounded range is refused (`RangeError`), never
  clamped.
- **The change history is post-checkpoint only.** `isRestorable` reads the
  delete entry's prior revision and original `createdCommitId`.

## F03 additions (`relationships.ts`, `snapshots.ts`, SESSION-03)

- `relationships.ts`: `planRecordReferences`, `planRelatedRecords` (children
  preview 5, exact counts), `planRelatedChildrenPage`,
  `planReferenceCandidates` (null when the field has no active
  relationship), `planDeletedRecord`.
- `snapshots.ts`: `planSheetSnapshots`, `planSnapshotSheet`, `planInertItems`
  (null for an unknown sheet), `planInferenceDecisions` (D44 rejection
  memory for the append path).

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/workers/`, `src/ui/`, `react`,
  SQLite — the engine arrives via the port. Swept together with M34 in
  `tests/unit/commands/module-boundaries.test.ts`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-05 (`d47b3d2`); consumed by M37's
  records VMs (`cc60008`) and the app-area surfaces (`5ab3b07`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-05 staple
  folded in; CA-14's count-scope rule stated once, here.
- 2026-09-23 — F03: `relationships.ts` and `snapshots.ts` landed by
  SESSION-03 (`f29ac33`..`a2c4cf0`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-03 staple
  folded into "F03 additions" and the head export list.

<!-- formulas-queries-charts SESSION-03 -->
### F04 delta — SESSION-03 (M35 — Queries (`src/application/queries/structure.ts`))

- `readAppStructure` (tables, fields incl. computed + `formulaId`, options, rules as IR, relationships, formulas with text rendered from IR via `renderFormula`); `readAppMetrics` (table metrics + dashboard values, status per CA-26, `empty` when never evaluated).

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M35 Queries (`src/application/queries/`))

- `budgets.ts`: `QUERY_CANDIDATE_ROW_BUDGET = 50_000`, `CHART_SOURCE_ROW_BUDGET = 20_000`, `CHART_MARK_BUDGET = 1_000` (D53). S05 reads the chart constants.
- `filters.ts`: `compileRecordQuery(table, enumOptions, FilterV1[], RecordSortV1 | null)` validates each filter with `validateFilter` and returns closed terms or the first typed refusal. `readTableDefinition(projection, tableId)` is also exported.
- `records.ts`: `planRecordPage(projection, query, candidateBudget = QUERY_CANDIDATE_ROW_BUDGET)`.
  - Adds `total`, `partial {scanned, tableTotal, cause: "query-budget", remedy: "narrow-filters"}` and `nextSortValue`.
  - Filters or a sort route to `query-records`; a plain browse or search keeps the F03 path. Browse `total` equals the table count; plain search `total` is null.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M35 queries — `src/application/queries/charts.ts` (new))

- `readChartDataset(projection, definition, {tableOffset?, budgets?})` (L210): validates, compiles the chart's filters with S04's `compileRecordQuery`, reads `chart-dataset`, applies the mark budget (whole categories, stacked marks counted together), `measure-desc` order, per-mark `filterIntent: FilterV1[] | null` = chart filters ∧ `markFilterIntent(category)` ∧ series intent; summary `{highest, lowest, total, count}` and the table page (50 rows) over every aggregated category. Budgets default to `budgets.ts` (unchanged; S04 created the chart constants).
