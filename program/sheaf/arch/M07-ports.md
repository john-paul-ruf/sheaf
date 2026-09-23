# M07 — Application ports (`src/application/ports/`)

Extracted from specs/architecture.md §Module Contracts (Application ports).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

- **Owns:** Dependency-inversion contracts.
- **Exports (full target):** LocalEventRepository, ProjectionEngine,
  CryptoPort, DurableHomePort, FilePort, ClockPort, EntropyPort,
  CapacityProbe, LifecyclePort.
- **Depends on:** domain types only (plus durable format types from
  `src/migrations/` per Custom Rule 6).
- **Must not:** contain a browser, database, provider, or UI implementation.
  `tests/unit/staging/module-boundaries.test.ts` pins that
  `src/application/ports/**` imports only `domain/` and `migrations/`.
- **Standing rule:** no speculative interfaces — a port lands with its first
  named consumer.

## Landed ports

| File | Port | First consumer |
|---|---|---|
| `clock.ts` | `ClockPort { nowEpochMs(): number }` | F01 session lifetime |
| `entropy.ts` | `EntropyPort { randomBytes(byteLength): Uint8Array }` | F01 key generation |
| `envelope-store.ts` | `EnvelopeStorePort` | M23 staging (F02) |
| `envelope-crypto.ts` | `EnvelopeCryptoPort` | M23 staging (F02) |
| `staging-catalog.ts` | `StagingCatalogPort` | M23 cancellation (F02) |
| `projection.ts` | `ProjectionEnginePort` | M34/M35 (F02, extended F03) |
| `event-repository.ts` | `LocalEventRepository` | M34 commands (F02) |

### `envelope-store.ts` (F02, S04)

`EnvelopeStorePort` with `readBootstrap()`, `getEnvelope(storageId)`,
`commit(request)`, `listByRevision(revision, afterStorageId?)`; plus
`BootstrapSnapshotV1`, `CatalogPointerPatchV1`, `StoreCommitRequestV1`,
`RevisionPageV1`. `StoreCommitRequestV1` names `deleteStorageIds` because
cancellation's step 1 must delete the workflow key-wrap in the same transaction
that replaces the catalog and adds the cleanup ticket (database.md § Import
staging). The matching M11 delete path landed at `978f4ff` — the port is fully
implemented.

### `envelope-crypto.ts` (F02, S04)

`EnvelopeCryptoPort` with `seal`, `open`, `importKey`, `destroyKey`, `sha256`;
plus `EnvelopeKeyRefV1`, `SealEnvelopeRequestV1`, `OpenedEnvelopeV1`.
`EnvelopeKeyRefV1` is declared **structurally** (`{ purpose: string }`) so M08's
`SecretKeyHandle` satisfies it with no adapter and the port cannot widen back
into bytes — the `DomainEntropy` idiom from M01.

### `staging-catalog.ts` (F02, S04)

`StagingCatalogPort` (`readRefs`, `expectation`, `sealWithRefs`, `adopt`) plus
`StagingCatalogRefsV1` and `SealedCatalogV1`. It exposes only the two reference
lists a staging transaction may move, so the four-step cancellation order can
live in M23 (where database.md puts it) while the catalog's shape and its seven
checks stay in M33 (where CA-03 puts them).

### `projection.ts` (F02, S05; extended F03 S03)

`ProjectionEnginePort` — `execute` (**synchronous**, closed query union) and
`applyEvents`. It **restates M12's session vocabulary structurally** because
M34/M35 may not import `src/persistence/`; `tests/unit/workers/
projection-port.test.ts` pins every shape mutually assignable in both
directions (with a firing negative control), now over M12's full 21-kind F03
query surface. `ProjectionChangeSummaryV1.tableId: TableId | null` (F03).

### `event-repository.ts` (F02, S05)

`LocalEventRepository` — `chainState()` and `append(request)`. A command hands
over a `CommitPlanV1` carrying **typed** events; the implementation derives the
wire payload from the typed event, so the payload↔typed agreement S02's guards
check is held by construction. `AppChainStateV1` carries `lastHybridTime` so a
backwards clock cannot make a new commit sort before its own predecessor.
`CommitReceiptV1.commit` is the sealed commit, so the caller replays the bytes
that were written.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 subset (`ClockPort`, `EntropyPort`) implemented by
  SESSION-02 (`acca5a8`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): session-delta staple merged.
- 2026-09-08 — F02: store/crypto/staging-catalog ports by SESSION-04
  (`cd74e6d`); projection + event-repository ports by SESSION-05 (`d47b3d2`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): two session staples folded;
  the F01 "repository/projection ports arrive with their first composer" note is
  superseded by the landed table; the `envelope-store` "M11 has no delete today"
  seam is closed and recorded as closed (`978f4ff`).
- 2026-09-23 — F03: `projection.ts` restated over M12's 21-kind query surface,
  `ProjectionChangeSummaryV1.tableId` added, by SESSION-03 (`f29ac33`..`a2c4cf0`).
  `envelope-store.ts`/`event-repository.ts` and `src/bootstrap/import-worker.ts`
  untouched by SESSION-06.
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-03 and
  SESSION-06 staples folded into the `projection.ts` row and its own section.
