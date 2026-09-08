# M36 — Workflows (`src/application/workflows/`)

Extracted from specs/architecture.md §Module Contracts (Workflows). F01 scope.

- **Owns:** Explicit lifecycle state for long operations and destructive gates.
- **F01 exports:** SetupMachine, UnlockMachine, RecoveryMachine,
  PassphraseChangeMachine, RevealCodeMachine, ResetMachine (dual entry:
  locked-generic / readable; three explicit gate states + typed phrase),
  SessionMachine (lockNow, pagehide intake, idle timer off-default), plus
  `services.ts` adapters over the worker client.
- **Depends on:** M32 client types, M53 lifecycle, injected clock/policy.
- **Must not:** import React or persistence/crypto; retain secrets in machine
  context after the consuming transition; persist snapshots (F01 persists
  none; later persisted snapshots must be encrypted and value-free);
  reorder FR-22's recovery-before-reset offer.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-06.

<!-- foundation-first-unlock SESSION-06 -->
- 2026-09-08 — SESSION-06 landed (final revision `883f815`). Delta:

## M36 — Workflows (`src/application/workflows/`) — implemented

**Landed exports.** `services.ts`: `SecurityServices`, `SecurityWorkerPort`,
`createSecurityServices(port)`, `SecurityError`, `toSecurityError(cause)`,
`PassphrasePolicyPort`, `PassphraseStrength`, `PassphraseMatch`,
`wordCountPassphrasePolicy`, `PASSPHRASE_MINIMUM_WORDS`,
`RecoveryCodeFormatPort`. Machines: `setupMachine`, `unlockMachine`
(+ `UNLOCK_ROUTES_IN_ORDER`, `COUNTDOWN_TICK_MS`), `recoveryMachine`,
`passphraseChangeMachine`, `revealCodeMachine`, `resetMachine`
(+ `RESET_CONFIRMATION_PHRASE`, `isResetPhraseMatched`), `sessionMachine`
(+ `IDLE_TIMEOUT_OPTIONS`, `MINUTE_MS`, `isRetryableSettingsError`). Each
machine also exports its `*Input`, `*Context` and `*Event` types.

**Dependency edges (new).** M36 → M32 (`workers/protocol/client.js` for
`DataWorkerRequestError`, `messages.js` types), M36 → M07 (`ClockPort`),
M36 → M53 (`LockReason`, **type-only** — erased at build, no runtime edge from
application to bootstrap). M36 imports no React, no persistence, no crypto,
and reads no wall clock directly; asserted by
`tests/unit/workflows/module-boundaries.test.ts`.

**Two contracts worth recording.**
- *Secret hygiene is structural.* A secret lives in a machine's `draft` field
  only while the invoked service consuming it is in flight, and is cleared by
  the transition that settles it (`clearDraft`). Recovery codes live in
  context only while a display state is active. No machine persists a
  snapshot; nothing in F01 serialises one.
- *Two ports exist because M36 may not import crypto.*
  `RecoveryCodeFormatPort` (wired by S07 to M08's `parseRecoveryCode`) gives
  the recovery machine its pre-KDF spelling check, and `PassphrasePolicyPort`
  keeps strength policy out of the machines. `wordCountPassphrasePolicy` is
  the default, implementing setup.html's stated rule (four or more words).

**Persist-then-arm (D13/AD-7).** `sessionMachine.active` is a *parallel* state
with a `settings` region (`idle` / `savingIdleTimeout`) and an `idleTimer`
region (`deciding` / `disarmed` / `armed`). `SET_IDLE_TIMEOUT` never touches
the timer; only a successful `updateSettings` response re-enters
`idleTimer.deciding`, and the adopted value is the worker's, not the
optimistic one. A refused write leaves both the stored value and the running
countdown untouched — the regions are what make that true rather than a
convention.
