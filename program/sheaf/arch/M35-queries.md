# M35 — Queries (`src/application/queries/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Queries. Reconciled against the tree at `5ab3b07`
> (F02 final).

## Contract

- **Owns:** Safe internal query plans and truthful bounded results.
- **Exports:** `recordQuery`, `planRecordPage`, `RecordQueryV1`,
  `RecordPageV1`, `RecordScopeV1`, `MAX_RECORD_PAGE_SIZE`,
  `DEFAULT_RECORD_PAGE_SIZE`, `planHistoryPage`, `HistoryPageV1`,
  `HistoryEntryV1`, `isRestorable`, `MAX_HISTORY_PAGE_SIZE`,
  `DEFAULT_HISTORY_PAGE_SIZE` (`RelationshipResult`/`MetricResult`/
  `ChartDataset` arrive F03/F04).
- **Depends on:** domain model and the `ProjectionEnginePort`.
- **Contract:** Every partial response carries the known included scope,
  omitted scope/count when knowable, cause, and remedy. Export never consumes
  a partial query result (F07). Counts are exact only when actually exact
  (CA-14).

## F02 query set (landed, S05)

Table list, record page (stable `record_pk` order), FTS search over the
hydrated table (candidate rows joined and paged truthfully), record detail
(cells + issues), change history page, exact row count. Typed filter/sort
compilation is F04 (FR-13); no unimplemented filter shape is exported.

- `RecordPageV1` states `scope` (`table` | `search`) beside its rows, and
  `totalCount` is always the **table's** `count(*)` with `isTotalExact: true` as
  a literal. A count of search *matches* is deliberately not offered: the closed
  query surface cannot answer it exactly, and `records.length` would be false
  whenever `hasMore` is true. Every consumer sentence must therefore say which
  count it is showing.
- A page size outside the bounded range is refused (`RangeError`), never
  clamped.
- **The change history is post-checkpoint only** — a fresh import's log is
  legitimately empty, and no consumer copy may imply the log covers the app's
  whole life. `isRestorable` reads the delete entry's prior revision and
  original `createdCommitId`.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/workers/`, `src/ui/`, `react`,
  SQLite — the engine arrives via the port. Swept together with M34 in
  `tests/unit/commands/module-boundaries.test.ts`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-05 (`d47b3d2`); consumed by M37's
  records VMs (`cc60008`) and the app-area surfaces (`5ab3b07`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-05 staple folded
  in; the seeded export list replaced with the landed names; CA-14's
  count-scope rule stated once, here.
