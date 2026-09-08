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

<!-- foundation-first-unlock SESSION-05 -->
- 2026-09-08 — SESSION-05 landed (final revision `27ba411`). Delta:

### M32 — Worker protocol (`src/workers/protocol/`) — first implementation

`messages.ts` is the whole wire contract and imports nothing (proved by
`tests/unit/workers/module-boundaries.test.ts`): `PROTOCOL_VERSION = 1`;
`IDLE_TIMEOUT_MINUTES_V1 = [0,5,15,60]` + `IdleTimeoutMinutesV1` +
`isIdleTimeoutMinutesV1`; request union `DataWorkerRequestV1` (`setup`,
`unlock`, `unlockWithRecoveryCode`, `changePassphrase`, `revealRecoveryCode`,
`lock`, `updateSettings`, `resetLocked`, `resetReadable`, `getStatus`);
response union `DataWorkerResponseV1` + `ResponseForV1<K>`; views
`UnlockedSessionViewV1`, `LockedSessionViewV1`, `SessionStatusViewV1`,
`LocalSettingsViewV1`, `ResetInventoryViewV1`; error envelope
`DataWorkerErrorV1 { kind, retryAfterMs? }` over the closed
`DATA_WORKER_ERROR_KINDS_V1`; message envelopes + the `isDataWorker*MessageV1`
guards. The union names no `Uint8Array`, `ArrayBuffer`, or key type — key bytes
are type-excluded from the boundary, not merely absent by convention.

`client.ts` → `DataWorkerClient` (correlation ids, per-request timeout,
`transfer` list, `terminate()` failing everything in flight, `isRunning`),
`DataWorkerRequestError`, `DEFAULT_REQUEST_TIMEOUT_MS = 60_000`. The worker is
spawned on the first request, never at construction.

`redact.ts` → `DataWorkerCommandError(kind, {retryAfterMs?})` and
`redactError(cause)`. No error message ever crosses the boundary; anything
unrecognised becomes `internal`.
