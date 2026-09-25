# M07 — Application ports (`src/application/ports/`)

Extracted from specs/architecture.md §Module Contracts (Application ports).
Reconciled against production `47a633b` (F05 continuation).

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
| `projection.ts` | `ProjectionEnginePort` | M34/M35 (F02, extended F03, F04) |
| `event-repository.ts` | `LocalEventRepository` | M34 commands (F02, extended F04) |
| `backup.ts` | `BackupAppGraphV1`, snapshot identity | M24 publication / M33 exporter (F05) |
| `durable-home.ts` | `DurableHomePort` | M24 publication (F05; live adapters pending) |
| `vault-crypto.ts` | `VaultCryptoPort` | M24 publication / M33 home state (F05) |
| `file-save.ts` | `FileSavePort` | M53 native/fallback save (F05) |

### `envelope-store.ts` (F02, S04)

`EnvelopeStorePort` with `readBootstrap()`, `getEnvelope(storageId)`,
`commit(request)`, `listByRevision(revision, afterStorageId?)`; plus
`BootstrapSnapshotV1`, `CatalogPointerPatchV1`, `StoreCommitRequestV1`,
`RevisionPageV1`. `StoreCommitRequestV1` names `deleteStorageIds` because
cancellation's step 1 must delete the workflow key-wrap in the same transaction
that replaces the catalog and adds the cleanup ticket (database.md § Import
staging). The matching M11 delete path landed at `978f4ff` — the port is fully
implemented. Untouched by F03/F04.

### `envelope-crypto.ts` (F02, S04)

`EnvelopeCryptoPort` with `seal`, `open`, `importKey`, `destroyKey`, `sha256`;
plus `EnvelopeKeyRefV1`, `SealEnvelopeRequestV1`, `OpenedEnvelopeV1`.
`EnvelopeKeyRefV1` is declared **structurally** (`{ purpose: string }`) so M08's
`SecretKeyHandle` satisfies it with no adapter and the port cannot widen back
into bytes — the `DomainEntropy` idiom from M01. Untouched by F03/F04.

### `staging-catalog.ts` (F02, S04)

`StagingCatalogPort` (`readRefs`, `expectation`, `sealWithRefs`, `adopt`) plus
`StagingCatalogRefsV1` and `SealedCatalogV1`. It exposes only the two reference
lists a staging transaction may move, so the four-step cancellation order can
live in M23 (where database.md puts it) while the catalog's shape and its seven
checks stay in M33 (where CA-03 puts them). Untouched by F03/F04.

### `projection.ts` (F02, S05; extended F03 S03; extended F04 S03/S04/S05)

`ProjectionEnginePort` — `execute` (**synchronous**, closed query union) and
`applyEvents`. It **restates M12's session vocabulary structurally** because
M34/M35 may not import `src/persistence/`; `tests/unit/workers/
projection-port.test.ts` pins every shape mutually assignable in both
directions (with a firing negative control), now over M12's full **26-kind**
F04 query surface (21 at F03 close, +1 `query-records` at S04, +2
`list-charts`/`chart-dataset` at S05 — see the individual F04 additions below).
`ProjectionChangeSummaryV1.tableId: TableId | null` (F03).

**F04 additions (SESSION-03):** `ProjectionFormulaV1`;
`ProjectionCheckpointV1.formulas`; `ProjectionValidationRuleV1.rule:
RecordRuleIRV1`; `ProjectionCommitV1.events: DomainEventV1[]` + optional
`revalidate(record) → issues` (the shared validator the projection asks for a
re-shaped table, invariant 5); `ProjectionComputedCellV1` (CA-26's eight
states, value only where one exists) on `ProjectionRecordSummaryV1.computed`;
`ProjectionScalarResultV1`; `ProjectionApplyReceiptV1 {recalculatedFieldIds}`;
queries `list-formulas {tableId|null}`, `scalar-results`;
`ProjectionEnginePort.applyEvents` resolves with the receipt; new
`refreshVolatile(maxAgeMs)`.

**F04 additions (SESSION-04):** the `query-records` kind and its result
structurally restated, mutual assignability pinned in
`tests/unit/workers/projection-port.test.ts`.

**F04 additions (SESSION-05):** `ProjectionChartV1 = ChartStateV1`;
`ProjectionCheckpointV1.charts?` (absent = none). Query kinds `list-charts` →
`ProjectionChartV1[]` (display order) and `chart-dataset {tableId, filters:
ProjectionFilterTermV1[], shape: ProjectionChartShapeV1, sourceRowBudget}` →
`ProjectionChartDatasetV1 | null`; shapes `ProjectionChartKeyV1` (`empty |
value{value,label,parents} | empty-parent{parents} | unreadable`),
`ProjectionChartGroupV1` (`records, measured, sum, min, max` as canonical
decimals), `ProjectionChartPointV1`. Mirrored in M12 `types.ts`.

### `event-repository.ts` (F02, S05; extended F04 S03)

`LocalEventRepository` — `chainState()` and `append(request)`. A command hands
over a `CommitPlanV1` carrying **typed** events; the implementation derives the
wire payload from the typed event, so the payload↔typed agreement S02's guards
check is held by construction. `AppChainStateV1` carries `lastHybridTime` so a
backwards clock cannot make a new commit sort before its own predecessor.
`CommitReceiptV1.commit` is the sealed commit, so the caller replays the bytes
that were written.

**F04 additions (SESSION-03):** `DomainEventV1` (the concrete instantiated
union — see `M01-domain-model.md`'s "Type-held rule"), `RecordRuleIRV1`,
`SchemaImpactCountsV1`, `SchemaEventPayloadsV1`, `SchemaEventV1`;
`PlannedEventV1.event: DomainEventV1`.

## Durable-home implementation (F05, current)

`backup.ts` exposes worker-owned `BackupAppGraphV1`: authenticated reference/kind/descendant metadata, bounded `readObject(storageId, signal)`, streamed `canonicalAuthoredState(signal)` and an owned abort lifetime. `checkpointChains`/`deviceChains` carry authenticated per-device sequence/hash evidence. `BackupSnapshotIdentityV1` binds app/home/vault, generation, candidate digest, frontier and retained roots; it is not a save receipt. `ProjectionAuthoredStatePort` remains structurally checked against M12 in both directions.

`DurableHomePort.readHead/readObject/createObject/compareAndSwapHead` binds a constructed adapter to one authenticated account/location. Immutable objects and exact-byte digest/revision receipts distinguish create-if-absent from replacement. Live provider adapters remain S04/S05 outputs. `VaultCryptoPort` creates, opens, wraps and destroys opaque handles without a raw-key return.

`FileSavePort.save(Promise<Blob>, AbortSignal)` retains terminal `saved | cancelled | failed | unconfirmed`. `BundleSaveInteractionV1` supplies invocation-local signal, delivery notification and asynchronous explicit confirmation to `AppRuntime.saveBundle`; it does not add a durable lifecycle variant. M51 supplies verified download delivery as unconfirmed, M53 binds explicit confirmation to the live operation, and M33 alone records its captured frontier/time. Mounted readers and J1 are accepted, not future port outputs.

Source: production `47a633b`, current STATE/Final Report; [F05 boundaries](F05-boundaries.md) records proof limits and owners.

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
- 2026-09-23 — F04: `event-repository.ts`'s F04 event-type instantiation and
  `projection.ts`'s formulas/recalculation surface by SESSION-03
  (`a69e6e0`..`2235cce`); `query-records` restated by SESSION-04
  (`f736fa8`..`27a2667`); the chart query surface by SESSION-05
  (`6ee204c`..`3dd1d2d`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): three SESSION deltas
  folded into the `projection.ts`/`event-repository.ts` sections and the query
  surface's kind count corrected to 26 (21 F03 + query-records + list-charts +
  chart-dataset), stated once rather than left as three separate running
  counts.
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
