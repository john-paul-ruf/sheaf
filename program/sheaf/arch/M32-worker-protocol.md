# M32 — Worker protocol (`src/workers/protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC).
Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** Thread boundary semantics: versioned typed RPC, correlation,
  cancellation, progress, transfer ownership, error redaction.
- **Depends on:** M01 safe types only — `messages.ts` in fact imports nothing
  at all, proved by `tests/unit/workers/module-boundaries.test.ts`.
- **Must not:** carry key bytes, passphrases in responses, or repository
  objects; locked responses expose no decrypted values; errors crossing the
  boundary are redacted via allowlist (CA-04). **Key bytes are type-excluded,
  not merely absent** — the union names no `Uint8Array`, `ArrayBuffer`,
  `Transferable`, port, or key type anywhere, and a grep assertion pins it.
  Import bytes therefore live in `import-messages.ts`, never here.

## Files

| File | Holds |
|---|---|
| `messages.ts` | The page ↔ data-worker wire contract. Imports nothing. |
| `client.ts` | `DataWorkerClient`, correlation, timeouts, terminate |
| `redact.ts` | `DataWorkerCommandError`, `redactError` |
| `import-messages.ts` | The page ↔ import-worker contract, where byte payloads live |
| `import-client.ts` | `ImportWorkerClient` (spawn-on-demand, events, transfer, terminate) |
| `stage-channel.ts` | The worker↔worker fact channel |

## `messages.ts` — the data-worker contract (landed)

- `PROTOCOL_VERSION = 1`.
- `IDLE_TIMEOUT_MINUTES_V1 = [0,5,15,60]` + `IdleTimeoutMinutesV1` +
  `isIdleTimeoutMinutesV1`.
- **Session requests (F01):** `setup`, `unlock`, `unlockWithRecoveryCode`,
  `changePassphrase`, `revealRecoveryCode`, `lock`,
  **`updateSettings{idleTimeoutMinutes: 0|5|15|60}`** (D13/AD-7 — the literal
  union, not `number`; rejected when locked), `resetLocked`, `resetReadable`,
  `getStatus`.
- **Import requests (F02, S04):** `beginImportStage{fileName, detected,
  preflight}` → `{stageId}` only · `getImportStage{stageId}` → `{stage|null}`
  (idempotent) · `runInference{stageId}` → `{proposal}` ·
  `applyReviewEdit{stageId, edit}` → `applied{proposal} | rejected{reason}` ·
  `promoteImport{stageId, acceptedName}` → `promoted{appId, rowCount,
  tableCount, flaggedRecordCount} | rejected{reason, issues[]}` ·
  `listLibrary{}` → `{apps: LibraryAppV1[]}` · `cancelImportStage{stageId}` →
  `{receipt{reason, deletedCount, completed:true}}` (idempotent).
- **App requests (F02, S05):** `openApp{appId}` → `{session:
  AppSessionViewV1|null}` · `closeApp{appId}` → `{closed:true}` ·
  `noteAppOpened{appId}` → `{lastOpenedAtEpochMs:number|null}` (operational, no
  event) · `queryRecords{appId,tableId,cursor?,limit?,search?}` →
  `{page: RecordPageViewV1|null}` · `getRecord{appId,recordId}` →
  `{record: RecordDetailViewV1|null}` ·
  `createRecord` / `patchRecord` / `deleteRecord` / `restoreRecord` →
  `{outcome:"accepted",receipt} | {outcome:"rejected",report} |
  {outcome:"unknown-subject",subject}` ·
  `getChangeHistory{appId,cursor?,limit?}` → `{page: ChangeHistoryPageViewV1|null}`.
- Response union `DataWorkerResponseV1` + `ResponseForV1<K>`; views
  `UnlockedSessionViewV1`, `LockedSessionViewV1`, `SessionStatusViewV1`,
  `LocalSettingsViewV1`, `ResetInventoryViewV1`, `ImportStageViewV1`,
  `LibraryAppV1`, `ImportCleanupReceiptViewV1`, `AppSessionViewV1`,
  `RecordPageViewV1`, `RecordDetailViewV1`, `ChangeHistoryPageViewV1`, and the
  restated proposal shapes (`ProposedAppWireV1` and friends).
- Error envelope `DataWorkerErrorV1 { kind, retryAfterMs? }` over the closed
  `DATA_WORKER_ERROR_KINDS_V1`.
- Message envelopes + the `isDataWorker*MessageV1` guards.

### Two contracts the type system holds

- **`DATA_WORKER_ERROR_KINDS_V1` is unchanged across all of F02** (CA-12
  deviation, recorded and accepted). Validation failures cross as typed
  **results** carrying the whole `ValidationReport` (D23); absent-stage reads
  answer idempotently; M36 gates every *mutating* stage call on
  `getImportStage` so no caller reaches for a kind that does not exist. The
  union is keyed exhaustively by M37's `REFUSAL_ANNOUNCEMENT`, so extending it
  is a cross-lease change — see FORGE-CONFIG's lease conventions.
- **`CellWireValueV1` (pinned, S05).** `text` · `number{decimal}` (canonical
  decimal **text**, never a float) · `boolean` · `option{optionId}` ·
  `date{epochDay}` · `blank` · `missing` · `invalid{sourceText}` ·
  `reference{recordId}`. The three absent states stay three.
  `AuthoredCellWireValueV1 = Exclude<CellWireValueV1, {kind:"invalid"} |
  {kind:"reference"}>` types every write, so a client **cannot author** a
  preserved-invalid value or a reference (D25). D28: authored text is
  NFC-normalized in the wire→domain mapping, silently (a keyboard artifact, so
  no diagnostic).

The proposal shapes are restated structurally rather than imported, and
`tests/unit/workers/proposal-wire.test.ts` pins them mutually assignable with
M21's `ProposedAppV1`/`ReviewEditV1` at compile time (the `provenance.ts`
idiom). That pin immediately caught a real widening: four closed sets had been
typed `string`.

## Import protocol and the stage channel (F02, S04)

- `import-messages.ts` → `ImportWorkerRequestV1` (`startImport{file, fileName}`
  carrying `port1` in its transfer list, `proceed{stageId}`, `cancelImport`)
  and `ImportWorkerEventV1` (`progress`, `preflight`, `refused`, `completed`,
  `cancelled`, `failed{parse-failed|stage-rejected|malformed-request}`). Byte
  payloads live here, never in `messages.ts`.
- `stage-channel.ts` → `STAGE_CHANNEL_VERSION = 1`, inbound
  `{seq, batch} | {seq, sequence, bytes} | {abort}`, outbound `{ackSeq}`
  ack/nack, and their guards.

**D17 as landed.** The page creates the `MessageChannel`, transfers `port2` in
`beginImportStage`'s request and `port1` in `startImport`'s. **No response ever
carries a port.** The port arrives at `MessageEvent.ports` and
`DataWorkerCommandHandler.handle` gained an optional second parameter for it.

## Client

`client.ts` → `DataWorkerClient` (correlation ids, per-request timeout,
`transfer` list, `terminate()` failing everything in flight, `isRunning`),
`DataWorkerRequestError`, `DEFAULT_REQUEST_TIMEOUT_MS = 60_000`. The worker is
spawned on the first request, never at construction — and a terminated client
never spawns another, which is why a lock is a *termination* for M54 (see
M54's `app-runtime.tsx`).

`redact.ts` → `DataWorkerCommandError(kind, {retryAfterMs?})` and
`redactError(cause)`. No error message ever crosses the boundary; anything
unrecognised becomes `internal`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 F01 (`27ba411`). `updateSettings` is
  new against the seeded contract, added by replan finding F-02 / D13 / AD-7 so
  FR-22's idle timeout has a writer.
- 2026-09-08 — CA-04's UI leg closed by SESSION-07 F01 (`9174b6d`, re-run at
  `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): head request union
  corrected to include `updateSettings`; staple merged.
- 2026-09-08 — F02: import protocol, stage channel and the seven import
  commands by SESSION-04 (`cd74e6d`); the ten app commands and
  `CellWireValueV1` by SESSION-05 (`d47b3d2`); consumed verbatim by M36/M37 and
  the surfaces at `8a665c1`/`5ab3b07`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): both session staples folded;
  the head's "`messages.ts` is the whole wire contract" corrected — the module is
  six files and the byte-carrying half is deliberately a different one; the
  closed-error-kind deviation stated where a future extender will read it.

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**M32 — Protocol (`messages.ts`, additive; still imports nothing, no byte type)**
- `AuthoredCellWireValueV1` now admits `reference` (still excludes `invalid`).
- New requests/responses: `getRelatedRecords`, `getRelatedChildren`, `searchReferenceCandidates`, `getDeletedRecord`, `listTables`, `listSheetSnapshots`, `getSnapshotPage`, `findInSnapshot`, `listInertItems` (shapes in the SESSION-03 handoff). `RecordDetailViewV1.references?`, `ChangeHistoryEntryViewV1.tableId?` (optional on the type only for F02-era fixtures; always sent). No `DATA_WORKER_ERROR_KINDS_V1` change (D42).
