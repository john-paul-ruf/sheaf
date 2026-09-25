# M54 — Routes (`src/routes/`)

Extracted from specs/architecture.md §Module Contracts (Routes).
Reconciled against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

- **Owns:** URL ↔ approved-SCR mapping, lock-state guards, (later) OAuth
  return routing.
- **Exports (landed):**
  - `route-table.tsx` → `SheafApp`.
  - `guards.tsx` → `ROUTE_PATHS`, `ROUTE_HREFS`, `RouteName`, `RoutePath`,
    `SessionPhase`, `RouteGuardResult`, `guardRoute`, `fallbackRoute`,
    `LOCKED_ROUTES`, `UNLOCKED_ROUTES`, `FIRST_RUN_ROUTES`, `appPath`,
    `appHref`, `appHistoryPath`, `tablePath`, `newRecordPath`, `recordPath`,
    `editRecordPath`, `hashHref`, `isAppAreaPath`, `appSnapshotsPath`,
    `snapshotPath`, `APP_AREA_PATH` (F03), and (F04) `chartsPath`,
    `newChartPath`, `chartPath`, `editChartPath`, `structurePath`,
    `appSettingsPath`, `appThemePath`.
  - `app-runtime.tsx` → `useSheafRuntime`, `RuntimeState`, `SheafRuntime`,
    `SecurityWiring`; plus the `ImportArea` and `AppArea` compositions.
  - `app-area-hooks.tsx` (F03) → `AppAreaWiring`, `useTableSwitcher`,
    `useListReferences`, `referenceSearchFor`.
  - `snapshot-routes.tsx` (F03) → `SnapshotsRoute`, `SnapshotViewerRoute`.
  - `filter-intent.ts` (F04, new) → `RECORDS_FILTER_INTENT_KEY`,
    `filterIntentState`, `readFilterIntent`, `RECORDS_FILTER_ORIGIN_KEY`,
    `readFilterOrigin`.
  - `chart-routes.tsx` (F04, new) → `ChartsIndexRoute`, `ChartBuilderRoute`,
    `ChartDetailRoute`, `usePinnedCharts`, `openMarkRecords`.
  - `schema-routes.tsx` (F04, new) → `StructureRoute`, `AppSettingsRoute`,
    `useSchemaChange(area)`.
  - `theme-routes.tsx` (F04, new) → `ThemeRoute`, `usePalettes`, `glyphOf`.
- **Depends on:** M53 (`startApp`, `spawnImportWorker`), M36 (all machines +
  `createImportServices`, and F04's `schema-services`/`theme-services`),
  M37 (selectors), M41–M46 (F04 adds M45/M46), M38 (`Button`,
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
`/app/:appId/t/:tableId`, `…/new`, `…/r/:recordId`, `…/r/:recordId/edit`,
`/app/:appId/snapshots`, `/app/:appId/snapshots/:sheetId` (F03), and (F04)
`/app/:appId/charts`, `/app/:appId/charts/new`, `/app/:appId/charts/:chartId`,
`/app/:appId/charts/:chartId/edit`, `/app/:appId/structure`,
`/app/:appId/settings`, `/app/:appId/theme`.

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

`APP_AREA_PATH` matches `/app/{id}/snapshots` and
`/app/{id}/snapshots/{sheetId}`, unlocked-only. An unknown sheet id renders
the truthful notice "That sheet snapshot is not in this app." at the path,
with "All snapshots".

### Amendment 4 (S05/S06/S08, F04) — charts, structure, settings, theme

`APP_AREA_PATH` grows to **fifteen** shapes total, adding: `/app/{id}/charts`
(DF-2 index), `/app/{id}/charts/new` (SCR-034), `/app/{id}/charts/{chartId}`
(SCR-033), `/app/{id}/charts/{chartId}/edit` (SCR-034 on an existing chart),
`/app/{id}/structure` (SCR-035), `/app/{id}/settings` (SCR-037), and
`/app/{id}/theme` (SCR-036). All are unlocked-only, per the amendment 2
precedent. **A filter intent travels through router navigation state, never
the URL** (invariant 3 spirit — a filter can carry a reference value, so it
stays out of the hash): `RECORDS_FILTER_INTENT_KEY =
"sheaf.records.filterIntent"`, plus `RECORDS_FILTER_ORIGIN_KEY` naming the
chart and record labels a mark-driven filter came from. Each of the three
owning sessions (S05 charts, S06 structure/settings, S08 theme) extended
`isAppAreaPath` and `route-guards.test.ts` independently, in dependency
order, with no cross-lease conflict.

The full matrix is asserted case by case in `tests/e2e/route-guards.spec.ts`.

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
  `records: RecordsServices`, and (F04) `schema: SchemaServices`, `theme:
  ThemeServices`; `AppAreaWiring` gains `charts: ChartServices` (F04) beside
  its F03 relationship/table-switcher hooks. The import services are built
  inside `ImportArea`.
- **`AppAreaWiring`** is what every app-area route is given: the open
  session, the navigation, the worker edge, an `announce`, and a `refresh`.
  F03 grows it into `app-area-hooks.tsx` (Custom Rule 7): the same file also
  holds `useTableSwitcher`, `useListReferences` and `referenceSearchFor`,
  which every relationship-consuming screen shares. **F04** adds `structure`
  (loaded per opened app), `recalculated`, `announce(sentence,
  recalculatedFieldIds?)`, and `charts` to this wiring — all in the same
  file, again per Custom Rule 7 (the hooks file, not the routes it composes,
  is the shared home).
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
- **F04: `chart-routes.tsx`** (Custom Rule 7): draft restore, a debounced
  live preview, MOD-012/MOD-013 wiring for the builder; `usePinnedCharts` and
  `openMarkRecords` feed both the app home and the records route.
- **F04: `schema-routes.tsx`** (Custom Rule 7): `useSchemaChange(area)` is
  the one hook every schema-editing surface shares — preview → MOD-014 →
  apply at `preview.schemaRevision`; on `stale-preview` it re-previews and
  shows the new counts; only `applied` announces, after the commit, then
  calls `area.refresh()`.
- **F04: `theme-routes.tsx`** (Custom Rule 7): `usePalettes` reads the
  built-in palette list once per app-theme session; `glyphOf` resolves the
  library-tile glyph the theme editor previews.

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
- 2026-09-23 — F04: `filter-intent.ts` and the structure/metrics wiring by
  SESSION-04 (`f736fa8`..`27a2667`); the chart half of amendment 4 +
  `chart-routes.tsx` by SESSION-05 (`6ee204c`..`3dd1d2d`); the structure/
  settings half + `schema-routes.tsx` by SESSION-06 (`e7e7fe2`..`7ec391e`);
  the theme half + `theme-routes.tsx` by SESSION-08 (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): four SESSION deltas
  folded into the Route table (now stating all fifteen app-area shapes as one
  list), a new "Amendment 4" subsection replacing the three separate partial
  amendment-4 notes, and the Structural-facts section; the Exports list
  updated to name every F04 file.


<!-- durable-home-backup SESSION-02 CP3 a93a87c -->
## M36 / M47 / M54 — CP3 confirmation component
DurabilityServices, durabilityMachine and BundleSaveRoute provide transient preparing/delivering/awaiting-confirmation/confirming/native-saved/user-saved/cancelled/failed/interrupted states. BundleSaveDialog uses the accepted MOD-025 copy and a keyboard-dismissible, non-backdrop-dismissible modal. SecurityWiring.durability is composed from the current AppRuntime. CP4 still owns mounting the full home/vault/save journey and supplying authoritative receipt/count readers.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M41 / M42 / M44 / M47 / M54 — mounted durability and security surfaces

`/app/:appId/backup` mounts SCR-038/SCR-039 with real home services, vault creation/reuse, separate labelled recovery cards, secret-confirmed vault-code review, and the existing operation-bound save flow. App home links to this route. Library and readable reset display the same confirmed timestamp and pending count. Reset offers the app backup route and re-enumerates on return. Recovery codes lists authenticated connected homes and links to scoped review. The countdown disables premature UI submission and clears entered codes.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.


<!-- durable-home-backup SESSION-03 r3 -->
## M54 — routes

`ScratchReminderRoute` is mounted once per keyed opened app. Route/generation changes re-query; backup choice suppresses the reminder so setup remains reachable. Dismissal uses the machine; home choice navigates to the existing app backup route. If the original launcher disappeared, closing focuses the app heading. Schema `unchanged` announces no changes without fabricating a saved receipt. Chart services notify the same refresh boundary as record/schema/theme actions.


Independent receive at47a633b: typecheck/lint exit0;223files/2461unit pass/3inherited skips; exact combined current-build browser gate11pass/0skip/0retry. Original full e2e81pass is Coder-run, source-identical evidence reviewed; focused composed gates independently rerun. S06/S07 future graph/provider proofs remain owned.
