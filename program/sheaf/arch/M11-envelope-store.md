# M11 — Envelope store (`src/persistence/envelope-store/`)

Extracted from specs/architecture.md §Module Contracts (Envelope store) +
specs/database.md §Main IndexedDB. F01 scope. Reconciled against the tree at
`2c0248a`.

- **Owns:** The only persistent local database connection (`sheaf-local`).
- **Depends on:** Dexie 4, M10 (migrations 001/003 + index; schema is
  DB-phase-owned, read-only), M09 types, M01 (`bytes.ts`, `errors.ts`). No
  crypto internals, no application, no UI. Dexie is imported only by `db.ts`,
  `read.ts` (`Dexie.maxKey`) and `reset.ts` (`Dexie.delete`) — asserted by
  `tests/unit/envelope-store/module-boundaries.test.ts`.
- **Must not:** accept plaintext domain objects; index or store any semantic
  field (cleartext budget = exactly migration-001 fields); persist attempt
  counters (CA-05); `put` an envelope (add-only). Promotion/compaction/
  deletion are pointer swaps (later features).

## F01 public API (landed)

- `db.ts` — `class SheafLocalDatabase extends Dexie` (tables exposed as
  getters, not declared fields, so class-field semantics cannot shadow Dexie's
  installed tables); `openLocalDatabase()`, `closeLocalDatabase()`. One shared
  lazily-opened connection; a closed handle is discarded rather than reused.
- `frame-row.ts` — **CA-02 mapping owner (D12/AD-6)**:
  `frameToRow(frame: EnvelopeFrameV1, revision: number): LocalEnvelopeRowV1`,
  `rowToFrame(row: LocalEnvelopeRowV1): EnvelopeFrameV1`. The only file in the
  module that constructs a row literal. It confirms the identity
  `frame.logicalRevision ≡ row.revision`: `frameToRow` refuses (never
  re-labels) a frame sealed at another revision, `rowToFrame` sets
  `logicalRevision = BigInt(row.revision)`, and the row's clear version columns
  are the decoder gate. The bigint→safe-integer range guard lives here. AAD is
  rebuilt through M09's `buildEnvelopeAad`, never through a local copy.
- `bootstrap.ts` — `createBootstrap(row, addFrames = [])` (add-once; writes the
  row *and* the envelopes it already points at in one transaction, so setup
  cannot leave a catalog pointer resolving to nothing), `readBootstrap()`,
  `updateForPassphraseChange(expected, newKdf, newWrappedRoot) → revision`,
  plus the shared optimistic gate `assertExpectedBootstrap()` and
  `nextRevision()`. `BootstrapExpectation = { expectedRevision,
  expectedWriterEpoch }`.
- `commit.ts` — `commitEnvelopes({ expectedRevision, expectedWriterEpoch,
  addFrames, bootstrapPatch? }) → revision`. One `bootstrap + envelopes`
  transaction; compares before any write; `add`, never `put`. `BootstrapPatch`
  may move only `catalogStorageId` / `migrationStorageId` — it carries no
  revision, because `commitEnvelopes` owns the revision. Frames must be sealed
  at `expectedRevision + 1`. Publishes the new revision after the transaction
  resolves.
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

## Dexie 4 behaviour worth recording

1. `Dexie.dependencies` is read at **construction** time, so
   `fake-indexeddb/auto` must be evaluated before `dexie` in a unit file (each
   store unit test imports it first).
2. Any rejection thrown inside a `db.transaction` callback aborts the whole
   transaction — the colliding-`add` abort was proved in real IndexedDB, not
   only under the shim.
3. Table accessors must be getters under `useDefineForClassFields` (ES2022
   target).
4. The first `getStatus` **materialises an empty `sheaf-local`** in order to
   answer "no bootstrap row". "Database exists" is therefore not the same fact
   as "this device is protected"; every erasure assertion counts rows.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-04, checkpoints 1–3 (`296227f`).
  CA-01 producer verified (atomic collision abort, revision monotonicity,
  stale-expectation rejection, restart re-read decrypt byte-identical,
  cross-page revision notice; `updateForPassphraseChange` touches exactly
  kdf/wrapper/revision). CA-02 consumer/adapter verified at `f4382b3`
  (`frame-row.test.ts`: KAT AAD rebuilt from the stored row alone, byte-exact).
  Cleartext-budget negative proven at `60b7e00`: stored key sets equal
  migration-001's fields exactly, six rejected commits leave rows
  byte-identical, and no persistable counter API exists.
- 2026-09-08 — exercised end-to-end through the real entry by SESSION-07
  (`9174b6d`, re-run at `2c0248a`).
- 2026-09-08 — reconciled by Roshi (final pass): duplicate `## Change History`
  headings collapsed, heading levels normalised, session-delta staple merged.
