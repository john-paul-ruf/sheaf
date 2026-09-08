# M32 — Worker protocol (`src/workers/protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC). F01
scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Thread boundary semantics: versioned typed RPC, correlation,
  cancellation, progress, transfer ownership, error redaction.
- **Depends on:** M01 safe types only — `messages.ts` in fact imports nothing
  at all, proved by `tests/unit/workers/module-boundaries.test.ts`.
- **Must not:** carry key bytes, passphrases in responses, or repository
  objects; locked responses expose no decrypted values; errors crossing the
  boundary are redacted via allowlist (CA-04).

## F01 surface (landed)

`messages.ts` is the whole wire contract:

- `PROTOCOL_VERSION = 1`.
- `IDLE_TIMEOUT_MINUTES_V1 = [0,5,15,60]` + `IdleTimeoutMinutesV1` +
  `isIdleTimeoutMinutesV1`.
- Request union `DataWorkerRequestV1`: `setup`, `unlock`,
  `unlockWithRecoveryCode`, `changePassphrase`, `revealRecoveryCode`, `lock`,
  **`updateSettings{idleTimeoutMinutes: 0|5|15|60}`** (D13/AD-7 — the literal
  union, not `number`; rejected when locked), `resetLocked`, `resetReadable`,
  `getStatus`.
- Response union `DataWorkerResponseV1` + `ResponseForV1<K>`; views
  `UnlockedSessionViewV1`, `LockedSessionViewV1`, `SessionStatusViewV1`,
  `LocalSettingsViewV1`, `ResetInventoryViewV1`.
- Error envelope `DataWorkerErrorV1 { kind, retryAfterMs? }` over the closed
  `DATA_WORKER_ERROR_KINDS_V1`.
- Message envelopes + the `isDataWorker*MessageV1` guards.

`client.ts` → `DataWorkerClient` (correlation ids, per-request timeout,
`transfer` list, `terminate()` failing everything in flight, `isRunning`),
`DataWorkerRequestError`, `DEFAULT_REQUEST_TIMEOUT_MS = 60_000`. The worker is
spawned on the first request, never at construction — and a terminated client
never spawns another, which is why a lock is a *termination* for M54 (see
M54's `app-runtime.tsx`).

`redact.ts` → `DataWorkerCommandError(kind, {retryAfterMs?})` and
`redactError(cause)`. No error message ever crosses the boundary; anything
unrecognised becomes `internal`.

**Key bytes are type-excluded, not merely absent.** The union names no
`Uint8Array`, `ArrayBuffer`, or key type anywhere; a grep assertion pins it.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`). `updateSettings` is new
  against the seeded contract, added by replan finding F-02 / D13 / AD-7 so
  FR-22's idle timeout has a writer.
- 2026-09-08 — CA-04's UI leg closed by SESSION-07 (`9174b6d`, re-run at
  `2c0248a`): screens bind S06's VM field names verbatim, locked screens render
  no inventory, and `retryAfterMs` is rendered and never recomputed.
- 2026-09-08 — reconciled by Roshi (final pass): head request union corrected
  to include `updateSettings`; session-delta staple merged.
