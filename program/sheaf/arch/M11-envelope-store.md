# M11 — Envelope store (`src/persistence/envelope-store/`)

Extracted from specs/architecture.md §Module Contracts (Envelope store) +
specs/database.md §Main IndexedDB. F01 scope.

- **Owns:** The only persistent local database connection (`sheaf-local`).
- **F01 exports:** db open/close/delete; `createBootstrap`/`readBootstrap`/
  `updateForPassphraseChange`; `commitEnvelopes` (optimistic:
  expectedRevision + expectedWriterEpoch, add-only frames, bootstrap patch,
  one transaction); `getEnvelope`/`getEnvelopesByRevision`;
  `purgeLocalStore`; `subscribeRevision` (BroadcastChannel);
  `estimateUsage`.
- **Depends on:** Dexie 4, codecs types, migration runner
  (`registerLocalStoreV1` — schema is DB-phase-owned, read-only).
- **Must not:** accept plaintext domain objects; index or store any semantic
  field (cleartext budget = exactly migration-001 fields); persist attempt
  counters (CA-05); `put` an envelope (add-only). Promotion/compaction/
  deletion are pointer swaps (later features).
- **Contract proofs:** CA-01 browser tests (atomicity, add-once, field
  discipline) in `tests/browser/envelope-store/`.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-04.

<!-- foundation-first-unlock SESSION-04 -->
- 2026-09-08 — SESSION-04 landed (final revision `296227f`). Delta:

## M11 — Envelope store (`src/persistence/envelope-store/`) — landed F01/SESSION-04

**Public API (F01):**

- `db.ts` — `class SheafLocalDatabase extends Dexie` (tables exposed as
  getters, not declared fields, so class-field semantics cannot shadow Dexie's
  installed tables); `openLocalDatabase()`, `closeLocalDatabase()`. One shared
  lazily-opened connection; a closed handle is discarded rather than reused.
- `frame-row.ts` — **CA-02 mapping owner (D12/AD-6)**:
  `frameToRow(frame: EnvelopeFrameV1, revision: number): LocalEnvelopeRowV1`,
  `rowToFrame(row: LocalEnvelopeRowV1): EnvelopeFrameV1`. The only file in the
  module that constructs a row literal. Confirmed identity
  `frame.logicalRevision ≡ row.revision`: `frameToRow` refuses (never
  re-labels) a frame sealed at another revision, `rowToFrame` sets
  `logicalRevision = BigInt(row.revision)`, and the row's clear version columns
  are the decoder gate. The bigint→safe-integer range guard lives here.
- `bootstrap.ts` — `createBootstrap(row, addFrames = [])` (add-once; writes the
  row *and* the envelopes it already points at in one transaction, so setup
  cannot leave a catalog pointer resolving to nothing), `readBootstrap()`,
  `updateForPassphraseChange(expected, newKdf, newWrappedRoot) → revision`,
  plus the shared optimistic gate `assertExpectedBootstrap()` and
  `nextRevision()`. `BootstrapExpectation = { expectedRevision,
  expectedWriterEpoch }`.
- `commit.ts` — `commitEnvelopes({ expectedRevision, expectedWriterEpoch,
  addFrames, bootstrapPatch? }) → revision`. One `bootstrap + envelopes`
  transaction; compares before any write; `add`, never `put`;
  `BootstrapPatch` may move only `catalogStorageId` / `migrationStorageId`.
  Frames must be sealed at `expectedRevision + 1`. Publishes the new revision
  after the transaction resolves.
- `read.ts` — `getEnvelope(storageId)`, `getEnvelopesByRevision(revision,
  cursor?) → { frames, nextCursor }` over `[revision+storageId]`,
  `REVISION_PAGE_SIZE = 256`.
- `reset.ts` — `purgeLocalStore()`: deletes by name without opening, so a
  locked reset never runs migration work on a store it is about to destroy.
- `revision-signal.ts` — `subscribeRevision(cb) → unsubscribe`,
  `publishRevision(revision)`, `REVISION_CHANNEL_NAME`.
- `quota.ts` — `estimateUsage() → { kind: "estimated", usageBytes, quotaBytes }
  | { kind: "unknown" }`; never fabricates a number.
- `errors.ts` — `LocalStoreError` base with `RevisionConflictError`,
  `BootstrapExistsError`, `EnvelopeExistsError`. Dexie's `ConstraintError` is
  translated here so no provider type leaves the adapter.

**Dependency edges:** M11 → Dexie 4, M10 (migrations 001/003 + index), M09
types, M01 (`bytes.ts`, `errors.ts`). No crypto internals, no application, no
UI. Dexie is imported only by `db.ts`, `read.ts` (`Dexie.maxKey`), and
`reset.ts` (`Dexie.delete`) — asserted by
`tests/unit/envelope-store/module-boundaries.test.ts`.

## Change History
- 2026-09-08 — implemented (SESSION-04, checkpoints 1–3). Dexie 4 behavior
  worth recording: (a) `Dexie.dependencies` is read at **construction** time,
  so `fake-indexeddb/auto` must be evaluated before `dexie` in a unit file
  (each store unit test imports it first); (b) any rejection thrown inside a
  `db.transaction` callback aborts the whole transaction — the colliding-`add`
  abort was proved in real IndexedDB, not only under the shim; (c) table
  accessors must be getters under `useDefineForClassFields` (ES2022 target).
