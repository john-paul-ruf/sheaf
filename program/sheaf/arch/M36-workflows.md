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
