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

## Current F05 component and regression evidence

Focused save tests cover verified fallback delivery, operation lifetime, confirmation rejection, actual MessagePort handlers, encrypted fake-indexeddb receipt reopen and forged completion. The Worker double transfers ports rather than passing references. These are component proofs, not native OS durability.

`backup-app-session.test.ts` covers concurrent real handler reads, duplicate visit writes, cold restart, close/lock during a controlled read and missing-root no-change. Both concurrency regressions failed before `823012b`. Home-state tests pin all-device uncovered counts and reject ahead/absent receipt frontiers. Recovery machine/VM/screen tests cover exact countdown, early-request suppression and stop cleanup.

Policy/workflow/structure/chart/reminder tests reopen and decrypt catalog state using production commands, crypto and SQLite over fake-indexeddb. They assert same-transaction triggering identity, escalation, stale dismissal, no-op/rejected no-write/count/history/reminder, and assignment suppression. M60/M61 own browser storage/transport and actual-worker time proofs. The report independently records 223 files / 2461 passing / 3 inherited skips and typecheck/lint exit 0 at `47a633b`; Archivist inspected evidence, reran no implementation suite.

Source and current proof scope: [F05 boundaries](F05-boundaries.md), production `47a633b`.

## Change History

- 2026-09-24 — S01/S02 unit deltas reconciled at F05 final; combined M56/M57 material split into the correct module documents.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
