# M12 — Projection (`src/persistence/projection/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Projection and `specs/database.md` § In-Memory SQLite
> Projection. Reconciled against the tree at `5bc19fb` (F04 final;
> formulas-queries-charts).

## Contract

- **Owns:** Plaintext relational state for the current unlocked session.
- **Exports:** `openProjection`, `hydrateApp`, `applyEvents`, `executeQuery`,
  `disposeProjection` (`createExportCursor` is F07).
- **Depends on:** SQLite WASM (`@sqlite.org/sqlite-wasm`), M09 pure helpers,
  M01/M02 types, M03 (F04, the recalculation engine — see below), M10 read-only.
  Schema authority: `src/migrations/005_projection_v1.sql` executed via
  `migrateProjectionSchema` from `src/migrations/index.js` (CA-06: never
  redeclare, never inline SQL DDL).
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
openProjection(init: { sha256: Sha256Fn, clock: () => EvaluationClockReadingV1 })
  : Promise<ProjectionHandleV1>                                    // clock: F04
hydrateApp(handle, checkpoint: ProjectionCheckpointV1,
           tailCommits?: readonly ProjectionCommitV1[]): Promise<void>
applyEvents(handle, commits: readonly ProjectionCommitV1[]): Promise<ProjectionApplyReceiptV1>
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
`Sha256Fn`, and (F04) `ProjectionFormulaV1`, `ProjectionScalarResultV1`,
`ProjectionComputedCellV1`, `ProjectionApplyReceiptV1`, `ProjectionChartV1`,
`ProjectionChartDatasetV1`, `ProjectionChartKeyV1`, `ProjectionChartGroupV1`,
`ProjectionChartPointV1`.

**Query set, 26 kinds at F04 close (F02's 11, +10 F03, +1 `query-records` +
2 chart kinds F04):**

- **F02 (unchanged):** `app-state`, `list-tables`, `list-fields`,
  `list-enum-options`, `list-validation-rules`, `count-records`,
  `page-records`, `search-records`, `record-by-id`, `page-change-history`,
  `record-change-history`. Page sizes are bounded to 1–1024 and refused
  outside it.
- **F03:** `record-is-live`, `list-relationships{tableId|null}`,
  `related-parent{recordId, fieldId}`, `related-children{relationshipId,
  parentRecordId, afterRecordPk, limit}` (via `idx_cells_field_id`),
  `count-related-children`, `reference-candidates{relationshipId, text,
  limit}` (FTS over the parent table; a blank query browses),
  `deleted-record{recordId}`, `list-sheet-snapshots` (+ inert counts per kind
  via `idx_inert_content_sheet`), `list-inert-items{sheetId|null}`,
  `list-inference-decisions{decisionKind|null}`. `listTables` gained a variant
  taking `appId` — `openApp` already returned exact table counts, so this is a
  second read path, not a new fact.
- **F04:** `list-formulas {tableId|null}`, `scalar-results` (S03);
  `query-records {tableId, search, filters, sort, after, limit,
  candidateBudget} → ProjectionRecordQueryResultV1 {records, hasMore, next,
  total, partial}` (S04, D53's query budget); `list-charts` →
  `ProjectionChartV1[]` (display order) and `chart-dataset {tableId, filters,
  shape, sourceRowBudget} → ProjectionChartDatasetV1 | null` (S05, D53's
  chart budget).

Labels resolve as the label field else the key, as display text.

## Internal modules

| File | Holds |
|---|---|
| `engine.ts` | `:memory:` open, `ProjectionMigrationHost`, statement cache, `withTransaction` (rollback **then dispose**), `disposeProjection` |
| `sort-keys.ts` | `textSortKeyV1` (NFC UTF-8), `decimalOrderKeyV1` (20 bytes, `null` outside the v1 exponent domain), `compareSortKeys` |
| `cbor-values.ts` | The projection's own payload-column codecs: authored record, theme, rule IR, formulas (F04), charts (F04), change summary, message parameters, frontier — see "Duplicate codecs" below |
| `record-rows.ts` | One record → `records`/`cells`/`record_issues`/`record_search`; `projectCellValue`, `searchableTextFor`, `deriveIssueId` |
| `statements.ts` | **Every** SQL statement, as literals with `?` placeholders; `toFtsMatchQuery`; `RECORD_SUMMARY_COLUMNS` (F04) |
| `hydrate.ts` | The load order, one transaction for metadata and one per record page; `upsertChartRow` (F04) |
| `apply-events.ts` | Replay guards and per-kind row effects, including every F04 schema/rule/formula/chart kind |
| `query-exec.ts` | The closed read surface |
| `recalc-plan.ts` / `recalc.ts` (F04) | Pure recalculation planning and the SQL that carries it out |
| `filter-sql.ts` (F04) | Prepared-statement composition for `query-records`, from literal fragments only |
| `authored-functions.ts` (F04) | Two deterministic SQL functions: `sheaf_authored_kind`, `sheaf_fold_text` |
| `chart-query.ts` (F04) | `chartDataset(handle, query, labelOf)` — the bounded aggregation behind `chart-dataset` |

## Dependency edges

- **M12 → M09** (`persistence/codecs`): `canonical-cbor` for the payload columns
  and `event-commit` for `verifyCommitChain`, `compareCommits`, `sortFrontier`.
  The projection decodes no envelope; it consumes M09's *pure* helpers.
- **M12 → M10** (read-only): `migrateProjectionSchema`,
  `PROJECTION_MIGRATION_ORDER`, and `005_projection_v1.sql?raw` as a build asset
  (CA-06). No DDL string exists anywhere in M12.
- **M12 → M01/M02**: domain ids, values, schema, events, provenance, and the
  validator's issue/rule vocabulary (types only — the projection never validates
  on its own authority; F04's `revalidate` callback asks the *caller's* shared
  validator, it does not embed one).
- **M12 → M03** (F04, new): recalculation runs through the one bounded
  interpreter (D60, invariant 8) instead of a second evaluator; the projection
  sweep `tests/unit/projection/module-boundaries.test.ts` allows exactly this
  edge and its negative control still refuses the import pipeline.
- **M12 → `@sqlite.org/sqlite-wasm`.** M12 is the first product module that
  imports it, reachable from the production entry graph since F02
  (`index.html` → app-bootstrap → the data-worker chunk).

## Dependency must-nots (ship as tests)

- No import from `src/ui/`, `src/import/`, `src/sync/`, `dexie`,
  `src/persistence/envelope-store/`. The projection never reads IndexedDB —
  callers hand it decoded checkpoint pages and commits.
- Enforced by `tests/unit/projection/module-boundaries.test.ts`: an import
  allow-list (now including `src/domain/formulas/`), a forbidden list (dexie,
  envelope-store, ui, import, sync, libsodium), a no-DDL scan, and a negative
  control that proves the scan fires.

## Contracts a consumer must know

- **The engine never reads storage and never decrypts.** Callers hand it decoded
  checkpoint pages and decoded commits. It holds no key; SHA-256 is injected.
  **F04:** local calendar time is injected too — `OpenProjectionInitV1.clock`
  is required, and the handle carries `clock` and `volatileReading`.
- **`ProjectionCommitV1` pairs the raw `EventCommitV1` with typed events.**
  `EventCommitV1.payload` is `unknown` by contract (M09 carries payloads as
  opaque canonical CBOR), so the caller supplies the typed events alongside.
  The guard proves count, order, and *kind* agree — it cannot compare payload
  bytes, so payload↔typed-event agreement stays the caller's obligation.
  M07's `LocalEventRepository` discharges it by deriving the wire payload from
  the typed event.
- **Issues come from the one shared validator.** The checkpoint carries them per
  record; replay carries them in `issuesByEventIndex`. The engine authors two
  issues of its own: `validation.decimal-out-of-domain` (warning, kind `type`)
  when a canonical decimal falls outside the v1 order-key exponent domain, and
  (F04) the recalculated `formula` issue for a computed cell in an error/cycle/
  unsupported state (id `computedIssueId`: pk ‖ `0xff` ‖ fieldId[0..7],
  disjoint from validator ordinals).
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
  which. **F04's `query-records`** adds an *exact* `total` within the D53
  budget, and `partial {scanned, tableTotal, cause:"query-budget",
  remedy:"narrow-filters"}` past it — a plain browse/search keeps the F03
  semantics unchanged.
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
- **F04: recalculation lives in the same SQLite transaction as the record
  mutation** (D60). Only downstream nodes are recomputed
  (`idx_formula_dependencies_dependency`): a record commit recomputes only
  `downstreamOf` the moved fields, and only the written rows for a row-local
  formula (widening to every row for column/related/formula reads); a schema
  commit is a full pass; hydrate step 6 is a full pass once the graph loads;
  `refreshVolatile` re-evaluates clock-volatile formulas when the reading is
  ≥ 60 s old or on another local day. Frozen/unsupported columns project the
  authored literal into the computed lane and are never evaluated; cycles are
  flagged, never evaluated. Record writes delete only authored cells and
  validator issues (`DELETE_AUTHORED_CELLS_FOR_RECORD`,
  `DELETE_VALIDATOR_ISSUES_FOR_RECORD`) — the computed lane is rebuilt, not
  deleted-and-reinserted wholesale. Computed fields are excluded from
  `record_search`. `readComputedCells` derives each computed cell's state from
  its lane + issue (+ authored literal); every record summary carries
  `computed`.
- **F04: `field.changed` refreshes the per-session definition cache.** This is
  where a currency field's `currencyCode` actually lives across a schema
  change — closed the F02/F03-carried "currency code cannot round-trip" gap
  without a migration (see "Known gaps", below, for the full disposition).
- **F04: `charts` rows.** `UPSERT_CHART` / `DELETE_CHART` / `SELECT_CHART_IDS`;
  `upsertChartRow` hydrates the checkpoint root and caches definitions in
  `schema.charts` (engine cache; reads come from it). Replay requires
  `chartRevision = 0` for a new chart or held revision + 1, and a payload
  consistent with its definition; a taken ordinal is refused by `UNIQUE
  (chart_ordinal)`. History subject `chart`, subject id = `objectId`.

## Duplicate codecs: M12's session cache vs. M23's durable roots (payload-evolution seam)

**M12 cannot import M23** (a cache running inside the data worker's live
session may not depend on the staging/promotion module), so three payloads —
rule IR, chart definitions, and (F04) theme v2 — are encoded **twice**: once by
M23's `roots.ts` for the durable checkpoint root, and once by M12's own
`cbor-values.ts` for the projection's in-memory cache column. This is
structurally necessary, not an oversight, but it is a real drift risk: a
payload version change that updates one copy and not the other is a silent
divergence, not a compile error.

**F04 evidence, three occurrences of the identical shape:**

1. **Rule IR** (S03) — both copies landed together in the same checkpoint;
   no counterexample.
2. **Chart definitions** (S05) — the risk was recognized and closed
   *proactively*: `cbor-values.ts#encodeChartDefinition` is pinned
   byte-identical to M23's codec in `roots.test.ts` before either drifted.
3. **Theme v2** (S08) — the risk was **not** closed proactively. S08's first
   attempt found `cbor-values.ts`'s theme codec still encoding only the v1
   shape, so "keep the logo" silently dropped it; a lease revision
   (`+ cbor-values.ts`, with a fail-before test) was required to add the v2
   fields and pin them byte-equal to M23's `encodeAppTheme`
   (`tests/unit/projection/cbor-values.test.ts`).

Two of three payload versions needed no correction because their producing
session's lease already held both files or pinned them proactively; one did
not, and broke. **Any future payload-shape change to a value this cache also
holds must lease `cbor-values.ts` alongside the durable codec it mirrors**, and
should default to a byte-equality test the way S05's chart codec did. See
PROGRAM-CONFIG's Conventions for the promoted form of this rule.

## Known gaps with owners (recorded, not defects)

- Test-time fixture output `dist/__projection__/` joins the F08 precache
  exclusion debt.
- The F05 authored-state cursor consumes supplied baseline states for backup
  hashing; this is not a general baseline query or merge path. Nonempty
  retained/conflict/audit graph production and readers await GRAPH-CONTRACT
  and S06; reconciliation actions remain later work.

## Closed in F03 (was open at `5ab3b07`, resolved here — not re-carried)

- **`import_lineages` and `inference_decisions` had no constructible F02
  input**, so `applyEvents` recorded `change_history` only. Closed: F03's
  checkpoint carries both as projectable roots (`ProjectionCheckpointV1 +=
  relationships, inertItems, importLineages, inferenceDecisions`), M23's
  promotion (`decisionsOf`, the import commit's `inference-decision.recorded`
  events) and append path are the producers CA-23/CA-19 name, and
  `list-inference-decisions`/rejection-memory reads consume them.

## Closed in F04 (was open at `425562d`, resolved here — not re-carried)

- **`schema_fields` had no `currencyCode` column, so a currency field could
  not round-trip through the projection** — disproved as a schema defect at
  F04 planning, not fixed as one: the currency code lives in the encrypted
  field definition (M01's `FieldTypeV1`), and the projection's per-session
  definition cache already carries the whole `FieldDefV1`. S03 CP1 wired the
  cache to refresh on `field.changed`, closing the gap with no migration and
  no `list-fields` change.

## Durable-home implementation (F05, current)

The assignment event moves app_state.durable_home_id from null to assigned identity; repeated assignment fails. No migration changed.

Isolated projection hydration accepts streamed record pages and disposes on iterator failure. Authored-state SQL cursors include provenance, restoration, schema, rules, formulas, charts and supplied baseline states, excluding computed volatile values/local status. Replay retains last verified device hashes rather than decoded commit history. Provenance lookup uses field-ID bytes across durable decode, fixing restoration evidence loss.

Source: S01 `694c741` / `13e83f1` / `8674766`, S02 `03ee571` / `c7e6507` / `d75830d` (as applicable to this module); F05 STATE at `95a539d` and Final Report. Scope and remaining owners: [F05 boundaries](F05-boundaries.md).

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
- 2026-09-23 — F04: the M03 recalculation edge, formulas root and computed-cell
  contract by SESSION-03 (`a69e6e0`..`2235cce`); `query-records` by SESSION-04
  (`f736fa8`..`27a2667`); charts rows and dataset aggregation by SESSION-05
  (`6ee204c`..`3dd1d2d`); the theme codec's v2 fields (lease r2, a
  counterexample) by SESSION-08 (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): four SESSION deltas
  folded into the public API, internal-modules, dependency-edges and
  contracts sections; the currency-code gap moved to "Closed in F04" (it was
  still open text in the F03-reconciled fragment); a new "Duplicate codecs"
  section added recording the M12/M23 payload-evolution seam as a named,
  recurring risk (three F04 instances — rule IR, charts, theme — the third of
  which broke and needed a lease correction) rather than leaving the theme
  counterexample as an isolated session surprise with no forward-looking
  contract. See PROGRAM-CONFIG's Conventions for the promoted rule.
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.


<!-- durable-home-backup SESSION-06 r9 -->
## M12 — F05 compaction (M12 projection)

- **M12 projection.** `ProjectionCheckpointExportPort` (`checkpoint()`, `records(signal)`), `authoredRecords`, `checkpointMetadata`, `copyCheckpointHistory`, `hydrateBaselines`, `checkpointEvidence`; original `conflict.detected` / `conflict.resolved` / `merge.applied` replay writes only evidence SQL and validates against the shared validator, baseline and same-commit effects.

Independent receive at 2d8ff2d: typecheck/lint exit 0; full unit 229 files/2520 pass/3 inherited skips; CP1+installed gate 39 files/473 pass; browser J3 2/2, sync/compaction+bundle 3/3, J1/append/status/records/gate-f02/import-journey 18/18 on port 8081 fresh build. CP1 intermittent counterexample closed 7e785e4 (fixture picked random warned row; production refusal correct). Real-browser quota refusal unproven (component-level only).
