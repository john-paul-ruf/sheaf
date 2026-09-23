# M54 — Routes (`src/routes/`)

Extracted from specs/architecture.md §Module Contracts (Routes).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

- **Owns:** URL ↔ approved-SCR mapping, lock-state guards, (later) OAuth
  return routing.
- **Exports (landed):**
  - `route-table.tsx` → `SheafApp`.
  - `guards.tsx` → `ROUTE_PATHS`, `ROUTE_HREFS`, `RouteName`, `RoutePath`,
    `SessionPhase`, `RouteGuardResult`, `guardRoute`, `fallbackRoute`,
    `LOCKED_ROUTES`, `UNLOCKED_ROUTES`, `FIRST_RUN_ROUTES`, `appPath`,
    `appHref`, `appHistoryPath`, `tablePath`, `newRecordPath`, `recordPath`,
    `editRecordPath`, `hashHref`, `isAppAreaPath`, and (F03)
    `appSnapshotsPath`, `snapshotPath`, `APP_AREA_PATH`.
  - `app-runtime.tsx` → `useSheafRuntime`, `RuntimeState`, `SheafRuntime`,
    `SecurityWiring`; plus the `ImportArea` and `AppArea` compositions.
  - (F03) `app-area-hooks.tsx` → `AppAreaWiring`, `useTableSwitcher`,
    `useListReferences`, `referenceSearchFor`.
  - (F03) `snapshot-routes.tsx` → `SnapshotsRoute`, `SnapshotViewerRoute`.
- **Depends on:** M53 (`startApp`, `spawnImportWorker`), M36 (all machines +
  `createImportServices`), M37 (selectors), M41–M44, M38 (`Button`,
  `BusyIndicator`), M51 (`file-pick.ts`, and F03 `clipboard.ts`),
  react-router 8 (`HashRouter`) and `@xstate/react`.
- **Must not:** implement commands; infer state from provider availability;
  compose a surface missing from specs/design.md; **import a state-machine
  runtime into `src/ui/**`**.

## Route table

**Locked / first-run:** `/welcome`, `/setup`, `/unlock`, `/recover`, `/reset`
(locked reset).

**Unlocked:** `/library`, `/settings/security`,
`/settings/security/passphrase`, `/settings/security/recovery-codes`,
`/settings/security/reset`, `/library/search`, `/upload`, `/import`, plus the
app area matched by *shape*: `/app/:appId`, `/app/:appId/history`,
`/app/:appId/t/:tableId`, `…/new`, `…/r/:recordId`, `…/r/:recordId/edit`, and
(F03) `/app/:appId/snapshots`, `/app/:appId/snapshots/:sheetId`.

## CA-07 guards

`guardRoute(phase, pathname)` is a **pure function of the bootstrap/session
phase and the path only**. Locked reaches only welcome/setup/unlock/
recover/reset(locked); unlocked redirects those to library; unknown →
library|unlock; first-run → welcome.

### Amendment 1 (S07, F02) — the import routes

`/library/search`, `/upload` and `/import` are unlocked-only.

### Amendment 2 (S08, F02) — the app area

**The app area is matched by shape, not listed.** `guardRoute` gains one
clause — `phase === "unlocked" && isAppAreaPath(path)`. An unknown app id
renders and answers with a truthful "That app is not on this device" notice
at the app path, URL preserved.

### Amendment 3 (S08, F03) — snapshots

`APP_AREA_PATH` now matches **eight** shapes, adding `/app/{id}/snapshots`
and `/app/{id}/snapshots/{sheetId}`. Both are unlocked-only, per the amendment
2 precedent. An unknown sheet id renders the truthful notice "That sheet
snapshot is not in this app." at the path, with "All snapshots".

The matrix is asserted case by case in `tests/e2e/route-guards.spec.ts`: 46
rows across first-run/locked/unlocked, plus the app-path, library-search and
(F03) amendment-3 rows.

## Structural facts

- **`app-runtime.tsx` exists because a lock is a *termination*.**
  `AppRuntime.lockNow` terminates the client, and a terminated
  `DataWorkerClient` never spawns another.
- **New dependency edge M54 → M08 (crypto), dynamic.**
  `parseRecoveryCode` is wired through a dynamic `import()`.
- **`ImportArea` and `AppArea` sit above the router**, because each is many
  paths over one long-lived thing.
- **One run, one actor.** `done` is a top-level final state; the import actor
  is mounted by a key bumped when the run is over **and** the user has left
  the import area.
- **A lock ends the parser.** `ImportArea`'s cleanup calls
  `services.terminate()`.
- **The composition point is here (PC-12/D17).** `SecurityWiring` gains
  `records: RecordsServices`; the import services are built inside
  `ImportArea`.
- **`AppAreaWiring`** is what every app-area route is given: the open
  session, the navigation, the worker edge, an `announce`, and a `refresh`.
  **F03** grows it into `app-area-hooks.tsx` (Custom Rule 7): the same file
  now also holds `useTableSwitcher`, `useListReferences` and
  `referenceSearchFor`, which every relationship-consuming screen (record
  detail, form, table switcher) shares rather than each re-deriving its own
  reference-search plumbing.
- **New dependency edges (F02):** M54 → M43, M54 → M44, M54 → M51
  (`file-pick.ts`), M54 → M36's `importMachine`/`createImportServices`.
- **F03: `route-table.tsx` composes `WorkbookPreflightScreen`** (SCR-018/019
  workbook steps), wires `SET_DESTINATION`, `TOGGLE_SHEET`, `CLEAR_ALL`,
  `COPY_HANDOFF` (via the injected `copyText`), and sends review edits
  verbatim. Post-create landing: new app → `appPath(appId)`; append →
  `tablePath(appId, appendedTableId)`.
- **F03: `snapshot-routes.tsx`** (Custom Rule 7 — amendment 3's two new paths
  needed their own route components, separate from the records-table routes
  `app-area-hooks.tsx` already served): `SnapshotsRoute`,
  `SnapshotViewerRoute`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-07 (`9174b6d`, re-run at `2c0248a`);
  `route-guards.spec.ts` proves 34 guard cases.
- 2026-09-08 — reconciled by Roshi (F01 final pass): route table restated from
  `ROUTE_PATHS` as landed; staple merged.
- 2026-09-08 — F02: CA-07 amendment 1 + `ImportArea` by SESSION-07 (`8a665c1`);
  amendment 2 + `AppArea` by SESSION-08 (`fe3a8d4` → `5ab3b07`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): SESSION-07's staple
  folded, and the CA-07 amendment 2 section moved here from `M44-ui-records.md`.
- 2026-09-23 — F03: `WorkbookPreflightScreen` composition + handoff wiring by
  SESSION-07 (`2185774`..`e062f41`); CA-07 amendment 3 + `app-area-hooks.tsx` +
  `snapshot-routes.tsx` by SESSION-08 (`eba5790`..`30396a9`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): two staples folded
  into the Route table, CA-07 amendment list, Exports and Structural-facts
  sections.

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M54 Routes (`src/routes/`))

- `filter-intent.ts` (D63): `RECORDS_FILTER_INTENT_KEY = "sheaf.records.filterIntent"`, `filterIntentState(filters)` and `readFilterIntent(state)`. `RecordsRoute` keys its query state by `location.key` and starts from the intent.
- `AppAreaWiring` gains `structure` (loaded per opened app), `recalculated`, and `announce(sentence, recalculatedFieldIds?)`.
- `AppHomeRoute` loads `getAppMetrics`.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M54 routes — `src/routes/`)

- CA-07 amendment 4 (chart half): `chartsPath`, `newChartPath`, `chartPath`, `editChartPath` (`guards.tsx`); `isAppAreaPath` now also matches `/charts(/{id}(/edit)?)?` (incl. `/charts/new`). New `chart-routes.tsx`: `ChartsIndexRoute`, `ChartBuilderRoute` (draft restore, debounced preview, MOD-012/MOD-013), `ChartDetailRoute`, `usePinnedCharts`, `openMarkRecords`. `filter-intent.ts`: `filterIntentState(filters, origin?)`, `RECORDS_FILTER_ORIGIN_KEY`, `readFilterOrigin` (chart name + record labels, beside S04's intent key). `app-runtime.tsx` composes `ChartServices`; `app-area-hooks.tsx` `AppAreaWiring.charts`; `route-table.tsx` mounts the four chart paths and feeds app home and the records route.
