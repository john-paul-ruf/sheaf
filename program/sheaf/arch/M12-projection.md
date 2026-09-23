# M12 — Projection (`src/persistence/projection/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Projection and `specs/database.md` § In-Memory SQLite
> Projection. Reconciled against the tree at `425562d` (F03 final; code ≡
> `30396a9`).

## Contract

- **Owns:** Plaintext relational state for the current unlocked session.
- **Exports:** `openProjection`, `hydrateApp`, `applyEvents`, `executeQuery`,
  `disposeProjection` (`createExportCursor` is F07).
- **Depends on:** SQLite WASM (`@sqlite.org/sqlite-wasm`), M09 pure helpers,
  M01/M02 types, M10 read-only. Schema authority:
  `src/migrations/005_projection_v1.sql` executed via `migrateProjectionSchema`
  from `src/migrations/index.js` (CA-06: never redeclare, never inline SQL DDL).
- **Contract:** Runs only in `src/workers/data.worker.ts`. Opened `:memory:`
  only. Persists nothing; destroyed on lock (worker termination is the scrub).
  All SQL comes from closed prepared templates with bound parameters — user
  text is never an SQL identifier, operator, collation, or fragment
  (database.md § SQLite Query Patterns).

## Key semantics (database.md § Global Data Conventions)

- Domain IDs are 16-byte BLOBs; SQLite rejects other lengths.
- `TextSortKeyV1` = UTF-8 bytes of NFC text, bytewise compare; ephemeral,
  never durable.
- Decimal order key v1: fixed 20-byte big-endian key (sign prefix, adjusted
  exponent + 6143 in 2 bytes, 34 digits packed 2-per-byte, negative =
  inverted); binary order equals numeric order; canonical decimal text stays
  the value of record. Values outside the domain get a type issue and no
  decimal lane.
- Dates are **signed** epoch-day integers. Missing / explicit blank / invalid
  preserved / unsupported-formula-result / null are distinct states resolved
  through authored CBOR plus `record_issues` — never silently zero/empty.
- Load order and whole-projection disposal on any failed batch follow
  database.md § Projection load order verbatim.

## Public API (M34/M35 and the data worker bind to this verbatim)

`src/persistence/projection/index.ts` is the whole surface; every other file in
the tree is internal and unreachable from it.

```ts
openProjection(init: { sha256: Sha256Fn }): Promise<ProjectionHandleV1>
hydrateApp(handle, checkpoint: ProjectionCheckpointV1,
           tailCommits?: readonly ProjectionCommitV1[]): Promise<void>
applyEvents(handle, commits: readonly ProjectionCommitV1[]): Promise<void>
executeQuery<K>(handle, query: Extract<ProjectionQueryV1, {kind: K}>)
  : ProjectionQueryResultsV1[K]                                    // synchronous
disposeProjection(handle): void
```

Also exported: `TEXT_SORT_KEY_VERSION`, `DECIMAL_ORDER_KEY_VERSION`,
`DECIMAL_ORDER_KEY_BYTES`, and the input/output types
(`ProjectionCheckpointV1`, `ProjectionAppStateV1`, `ProjectionRecordV1`,
`ProjectionRecordPageV1`, `ProjectionSheetSnapshotV1`,
`ProjectionValidationRuleV1`, `ValidationIssueV1Input`, `ProjectionCommitV1`,
`ProjectionQueryV1`, `ProjectionQueryResultsV1`, `ProjectionRecordSummaryV1`,
`ProjectionRecordDetailV1`, `ProjectionCellRowV1`, `ProjectionIssueRowV1`,
`ProjectionRecordPageResultV1`, `ProjectionChangeEventV1`,
`ProjectionChangeSummaryV1`, `ProjectionChangeHistoryPageV1`,
`ChangeHistoryCursorV1`, `ChangeSubjectKindV1`, `SheetClassificationV1`,
`Sha256Fn`).

**F02 query set (unchanged):** `app-state`, `list-tables`, `list-fields`,
`list-enum-options`, `list-validation-rules`, `count-records`, `page-records`,
`search-records`, `record-by-id`, `page-change-history`,
`record-change-history`. Page sizes are bounded to 1–1024 and refused outside
it.

**F03 additions:** `record-is-live`, `list-relationships{tableId|null}`,
`related-parent{recordId, fieldId}`, `related-children{relationshipId,
parentRecordId, afterRecordPk, limit}` (via `idx_cells_field_id`),
`count-related-children`, `reference-candidates{relationshipId, text, limit}`
(FTS over the parent table; a blank query browses), `deleted-record{recordId}`,
`list-sheet-snapshots` (+ inert counts per kind via `idx_inert_content_sheet`),
`list-inert-items{sheetId|null}`, `list-inference-decisions{decisionKind|null}`.
Labels resolve as the label field else the key, as display text. `listTables`
gained a variant taking `appId` (see the "Consumer note" below) — `openApp`
already returned exact table counts, so this is a second read path, not a new
fact.

## Internal modules

| File | Holds |
|---|---|
| `engine.ts` | `:memory:` open, `ProjectionMigrationHost`, statement cache, `withTransaction` (rollback **then dispose**), `disposeProjection` |
| `sort-keys.ts` | `textSortKeyV1` (NFC UTF-8), `decimalOrderKeyV1` (20 bytes, `null` outside the v1 exponent domain), `compareSortKeys` |
| `cbor-values.ts` | The projection's payload columns: authored record, theme, rule IR, change summary, message parameters, frontier |
| `record-rows.ts` | One record → `records`/`cells`/`record_issues`/`record_search`; `projectCellValue`, `searchableTextFor`, `deriveIssueId` |
| `statements.ts` | **Every** SQL statement, as literals with `?` placeholders; `toFtsMatchQuery` |
| `hydrate.ts` | The load order, one transaction for metadata and one per record page |
| `apply-events.ts` | Replay guards and per-kind row effects |
| `query-exec.ts` | The closed read surface |

## Dependency edges

- **M12 → M09** (`persistence/codecs`): `canonical-cbor` for the payload columns
  and `event-commit` for `verifyCommitChain`, `compareCommits`, `sortFrontier`.
  The projection decodes no envelope; it consumes M09's *pure* helpers.
- **M12 → M10** (read-only): `migrateProjectionSchema`,
  `PROJECTION_MIGRATION_ORDER`, and `005_projection_v1.sql?raw` as a build asset
  (CA-06). No DDL string exists anywhere in M12.
- **M12 → M01/M02**: domain ids, values, schema, events, provenance, and the
  validator's issue/rule vocabulary (types only — the projection never validates).
- **M12 → `@sqlite.org/sqlite-wasm`.** M12 is the first product module that
  imports it, reachable from the production entry graph since F02
  (`index.html` → app-bootstrap → the data-worker chunk).

## Dependency must-nots (ship as tests)

- No import from `src/ui/`, `src/import/`, `src/sync/`, `dexie`,
  `src/persistence/envelope-store/`. The projection never reads IndexedDB —
  callers hand it decoded checkpoint pages and commits.
- Enforced by `tests/unit/projection/module-boundaries.test.ts`: an import
  allow-list, a forbidden list (dexie, envelope-store, ui, import, sync,
  libsodium), a no-DDL scan, and a negative control that proves the scan fires.

## Contracts a consumer must know

- **The engine never reads storage and never decrypts.** Callers hand it decoded
  checkpoint pages and decoded commits. It holds no key; SHA-256 is injected.
- **`ProjectionCommitV1` pairs the raw `EventCommitV1` with typed events.**
  `EventCommitV1.payload` is `unknown` by contract (M09 carries payloads as
  opaque canonical CBOR), so the caller supplies the typed events alongside.
  The guard proves count, order, and *kind* agree — it cannot compare payload
  bytes, so payload↔typed-event agreement stays the caller's obligation.
  M07's `LocalEventRepository` discharges it by deriving the wire payload from
  the typed event.
- **Issues come from the one shared validator.** The checkpoint carries them per
  record; replay carries them in `issuesByEventIndex`. The engine authors exactly
  one issue of its own: `validation.decimal-out-of-domain` (warning, kind
  `type`) when a canonical decimal falls outside the v1 order-key exponent
  domain.
- **`records.authored_cbor` is the record; `cells` is an index over it.** Values
  with no lane (missing, blank, invalid-preserved, wrong-typed, out-of-domain
  decimal) remain completely readable through `record-by-id`.
- **Identity of returned maps.** A `Map` keyed by a domain ID matches on object
  identity; `query-exec` re-keys returned value maps to the schema's own
  `FieldId` instances so `values.get(field.fieldId)` works with a `field` from
  `list-fields`.
- **Failure disposes everything.** A constraint, trigger, or replay-guard failure
  rolls the batch back and closes the database; every entry point then throws
  `IntegrityError("projection has been disposed")`.
- **`app_state`/theme comes from the checkpoint (D29).** Hydration composes no
  default theme.
- **FTS5 detail=column cannot answer a phrase query.** Search issues per-word
  quoted AND terms with a trailing `*`, and the `MATCH` must be unaliased.
- **`totalCount` on a search page is the TABLE count** (CA-14); the scope says
  which. There is no match-count field.
- **An `app/table/field.created` arriving in a TAIL commit writes change history
  only** — it creates no schema row, **except** F03's `table.created` tail
  handler (below), which builds the row for the one case database.md's
  append-table design requires.
- **F03: `table.created` in a tail builds a real table, not just history.**
  For an unknown table, the tail applies `table.created` (from `sourceSheet`)
  by building the sheet row, the table row, its fields, and the key/label
  refs — this is CAP-26's append path, and it is the one case a TAIL commit is
  allowed to create schema, because M23's `sealImportCommit` always pairs a new
  table's `table.created` with the app's `import.accepted` in one commit
  (CA-11/CA-23). `field.created` for a *known* table inserts the field; for an
  *unknown* table it still disposes — only the table-creating case is special.
- **F03 relationships travel with the checkpoint, not the tail.**
  `RelationshipDefV1` rows arrive only in `ProjectionCheckpointV1.relationships`
  (CA-20); nothing in the tail creates or edits one.

## Known gaps with owners (recorded, not defects)

- `schema_fields` has no `currencyCode` column, so a currency field cannot
  round-trip; `list-fields` refuses rather than guesses. First hurt: F04's
  schema editor → DB re-entry at F04 planning. Unchanged by F03.
- The chain guard keeps the accumulated commit set in memory. Correct at
  current scale; revisit for long tails.
- Test-time fixture output `dist/__projection__/` joins the F08 precache
  exclusion debt.
- Deliberate absences with later owners: formulas (live), charts, baselines'
  full read path (F03 writes them; nothing reads a baseline page back through
  the projection yet — the baseline is a recovery artifact, not a query
  source), conflicts, merges.

## Closed in F03 (was open at `5ab3b07`, resolved here — not re-carried)

- **`import_lineages` and `inference_decisions` had no constructible F02
  input**, so `applyEvents` recorded `change_history` only. Closed: F03's
  checkpoint carries both as projectable roots (`ProjectionCheckpointV1 +=
  relationships, inertItems, importLineages, inferenceDecisions`), M23's
  promotion (`decisionsOf`, the import commit's `inference-decision.recorded`
  events) and append path are the producers CA-23/CA-19 name, and
  `list-inference-decisions`/rejection-memory reads consume them.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — module created and implemented by SESSION-02 (`063f35a`): engine,
  order keys, hydration, replay, and the closed query surface, proven in a real
  browser (`tests/browser/projection/**`, 29/29). CA-13 producer READY; the
  `applyEvents` signature change to `ProjectionCommitV1` recorded as a contract
  refinement, not a drift.
- 2026-09-08 — composed into the data worker and proven through real storage by
  SESSION-05 (`d47b3d2`); the production entry-graph question S02 left open is
  closed there.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-02 staple folded
  into one description; the seeded export list corrected to include
  `openProjection`; consumer contracts and owned gaps stated once.
- 2026-09-23 — F03: checkpoint evolution (D37), the relationship/snapshot/inert/
  decision/lineage query surface, and the append-table tail handler landed by
  SESSION-03 (`f29ac33`..`a2c4cf0`), consumed by SESSION-06's promotion/append
  writers (`4287569`..`677b947`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-03 staple
  folded into the public API, tail-commit contract and internal-module
  sections; the F02-recorded "no constructible input" gap for
  `import_lineages`/`inference_decisions` moved to "Closed in F03" with its
  producer; the tail-commit "no schema row" contract sentence corrected to
  name F03's one exception (`table.created` in an append), which the F02 text
  did not anticipate and would otherwise read as contradicting M23's landed
  append path.

<!-- formulas-queries-charts SESSION-03 -->
### F04 delta — SESSION-03 (M12 — Projection (`src/persistence/projection/`))

- **New edge M12 → M03** (`../../domain/formulas/`): recalculation runs through the one bounded interpreter (D60, invariant 8) instead of a second evaluator; the projection sweep `tests/unit/projection/module-boundaries.test.ts` allows it and its negative control still refuses the import pipeline.
- `OpenProjectionInitV1.clock: () => EvaluationClockReadingV1` (required; the worker supplies local time). Handle carries `clock` and `volatileReading`.
- Replay (`apply-events.ts`) handles every F04 kind inside the commit's transaction: `schema_tables`/`schema_fields` (incl. `is_computed`, `formula_id`) updates, `relationships` insert/update/delete, `validation_rules` upsert/retire (rows are never deleted — issues reference them), `formulas` upsert/retire + `formula_dependencies`; app name. Reorders park moved fields above `2^30` first (unique `(table_id, field_ordinal)`). History subject kinds: relationship → `field`, rule/formula → their `objectId`. A commit that re-shapes an existing table rebuilds its authored lanes + search text and, with `revalidate`, its verdicts (`reindexRecord`).
- `field.changed` refreshes the per-session definition cache — the currency code lives there (F02 carry closed).
- **Recalculation** (`recalc-plan.ts` pure, `recalc.ts` SQL): hydrate step 6 = full pass after the graph is loaded; a record commit recomputes only `downstreamOf` the moved fields, and only the written rows for a row-local formula (widening to every row for column/related/formula reads); a schema commit is a full pass; `refreshVolatile` re-evaluates clock-volatile formulas when the reading is ≥ 60 s old or on another local day. Writes CA-26 exactly: computed lane (`origin='computed'`), recalculated `formula` issue (ids `computedIssueId`: pk ‖ 0xff ‖ fieldId[0..7], disjoint from validator ordinals), or `scalar_formula_results` (evaluated_at_ms = session clock). Frozen/unsupported columns project the authored literal into the computed lane and are never evaluated; cycles are flagged, never evaluated. Record writes delete only authored cells and validator issues (`DELETE_AUTHORED_CELLS_FOR_RECORD`, `DELETE_VALIDATOR_ISSUES_FOR_RECORD`). Computed fields are excluded from `record_search`.
- Reads: `readComputedCells` derives each computed cell's state from its lane + issue (+ authored literal); every record summary carries `computed`.
- Checkpoint load inserts formulas (after fields, all before any dependency).

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M12 Projection (`src/persistence/projection/`))

- New query kind `query-records` on the closed `ProjectionQueryV1` union: `{tableId, search, filters: ProjectionFilterTermV1[], sort: ProjectionRecordSortV1 | null, after: ProjectionQueryCursorV1 | null, limit, candidateBudget}` → `ProjectionRecordQueryResultV1 {records, hasMore, next: {recordPk, sortValue} | null, total: number | null, partial: {scanned, tableTotal} | null}`.
- `filter-sql.ts` composes the statements from literal fragments only. Every value is bound, and the only request-chosen SQL is `?` counts and the choice among literal fragments. Terms: `id-in`, `integer-range`, `decimal-range` (20-byte order key), `text-equals` / `text-contains`, `reference-broken`, `is-empty`, `not-empty`.
- Two registered deterministic SQL functions (`authored-functions.ts`):
  - `sheaf_authored_kind(authored_cbor, field_id)` returns the closed value kind only.
  - `sheaf_fold_text(text)` returns case-folded NFC (`foldText`); text filters are case-insensitive.
- Sort: one field, keyset over `(sort value, record_pk)`; missing values last in both directions. Enum sorts by option ordinal, reference by the parent's label (else key) field.
- Budget: candidates are the table ∧ search. Past the budget, the first N candidates in `record_pk` order are admitted and the result has `total: null` plus `partial {scanned, tableTotal}`. Within the budget, `total` is an exact `count(*)`.
- `RECORD_SUMMARY_COLUMNS` is exported from `statements.ts`.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M12 projection — `src/persistence/projection/`)

- `charts` rows: `UPSERT_CHART` / `DELETE_CHART` / `SELECT_CHART_IDS` (`statements.ts`); `upsertChartRow` (`hydrate.ts`) hydrates the checkpoint root and caches definitions in `schema.charts` (engine cache; reads come from it, `definition_cbor` is written by `cbor-values.ts#encodeChartDefinition`, byte-identical to M23's codec — pinned in `roots.test.ts`).
- Replay (`apply-events.ts`): `chart.saved` requires `chartRevision` = 0 for a new chart or held revision + 1, and a payload consistent with its definition; `chart.deleted` requires a held chart. A taken ordinal is refused by `UNIQUE (chart_ordinal)`. History subject `chart`, subject id = `objectId`.
- New `chart-query.ts#chartDataset(handle, query, labelOf)`: bounded page loop (1,000 rows/statement) over the newest `sourceRowBudget` rows by `record_pk DESC`, one `cells` alias per dimension/measure, S04's filter terms via `filter-sql.ts#queryWhere` (now exported), exact decimal aggregation (M03 `decimal.ts`), text grouped case-insensitively (`foldText`) as the text filter matches, dates bucketed by epoch-day arithmetic, relationship groupings join reference → parent record → parent lane and keep the parents per category. `query-exec.ts` dispatches it with its own `recordLabel`.
