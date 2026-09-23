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
