# M32 — Worker protocol (`src/workers/protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC). F01 scope.

- **Owns:** Thread boundary semantics: versioned typed RPC, correlation,
  cancellation, progress, transfer ownership, error redaction.
- **F01 exports:** `protocolVersion 1`; request union (`setup`, `unlock`,
  `unlockWithRecoveryCode`, `changePassphrase`, `revealRecoveryCode`, `lock`,
  `resetLocked`, `resetReadable`, `getStatus`); response/event unions; typed
  error envelope `{kind, retryAfterMs?}`; `DataWorkerClient`.
- **Depends on:** M01 safe types only.
- **Must not:** carry key bytes, passphrases in responses, or repository
  objects; locked responses expose no decrypted values; errors crossing the
  boundary are redacted via allowlist (CA-04).

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-05.
