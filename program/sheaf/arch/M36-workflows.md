# M36 — Workflows (`src/application/workflows/`)

Extracted from specs/architecture.md §Module Contracts (Workflows).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

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
  `createRecordsServices(port)`: the F02 ten app commands, plus (F03, S08)
  nine reads bound verbatim to S03's RPCs — `getRelatedRecords`,
  `getRelatedChildren`, `searchReferenceCandidates`, `getDeletedRecord`,
  `listTables`, `listSheetSnapshots`, `getSnapshotPage` (≤ 1,000 rows/page),
  `findInSnapshot`, `listInertItems`. Each is a straight `port.send({kind,
  ...})`, with no reshaping. No machine: short-running request/response pairs.
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
  never the data worker's `integrity` kind. Unchanged by F03; the F03 workbook
  stage calls (`runInference`/`applyReviewEdit`/`promoteImport`) are gated
  the same way.
- **A typed promotion rejection returns to `reviewing`, not to `failed`.**
- **The source file is never retained in context.**
- **The target screen's names enter the proposal as review edits.**
  `rename-app`/`rename-table` are enqueued when inference returns.

Each F02 contract above ships with a non-vacuous negative control in
`tests/unit/workflows/import.machine.test.ts`; the cancel-ordering suite (6
cases) was verified to fail 5 of 6 against the pre-correction F02 machine.
F03's rewrite kept every one of these tests green while replacing the
single-table shape underneath them.

## Known gaps with owners

- `recoveryMachine` exposes `retryAfterMs` but has **no ticking countdown
  actor** — the countdown is `unlockMachine`'s only. Owner: the next session
  that touches the unlock/recovery machines (F05's vault-recovery work at the
  latest). Unchanged by F03 (F03 touched no recovery flow).
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

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M36 Records services)

- `queryRecords` passes `filters`, `sort` and `sortCursor` through.
- New `getAppStructure({appId})` and `getAppMetrics({appId})`.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M36 workflows — `src/application/workflows/records-services.ts`)

- `ChartServices` + `createChartServices(port)` live here (not in a new `chart-services.ts`): `tests/unit/workflows/module-boundaries.test.ts` enumerates the directory's files and is outside S05's lease (Custom Rule 7, the S08 precedent).

<!-- formulas-queries-charts SESSION-07 -->
### F04 delta — SESSION-07 (M36 / M37 / M43 — view-models and UI (import review))

- `import.ts` VM: `ReviewCalculationVm`, `ReviewChartVm` (with `isPinned`), `ReviewRuleVm`. `records.ts` inert sentences revised (exported types unchanged).
- `src/ui/import/review-screen.tsx`: calculation articles (reject/restore/why), rule descriptions, "N formulas keep working" count, dashboard sheet copy. `review-evidence.tsx`: formula-outcome evidence copy.
