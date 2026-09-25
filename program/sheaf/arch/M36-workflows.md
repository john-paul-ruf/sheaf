# M36 — Workflows (`src/application/workflows/`)

Extracted from specs/architecture.md §Module Contracts (Workflows).
Reconciled against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

- **Owns:** Explicit lifecycle state for long operations and destructive gates.
- **Depends on:** M32 (`workers/protocol/client.js` for
  `DataWorkerRequestError`, `messages.js` types), M07 (`ClockPort`), M53
  (`LockReason`, **type-only**).
- **Must not:** import React or persistence/crypto; retain secrets in machine
  context after the consuming transition; persist snapshots; reorder FR-22's
  recovery-before-reset offer; read a wall clock directly. All asserted by
  `tests/unit/workflows/module-boundaries.test.ts`, which checks its file
  lists against the directories themselves.

## Landed exports

### Security (F01)

- `services.ts` — `SecurityServices`, `SecurityWorkerPort`,
  `createSecurityServices(port)`, `SecurityError`, `toSecurityError(cause)`,
  `PassphrasePolicyPort`, `PassphraseStrength`, `PassphraseMatch`,
  `wordCountPassphrasePolicy`, `PASSPHRASE_MINIMUM_WORDS`,
  `RecoveryCodeFormatPort`; plus (F02) `ApplicationServices` and
  `createApplicationServices`.
- Machines: `setupMachine`, `unlockMachine` (+ `UNLOCK_ROUTES_IN_ORDER`,
  `COUNTDOWN_TICK_MS`), `recoveryMachine`, `passphraseChangeMachine`,
  `revealCodeMachine`, `resetMachine` (+ `RESET_CONFIRMATION_PHRASE`,
  `isResetPhraseMatched`), `sessionMachine` (+ `IDLE_TIMEOUT_OPTIONS`,
  `MINUTE_MS`, `isRetryableSettingsError`).

### Import and records (F02, import machine rewritten F03)

- `import-services.ts` — `ImportServices`, `ImportWorkerPort`,
  `ImportServicesOptions`, `createImportServices({dataWorker,
  spawnImportWorker})`. Owns the run's `MessageChannel` and the import
  worker's lifetime. `ACCEPTED_FLOWS = ["delimited","workbook"]` sent on
  `startImport` (F03, D48). `beginStage(Omit<BeginImportStageRequestV1,
  "kind">)`, `proceed({stageId, selectedSheets?})`, `listLibrary()`,
  `listTables({appId})` (F03).
- `records-services.ts` — `RecordsServices`, `RecordsWorkerPort`,
  `createRecordsServices(port)`: the F02 ten app commands, the nine F03 reads
  (`getRelatedRecords`, `getRelatedChildren`, `searchReferenceCandidates`,
  `getDeletedRecord`, `listTables`, `listSheetSnapshots`, `getSnapshotPage`
  (≤ 1,000 rows/page), `findInSnapshot`, `listInertItems`) bound verbatim to
  S03's RPCs, and (F04) `getAppStructure`, `getAppMetrics`;
  `queryRecords`/`getRecord`/etc. now pass `filters`, `sort` and
  `sortCursor` through. Each is a straight `port.send({kind, ...})`, with no
  reshaping. No machine: short-running request/response pairs.
- `import.machine.ts` — `importMachine` plus `ImportInput`, `ImportContext`,
  `ImportEvent`, `PARSER_STOP_TIMEOUT_MS = 5_000`.

**Machine surface — F03 rewrite (one machine, two branches).** `detecting`
covers sniff and size for both delimited and workbook files; a workbook
arrives as `workbook-preflight` and enters `workbookSizing.{routing →
fits | subset | handoff}` (route is the pre-flight report's, D31); default
selection is `report.defaultSelection` (D47). Delimited files still go
through `delimitedTarget`/`fits`/`overBudget` unchanged.

New events (F03): `SET_DESTINATION{destination}`, `TOGGLE_SHEET{sheetIndex}`,
`SELECT_ALL`, `CLEAR_ALL`, `COPY_HANDOFF{result}`; `APPLY_EDIT.edit` is now
`WorkbookReviewEditWireV1` (keys, never names). `CANCEL` in `workbookSizing`
→ `choosingFile` (terminates the parser; nothing staged). `START` from
`workbookSizing.fits|subset` is guarded by `selectionFits` (non-empty and ≤
`report.budgets.maxEstimatedCells`, per-sheet estimates, null weighs 0 — the
same arithmetic as `routeOf`). `handoff` accepts only
`COPY_HANDOFF`/`CHOOSE_FILE`/`CANCEL`.

Context adds (F03): `workbook`, `selectedSheets`, `handoffCopy`, `library:
listing|listed{apps}|unlisted`, `destination: new-app | existing-app{appId}`,
`progress.sheet {ordinal,count,name}|null`, `failureDetail`,
`promoted.appendedTableId`.

`delimitedTarget` invokes `listLibrary`; `SET_DESTINATION{existing-app}` only
when the app is listed and `appendEventEstimate(facts) = estimatedRows +
columns + 2 ≤ APPEND_EVENT_CAP (10,000)` (D38; test-pinned to M23
`APPEND_MAX_EVENTS`). `beginStage` request: delimited (+ `destination` for an
append) or workbook (every inventoried sheet, sorted `selectedSheets`);
`proceed` carries `selectedSheets` for a workbook only. A
`refused{workbook-format-later-release}` fails closed (`failing`,
`service-error`) — the page accepts workbooks (D42/D48), so reaching this
refusal at all would be a contract break, not a normal route. `promoting`
accepts under `proposal.appName` (the reviewed name — regression fixed: the
SCR-017 name used to win over a review rename). An append reads `listTables`
before and after the commit and records the new table id.
`PARSER_STOP_TIMEOUT_MS` stays 5,000 ms (measured xlsx cancel latency:
13.5–17.9 ms, ~280× headroom).

**States (full):** `choosingFile`, `detecting`, `delimitedTarget`, `fits`,
`overBudget`, `workbookSizing.{routing,fits,subset,handoff}`, `refused`,
`beginningStage`, `parsing`, `inferring`, `reviewing.{deciding,applyingEdit}`,
`promoting`, `cancelling.{stopping,cleaning}`, `cancelled`, `failing`,
`failed`, `done` (final).

### F04: schema and theme services (SESSION-06, SESSION-08)

- `schema-services.ts` (new): `SchemaServices {getAppStructure,
  previewSchemaChange, applySchemaChange}` + `createSchemaServices(port:
  RecordsWorkerPort)`; typed adapters, no machine; every outcome stays a
  result.
- `theme-services.ts` (new): `ThemeServices {listThemePalettes, changeTheme,
  prepareLogo}`; `createThemeServices(port, codec = browserLogoCodec)`.
  `LogoCodecPort.toPng(file, maxEdge)` decodes with `createImageBitmap` and
  re-encodes a PNG ≤ 256 px on an `OffscreenCanvas`. `prepareLogo` refuses
  types other than PNG/JPEG/WebP, unreadable files, and PNGs over 64 KiB.
  Wired as `SecurityWiring.theme` → `AppAreaWiring.theme`.
- `ChartServices` + `createChartServices(port)` (SESSION-05) live in
  `records-services.ts`, **not** a new `chart-services.ts`: the file-list
  sweep `tests/unit/workflows/module-boundaries.test.ts` enumerates the
  directory's files, and adding a file it does not already list is an
  out-of-lease edit for a session that does not hold that test (the S08
  precedent, Custom Rule 7). All three of `WORKFLOW_FILES`/`VIEW_MODEL_FILES`
  additions (`schema-services.ts`, `view-models/schema.ts`, `theme-services.ts`,
  `view-models/theme.ts`) were pre-issued as a lease addition to S06 and S08
  before dispatch (the WF-BOUNDARY seam), so neither session was blocked by
  it — see PROGRAM-CONFIG's lease/boundary-sweep convention.

### F04: import review VM/UI extensions (SESSION-07)

`import.ts` VM gains `ReviewCalculationVm`, `ReviewChartVm` (with
`isPinned`), `ReviewRuleVm`; `records.ts`'s inert sentences are revised
(exported types unchanged). `src/ui/import/review-screen.tsx` gains
calculation articles (reject/restore/why), rule descriptions, an "N formulas
keep working" count, and dashboard-sheet copy; `review-evidence.tsx` gains
formula-outcome evidence copy. (Both files are M43's; recorded here because
the delta landed jointly with M36's own CA-33/live-structure work.)

## Contracts worth recording

- **Secret hygiene is structural.** A secret lives in a machine's `draft`
  field only while the invoked service consuming it is in flight, and is
  cleared by the transition that settles it. No machine persists a snapshot.
- **Two ports exist because M36 may not import crypto.**
  `RecoveryCodeFormatPort` (wired by M54's `app-runtime.tsx` to M08's
  `parseRecoveryCode` through a dynamic import) and `PassphrasePolicyPort`.
- **Persist-then-arm (D13/AD-7).** `sessionMachine.active` is a *parallel*
  state; only a successful `updateSettings` response re-enters
  `idleTimer.deciding`, and the adopted value is the worker's, not the
  optimistic one.
- **Delay schedule is rendered, never recomputed.** `unlockMachine` renders
  the worker-supplied `retryAfterMs` (CA-05 / AD-5).
- **A cancel waits for the parser before it cleans up.** `cancelling` is
  `initial: "stopping"`, with `after: {[PARSER_STOP_TIMEOUT_MS]: "cleaning"}`
  as a fallback; three transitions target `cancelling.cleaning` directly
  because they already know the parser has finished.
- **Every terminal state runs cleanup and waits for the receipt.** A cleanup
  that does not answer becomes `failure: "cleanup-unconfirmed"` with **no**
  receipt.
- **The M37 error-kind seam is cleared without widening
  `DataWorkerErrorKindV1`.** Every mutating stage call is gated on
  `getImportStage` first; a `null` stage becomes `failure: "stage-missing"`,
  never the data worker's `integrity` kind. Unchanged by F03/F04; the F03
  workbook stage calls and F04's schema/chart/theme services are all
  request/response pairs outside the machine, so they never touch this seam
  at all.
- **A typed promotion rejection returns to `reviewing`, not to `failed`.**
- **The source file is never retained in context.**
- **The target screen's names enter the proposal as review edits.**
  `rename-app`/`rename-table` are enqueued when inference returns.

Each F02 contract above ships with a non-vacuous negative control in
`tests/unit/workflows/import.machine.test.ts`; the cancel-ordering suite (6
cases) was verified to fail 5 of 6 against the pre-correction F02 machine.
F03's rewrite kept every one of these tests green while replacing the
single-table shape underneath them. F04 added no machine states — every F04
surface (structure, charts, theme) is request/response services plus route
hooks, not a new XState machine.

## Known gaps with owners

- `recoveryMachine` exposes `retryAfterMs` but has **no ticking countdown
  actor** — the countdown is `unlockMachine`'s only. Explicit owner: F05
  S02 CP5 (PC-F05-02, CAP-05), with clock wiring, machine/VM/UI tests and
  real-entry recovery-countdown proof. Still unimplemented at `d75830d`;
  native bundle receipt work does not close it.
- `PARSER_STOP_TIMEOUT_MS = 5_000` remains a fixed bound; F03 measured real
  xlsx cancel latency (13.5–17.9 ms) and left it unchanged rather than tuning
  it — ~280× headroom, not a defect.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 implemented by SESSION-06 (`883f815`): seven machines + the
  services layer; consumed by SESSION-07 (`9174b6d`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): the recoveryMachine
  countdown gap promoted from a session return into this fragment; staple merged.
- 2026-09-08 — F02: `importMachine`, import/records services and
  `ApplicationServices` landed by SESSION-06 (`cc60008`); the cancel-ordering
  correction by SESSION-07 under lease revision r2 (`b596dac`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): two session staples
  folded; the cancel-ordering fix stated as the module's contract.
- 2026-09-23 — F03: mechanical single-table adaptation by SESSION-06
  (`4287569`..`677b947`), replaced by the real two-branch rewrite by
  SESSION-07 (`2185774`..`e062f41`); `RecordsServices`' nine relationship/
  snapshot reads added by SESSION-08 (`eba5790`..`30396a9`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three staples (two of
  which described the same file at two different, sequential states — S06's
  mechanical adapter and S07's replacement of it) folded into one description
  of the machine as it now stands, per Principle 2 ("the head contract is the
  authoritative statement; a delta that supersedes it is folded in, not left
  below it").
- 2026-09-23 — F04: `records-services.ts`'s `queryRecords` filter/sort pass-
  through and `getAppStructure`/`getAppMetrics` by SESSION-04
  (`f736fa8`..`27a2667`); `ChartServices` (in `records-services.ts`, per
  Custom Rule 7) by SESSION-05 (`6ee204c`..`3dd1d2d`); the import review
  VM/UI copy by SESSION-07 (`978bb77`..`f9a1565`); `schema-services.ts` by
  SESSION-06 (`e7e7fe2`..`7ec391e`); `theme-services.ts` by SESSION-08
  (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): five SESSION deltas
  folded into "Landed exports" (a new F04 subsection) and "Contracts worth
  recording"; the WF-BOUNDARY lease seam recorded as successfully pre-empted
  (zero sessions blocked), which is the positive counterpart to S04's
  `projection-port.test.ts`/`commands/fakes.ts` seam recorded in
  `M07-ports.md` and `M35-queries.md` — see PROGRAM-CONFIG's Conventions for
  both.


<!-- durable-home-backup SESSION-02 CP3 a93a87c -->
## M36 / M47 / M54 — CP3 confirmation component
DurabilityServices, durabilityMachine and BundleSaveRoute provide transient preparing/delivering/awaiting-confirmation/confirming/native-saved/user-saved/cancelled/failed/interrupted states. BundleSaveDialog uses the accepted MOD-025 copy and a keyboard-dismissible, non-backdrop-dismissible modal. SecurityWiring.durability is composed from the current AppRuntime. CP4 still owns mounting the full home/vault/save journey and supplying authoritative receipt/count readers.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M36 / M37 — recovery countdown and receipt views

`RecoveryInput` requires `ClockPort`; RecoveryRoute supplies `wiring.clock`. Positive worker retryAfterMs (including invalid-recovery-code responses) enters an ephemeral deadline-based waiting state. Ticks clamp remaining time to zero; waiting ignores submit/retry, clears secret drafts, and cancels its timer on exit/stop. The recovery VM exposes canSubmit, remainingMs and remainingSeconds. Expiry permits a request and never grants authority; successful recovery still requires installing a replacement local passphrase.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.
