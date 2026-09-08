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
