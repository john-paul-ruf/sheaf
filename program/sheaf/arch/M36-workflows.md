# M36 — Workflows (`src/application/workflows/`)

Extracted from specs/architecture.md §Module Contracts (Workflows). F01 scope.
Reconciled against the tree at `2c0248a`.

- **Owns:** Explicit lifecycle state for long operations and destructive gates.
- **F01 exports (landed):**
  - `services.ts` — `SecurityServices`, `SecurityWorkerPort`,
    `createSecurityServices(port)`, `SecurityError`, `toSecurityError(cause)`,
    `PassphrasePolicyPort`, `PassphraseStrength`, `PassphraseMatch`,
    `wordCountPassphrasePolicy`, `PASSPHRASE_MINIMUM_WORDS`,
    `RecoveryCodeFormatPort`.
  - Machines: `setupMachine`, `unlockMachine` (+ `UNLOCK_ROUTES_IN_ORDER`,
    `COUNTDOWN_TICK_MS`), `recoveryMachine`, `passphraseChangeMachine`,
    `revealCodeMachine`, `resetMachine` (+ `RESET_CONFIRMATION_PHRASE`,
    `isResetPhraseMatched`), `sessionMachine` (+ `IDLE_TIMEOUT_OPTIONS`,
    `MINUTE_MS`, `isRetryableSettingsError`). Each machine also exports its
    `*Input`, `*Context` and `*Event` types.
  - `resetMachine` has the dual entry (locked-generic / readable) with three
    explicit gate states and the typed phrase.
- **Depends on:** M32 (`workers/protocol/client.js` for
  `DataWorkerRequestError`, `messages.js` types), M07 (`ClockPort`), M53
  (`LockReason`, **type-only** — erased at build, so there is no runtime edge
  from application to bootstrap).
- **Must not:** import React or persistence/crypto; retain secrets in machine
  context after the consuming transition; persist snapshots (F01 persists none;
  later persisted snapshots must be encrypted and value-free); reorder FR-22's
  recovery-before-reset offer; read a wall clock directly. All asserted by
  `tests/unit/workflows/module-boundaries.test.ts`.

## Contracts worth recording

- **Secret hygiene is structural.** A secret lives in a machine's `draft` field
  only while the invoked service consuming it is in flight, and is cleared by
  the transition that settles it (`clearDraft`). Recovery codes live in context
  only while a display state is active. No machine persists a snapshot; nothing
  in F01 serialises one.
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
  running countdown untouched — the regions are what make that true rather
  than a convention. Proven by a parallel-state negative control.
- **Delay schedule is rendered, never recomputed.** `unlockMachine` renders the
  worker-supplied `retryAfterMs` (CA-05 / AD-5: five free failures, first 2s
  delay at the sixth attempt, doubling to a 1h cap). No machine owns the
  schedule.

## Known gap carried into F02+

`recoveryMachine` exposes `retryAfterMs` but has **no ticking countdown actor**
— the countdown is `unlockMachine`'s only. Harmless in F01 because the delay is
reachable only from SCR-003; `COUNTDOWN_TICK_MS` is exported and currently
consumed nowhere outside `unlock.machine.ts`, which is where the lift would
start.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-06 (`883f815`): seven machines + the
  services layer, 83 tests green, persist-then-arm proven via parallel state
  plus a negative control.
- 2026-09-08 — consumed by SESSION-07 (`9174b6d`, re-run at `2c0248a`): the
  actors live in `src/routes/`, not in `src/ui/**`, because
  `tests/unit/ui/architecture.test.ts` forbids a state-machine runtime inside
  the UI modules.
- 2026-09-08 — reconciled by Roshi (final pass): the recoveryMachine countdown
  gap promoted from a session return into this fragment; session-delta staple
  merged.
