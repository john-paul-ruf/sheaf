# M36 — Workflows (`src/application/workflows/`)

Extracted from specs/architecture.md §Module Contracts (Workflows).
Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** Explicit lifecycle state for long operations and destructive gates.
- **Depends on:** M32 (`workers/protocol/client.js` for
  `DataWorkerRequestError`, `messages.js` types), M07 (`ClockPort`), M53
  (`LockReason`, **type-only** — erased at build, so there is no runtime edge
  from application to bootstrap).
- **Must not:** import React or persistence/crypto; retain secrets in machine
  context after the consuming transition; persist snapshots (nothing persists
  one today; later persisted snapshots must be encrypted and value-free);
  reorder FR-22's recovery-before-reset offer; read a wall clock directly. All
  asserted by `tests/unit/workflows/module-boundaries.test.ts`, which checks its
  file lists against the directories themselves so a new file cannot escape the
  sweep.

## Landed exports

### Security (F01)

- `services.ts` — `SecurityServices`, `SecurityWorkerPort`,
  `createSecurityServices(port)`, `SecurityError`, `toSecurityError(cause)`,
  `PassphrasePolicyPort`, `PassphraseStrength`, `PassphraseMatch`,
  `wordCountPassphrasePolicy`, `PASSPHRASE_MINIMUM_WORDS`,
  `RecoveryCodeFormatPort`; plus (F02) `ApplicationServices` and
  `createApplicationServices`, composing the security, records and import sets
  from one worker client.
- Machines: `setupMachine`, `unlockMachine` (+ `UNLOCK_ROUTES_IN_ORDER`,
  `COUNTDOWN_TICK_MS`), `recoveryMachine`, `passphraseChangeMachine`,
  `revealCodeMachine`, `resetMachine` (+ `RESET_CONFIRMATION_PHRASE`,
  `isResetPhraseMatched`), `sessionMachine` (+ `IDLE_TIMEOUT_OPTIONS`,
  `MINUTE_MS`, `isRetryableSettingsError`). Each machine also exports its
  `*Input`, `*Context` and `*Event` types. `resetMachine` has the dual entry
  (locked-generic / readable) with three explicit gate states and the typed
  phrase.

### Import and records (F02)

- `import-services.ts` — `ImportServices`, `ImportWorkerPort`,
  `ImportServicesOptions`,
  `createImportServices({dataWorker, spawnImportWorker})`. Owns the run's
  `MessageChannel` and the import worker's lifetime: spawned at `startImport`
  (port1 in the transfer list), terminated on every terminal state of the
  machine. `beginStage` transfers port2 in the `beginImportStage` request.
  `spawnImportWorker` is **injected** — application code takes no edge to
  `src/bootstrap/`.
- `records-services.ts` — `RecordsServices`, `RecordsWorkerPort`,
  `createRecordsServices(port)`: `listLibrary`, `openApp`, `closeApp`,
  `noteAppOpened`, `queryRecords`, `getRecord`, `createRecord`, `patchRecord`,
  `deleteRecord`, `restoreRecord`, `getChangeHistory`. **No machine**: these are
  short-running request/response pairs with no lifecycle to remember.
- `import.machine.ts` — `importMachine` plus `ImportInput`, `ImportContext`,
  `ImportEvent`, `ImportDetectedFactsV1`, `ImportRefusalFactsV1`,
  `ImportDestinationV1`, `ImportFailureReasonV1`, `ImportPhaseV1`,
  `ImportProgressFactsV1`, `ImportPromotionFactsV1`, `PromotionRejectionV1`,
  `isChosenName`, `beginStageInput`, `PARSER_STOP_TIMEOUT_MS = 5_000`.

**Machine surface the surfaces bind to verbatim.** States: `choosingFile`,
`detecting`, `delimitedTarget`, `fits`, `overBudget`, `refused`,
`beginningStage`, `parsing`, `inferring`, `reviewing.{deciding,applyingEdit}`,
`promoting`, `cancelling.{stopping,cleaning}`, `cancelled`, `failing`,
`failed`, `done` (final). Events: `CHOOSE_FILE{file,fileName}`,
`IMPORT_EVENT{event}`, `SET_APP_NAME{text}`, `SET_TABLE_NAME{text}`,
`CONTINUE`, `BACK`, `START`, `CANCEL`, `APPLY_EDIT{edit}`, `CREATE_APP`.

## Contracts worth recording

- **Secret hygiene is structural.** A secret lives in a machine's `draft` field
  only while the invoked service consuming it is in flight, and is cleared by
  the transition that settles it (`clearDraft`). Recovery codes live in context
  only while a display state is active. No machine persists a snapshot.
- **Two ports exist because M36 may not import crypto.**
  `RecoveryCodeFormatPort` (wired by M54's `app-runtime.tsx` to M08's
  `parseRecoveryCode` through a dynamic import) gives the recovery machine its
  pre-KDF spelling check; `PassphrasePolicyPort` keeps strength policy out of
  the machines. `wordCountPassphrasePolicy` is the default, implementing
  setup.html's stated rule (four or more words) and injectable by the caller.
- **Persist-then-arm (D13/AD-7).** `sessionMachine.active` is a *parallel*
  state with a `settings` region (`idle` / `savingIdleTimeout`) and an
  `idleTimer` region (`deciding` / `disarmed` / `armed`). `SET_IDLE_TIMEOUT`
  never touches the timer; only a successful `updateSettings` response
  re-enters `idleTimer.deciding`, and the adopted value is the worker's, not
  the optimistic one. A refused write leaves both the stored value and the
  running countdown untouched. Proven by a parallel-state negative control.
- **Delay schedule is rendered, never recomputed.** `unlockMachine` renders the
  worker-supplied `retryAfterMs` (CA-05 / AD-5). No machine owns the schedule.
- **`detecting` covers sniff *and* size; there is no separate `preflighting`
  state.** `import.worker.ts` sniffs and sizes in one round trip before it
  emits anything, so an over-budget file arrives as a `refused` event and a
  fitting one as `preflight`. `fits` (SCR-018) is the user's confirmation of a
  measurement pre-flight already made, not a second measurement (D20).
- **A cancel waits for the parser before it cleans up.** `cancelling` is
  `initial: "stopping"`: `stopping` waits for the parser's terminal
  `IMPORT_EVENT` (`cancelled` | `completed` | `failed`) with
  `after: { [PARSER_STOP_TIMEOUT_MS]: "cleaning" }` so a parser that never
  answers cannot strand the cancel; `cleaning` then runs the cleanup invoke.
  **Why it is not optional:** telling a parser across a worker boundary to stop
  is not the same as it having stopped, and the batches already in flight keep
  landing — cleaning into that race makes the envelope store answer
  `revision-conflict`, and every cancel ended `cleanup-unconfirmed` instead of
  printing MOD-007's "no partial app remains". SESSION-07 reproduced it 3/3
  through the real entry (3,000 rows after 50 ms; 20,000 rows after 100 ms and
  after 1.2 s). Three transitions target `cancelling.cleaning` **directly**,
  because they already know the parser has finished: `parsing`'s `IMPORT_EVENT
  cancelled` (that event *is* the terminal report), and `CANCEL` from
  `inferring` and from `reviewing` (both reachable only through `completed`).
- **Every terminal state runs cleanup and waits for the receipt.** `cancelled`
  and `failed` are reached only through `cancelling`/`failing`, which invoke
  `cancelImportStage` and assign its `ImportCleanupReceiptViewV1` before the
  surface may claim anything (MOD-007, CA-10). A cleanup that does not answer
  becomes `failure: "cleanup-unconfirmed"` with **no** receipt — the VM then
  says cleanup could not be confirmed rather than "no partial app remains".
- **The M37 error-kind seam is cleared without widening
  `DataWorkerErrorKindV1`.** Every mutating stage call (`runInference`,
  `applyReviewEdit`, `promoteImport`) is gated on `getImportStage` first; a
  `null` stage becomes `failure: "stage-missing"`, never the data worker's
  `integrity` kind, whose copy ("the local store did not pass its integrity
  check") is false after an ordinary reload-mid-import plus unlock sweep. No
  kind was added, so M37's exhaustive `REFUSAL_ANNOUNCEMENT` map is unchanged.
- **A typed promotion rejection returns to `reviewing`, not to `failed`.** A
  refusal is a typed result that wrote nothing (D23); routing it to `failed`
  would run cleanup and destroy the stage the user just reviewed. Only a
  *service* failure fails the run.
- **The source file is never retained in context.** A snapshot holds the file's
  name and its measurements, never the `Blob`; "Retry same file" is the page
  re-sending `CHOOSE_FILE` with the handle its picker still owns.
- **The target screen's names enter the proposal as review edits.** `rename-app`
  / `rename-table` are enqueued when inference returns, so what the user typed
  is visible and undoable at review rather than silently overwriting it.

Each of the F02 contracts above ships with a non-vacuous negative control in
`tests/unit/workflows/import.machine.test.ts`; the cancel-ordering suite (6
cases: the no-terminal-event control, one per terminal kind, the `after`
fallback under fake timers, and the already-finished path that must not wait)
was verified to fail 5 of 6 against the pre-correction machine.

## Known gaps with owners

- `recoveryMachine` exposes `retryAfterMs` but has **no ticking countdown
  actor** — the countdown is `unlockMachine`'s only. Still harmless: F02 changed
  no recovery flow and the delay remains unreachable from that route.
  `COUNTDOWN_TICK_MS` is exported and consumed nowhere outside
  `unlock.machine.ts`, which is where the lift would start. Owner: the next
  session that touches the unlock/recovery machines (F05's vault-recovery work
  at the latest). Dependents blocked by it: none.
- `PARSER_STOP_TIMEOUT_MS = 5_000` is a fixed bound chosen to be generous
  against a real parser; whether it should be tunable is an F03 glance, not an
  open defect.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 implemented by SESSION-06 (`883f815`): seven machines + the
  services layer, persist-then-arm proven via parallel state plus a negative
  control; consumed by SESSION-07 (`9174b6d`) with the actors living in
  `src/routes/`, not `src/ui/**`, because `tests/unit/ui/architecture.test.ts`
  forbids a state-machine runtime inside the UI modules.
- 2026-09-08 — reconciled by Roshi (F01 final pass): the recoveryMachine
  countdown gap promoted from a session return into this fragment; staple merged.
- 2026-09-08 — F02: `importMachine`, import/records services and
  `ApplicationServices` landed by SESSION-06 (`cc60008`); the cancel-ordering
  correction by SESSION-07 under lease revision r2 (`b596dac`), after its own
  e2e found the race — which is also what turned
  `tests/e2e/import-flow.spec.ts`'s MOD-007 cleanup-receipt case from a
  `test.fail()` marker into a genuine pass at `5867b02`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): two session staples folded;
  the cancel-ordering fix stated as the module's contract rather than as a
  correction note; the test-suite paragraphs that described M56/M61 work
  compressed into the evidence sentence above, since they are proof of M36's
  contract and not a second module's description.
