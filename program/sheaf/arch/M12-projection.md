# M12 — Projection (`src/persistence/projection/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Projection and `specs/database.md` § In-Memory SQLite
> Projection. Reconciled against the tree at `5ab3b07` (F02 final).

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

The query set is closed: `app-state`, `list-tables`, `list-fields`,
`list-enum-options`, `list-validation-rules`, `count-records`, `page-records`,
`search-records`, `record-by-id`, `page-change-history`,
`record-change-history`. Page sizes are bounded to 1–1024 and refused outside it.

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
  imports it, and since S05 it is reachable from the production entry graph
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
  opaque canonical CBOR), so the caller supplies the typed F02 events
  alongside. The guard proves count, order, and *kind* agree — it cannot compare
  payload bytes, so payload↔typed-event agreement stays the caller's obligation.
  M07's `LocalEventRepository` discharges it by deriving the wire payload from
  the typed event.
- **Issues come from the one shared validator.** The checkpoint carries them per
  record; replay carries them in `issuesByEventIndex`. The engine authors exactly
  one issue of its own: `validation.decimal-out-of-domain` (warning, kind
  `type`) when a canonical decimal falls outside the v1 order-key exponent
  domain — the value stays in `authored_cbor` and gets no decimal lane.
- **`records.authored_cbor` is the record; `cells` is an index over it.** Values
  with no lane (missing, blank, invalid-preserved, wrong-typed, out-of-domain
  decimal) remain completely readable through `record-by-id`.
- **Identity of returned maps.** A `Map` keyed by a domain ID matches on object
  identity; `query-exec` re-keys returned value maps to the schema's own
  `FieldId` instances so `values.get(field.fieldId)` works with a `field` from
  `list-fields`.
- **Failure disposes everything.** A constraint, trigger, or replay-guard failure
  rolls the batch back and closes the database; every entry point then throws
  `IntegrityError("projection has been disposed")`. Eighteen `IntegrityError`
  classes; five disposal negatives proven in the browser.
- **`app_state`/theme comes from the checkpoint (D29).** Hydration composes no
  default theme.
- **FTS5 detail=column cannot answer a phrase query.** Search issues per-word
  quoted AND terms with a trailing `*`, and the `MATCH` must be unaliased.
- **`totalCount` on a search page is the TABLE count** (CA-14); the scope says
  which. There is no match-count field.
- **An `app/table/field.created` arriving in a TAIL commit writes change history
  only** — it creates no schema row. That is why M23's single import-class
  commit must pair `app.created` with the initial checkpoint (CA-11): an
  unknown table or field in replay disposes the projection.

## Known gaps with owners (recorded, not defects)

- `schema_fields` has no `currencyCode` column, so a currency field cannot
  round-trip; `list-fields` refuses rather than guesses. First hurt: F04's
  schema editor → DB re-entry at F04 planning.
- `import_lineages` and `inference_decisions` have no constructible F02 input
  (S01's payloads lack the fields); `applyEvents` records `change_history` only.
  First consumer is F06 re-upload (or F03) → that feature names the producer.
- The chain guard keeps the accumulated commit set in memory. Correct at F02
  scale; revisit for long tails.
- Test-time fixture output `dist/__projection__/` joins the F08 precache
  exclusion debt.
- Deliberate absences with later owners: relationships, formulas, charts,
  inert content, baselines, conflicts, merges.

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

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**M12 — Projection**
- `ProjectionCheckpointV1` += `relationships`, `inertItems`, `importLineages`, `inferenceDecisions` (projectable only). Load order: sheets → tables → fields → key/label → options → relationships → rules → inert → lineages → decisions. Schema cache += `relationships` (keyed by reference field).
- Tail (CA-23): `table.created` for an unknown table builds sheet row (from `sourceSheet`) + table + fields + key/label refs; `field.created` for a known table inserts the field; for an unknown table → integrity dispose. Summaries carry `tableId`.
- New queries: `record-is-live`, `list-relationships{tableId|null}`, `related-parent{recordId, fieldId}`, `related-children{relationshipId, parentRecordId, afterRecordPk, limit}` (via `idx_cells_field_id`), `count-related-children` (count(*)), `reference-candidates{relationshipId, text, limit}` (FTS over parent table; blank browses), `deleted-record{recordId}`, `list-sheet-snapshots` (+ inert counts per kind via `idx_inert_content_sheet`), `list-inert-items{sheetId|null}`, `list-inference-decisions{decisionKind|null}`. Labels = label field else key, as display text.
