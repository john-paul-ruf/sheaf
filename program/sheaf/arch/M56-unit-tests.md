# M56 — Unit tests (`tests/unit/`)

## F05 proof surface

S01 tests under `crypto/vault.test.ts`, `codecs/vault.test.ts` and
`sync/protocol/` cover independent local/vault derivation, wrong secrets,
KDF/app/vault/scope tampering, destroyed handles, unchanged scratch ciphertext,
canonical graph round trips, malformed framing, frontier continuity,
missing/extra graph objects, and predecessor/receipt rejection. Scope/kind
substitution uses real envelope authentication. M07/M08/M09/M24 boundary
checks include forbidden-import/network negative controls. The property test
belongs to [M57](M57-property-tests.md), not this module.

S02's current graph gate includes `workers/backup-graph.test.ts`,
`workers/backup-handlers.test.ts`, `workers/projection-port.test.ts`,
`projection/authored-state.test.ts`, `staging/append.test.ts`, hash/CBOR and
publication/frontier tests. It covers pinned edits/CSV append, authenticated
covered-chain evidence, complete current graph branches, unsupported nonempty
root rejection, bounded readers, authored provenance/restoration/baselines,
and cursor/key teardown. Root independently recorded 25 files / 209 passing
at `c7e6507`; these are component assertions, not J1.

Native component selection at `d75830d`: 19 files / 106 passing reported by
the worker, included in root's full suite. Sources include
`workers/backup-handlers.test.ts`, `workers/io.test.ts`,
`sync/bundle/format.test.ts`, `bootstrap/file-save.test.ts`, and bootstrap tests.
Real MessageChannels connect production data/IO/client handlers, crypto,
SQLite and fake-indexeddb. Worker constructors and save destination are doubles.
Assertions cover malformed/refused/stalled transport, disposal, footer/offset/
hash checks, quota, cancellation, forged/old identities, lock and restart.
No actual OS save or native-browser persistence is established.

## Recorded verification

F05 Final Report at receive `95a539d`: root `pnpm verify` against `d75830d`
passed typecheck/lint/build and 214 files / 2402 tests, with 3 inherited skips.
Ignored evidence: `test-results/f05/s02/graph-current/evidence.json` and
`test-results/f05/s02/native-save/evidence.json`. Archivist inspected source
and recorded results, and did not rerun tests. Existing non-F05 unit coverage
remains in its module contracts; aggregate counts do not close F05 capabilities.

## Change History

- 2026-09-24 — S01/S02 unit deltas reconciled at F05 final; combined M56/M57 material split into the correct module documents.


<!-- durable-home-backup SESSION-02 CP3 a93a87c -->
## M56 / M60 — CP3 evidence
Focused component tests cover download handoff, operation lifetime, confirmation rejection, real MessagePort data/IO handlers, encrypted fake-indexeddb receipt reopen and existing forged-completion negative controls. The Worker double now transfers ports instead of passing them by reference. save-dialog fixtures build an isolated component page; they do not prove real-entry reachability, OS durability, or J1.
