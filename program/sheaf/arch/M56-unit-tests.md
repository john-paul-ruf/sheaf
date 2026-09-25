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


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M56 / M60 / M61 — proof surfaces

`bundle-backup.spec.ts` uses the real built index, data/IO workers, MessagePorts and IndexedDB, captures actual fallback downloads, and separately doubles only the native destination. It proves edits between capture/confirmation remain pending, same-context page replacement preserves records/receipts, reset remedy refreshes durable facts, and scoped code rejection. The production decoder fixture verifies complete saved authored state in a fresh context. `sync/bundle.spec.ts` exercises complete graph recovery, malformed-output rejection, interrupted pending confirmation, reopen and retry while preserving prior bytes. `recovery-countdown.spec.ts` obtains an actual wrong code from another isolated device context and observes the real worker delay/replacement gate. Evidence records source/config/fixture/build-output hashes and served endpoints. Native OS save/share remains outside the destination double's claim.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.


<!-- durable-home-backup SESSION-02 r10 -->
## M56 / M60 — regression evidence

`tests/unit/workers/backup-app-session.test.ts` exercises concurrent real
handler reads, duplicate visit writes, cold restart, close/lock during a
controlled storage read, and missing-root rejection without durable change.
The concurrent-open and visit cases both failed before correction.
`tests/browser/sync/bundle.spec.ts` retains the complete vault-only graph,
malformed-output, interruption and restart assertions, and now checks import
console/page errors, served build identity and the saved artifact hash.

Independent receive at 823012b: typecheck/lint exit 0; 220 unit files, 2438 passed / 3 inherited skips; exact combined fresh-build browser gate 4 passed, exit 0. Prior r9 import counterexample closed by deterministic negative regressions and real import/artifact proof. Future S06 nonempty graphs and S07 provider/egress proofs remain separate.
