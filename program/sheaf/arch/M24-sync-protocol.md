# M24 — sync-protocol (`src/sync/protocol/`)

## Current contract

Landed S01; bounded readers supersede the initial eager API at S02 CP2 `c7e6507`.

`references.ts#referenceFromLocal` authenticates real SHF1 using parent/bootstrap
scope + expected kind, verifies the local plaintext semantic hash, and derives
remote ciphertextSha256 from frame.ciphertext. Frame revision/padding are retained;
no current transaction revision or inferred frame scope is used.
`authenticateReference` checks all reference/frame fields and hash before the real
crypto-port open. PC-F05-03 corrected mapping is preserved.

`frontier.ts#verifyBackupFrontier` verifies per-device tail hashes/sequences against
supplied authenticated checkpoint evidence, rejects gaps/overlap/duplicate commits,
wrong app/predecessor, and mismatched final frontier. **S06 compaction (current):**
the same function now also enforces **basis-frontier coverage** — every original
commit a compaction candidate's evidence pages claim must be covered by the
supplied basis frontier, closing the "supplied anchor alone is not proof" gap the
accepted graph contract (`afe37f3`) named. Genesis (`previousDeviceCommitSha256`
null exactly at sequence one) and terminal/final-frontier guards are unchanged by
this addition — basis coverage is an extra check, not a replacement.

`publication.ts#buildPublicationCandidate` takes supplied authenticated graph,
production crypto/vault ports and entropy. It re-authenticates every supplied
object/edge, verifies supplied graph closure and checkpoint app/frontier, confirms
chain evidence, and hashes canonical authored-state bytes separately from local
head and ciphertext hashes. M33 now supplies payload-specific descendant extraction and independent
semantic reconstruction for current producers, including the **nonempty V2**
retained/conflict/audit branches landed by S06 (M33's `backup-graph.ts` traversal;
this module authenticates what it is handed, it does not derive the V2 layout).
Container framing stays migration-006-compatible: `minimumReaderVersion` remains
`1` — S06 added no new reader-version gate because V1 bytes are unchanged and V2
is additive.

Replace candidates authenticate the prior index against exact head bytes,
preserve other app entries, deletion markers, device receipts and the current
index's retention roots, increment once, and bind previous head/index/manifest
hashes and opaque provider revision. No historical retention list is promoted.
Permanent marker resurrection and frontier regression fail closed.
Candidate metadata and bounded reader live in a private WeakMap;
`readPublicationCandidate` returns metadata copies (object IDs, not byte arrays). `publishCandidate` rechecks predecessor bytes/revision, uploads immutable
objects first, then performs exact head CAS, validates its receipt and reads back matching
head bytes/revision. A concurrent newer publication during that read fails
confirmation conservatively; no retry or reconciliation is invented. It performs
no local persistence, provider SDK call, reconciliation or UI readiness update.
Provider adapters remain the authority for actual successful external CAS.

Publication candidates retain authenticated references and byte hashes, reread one object at a time, and reject changed bytes or ended graph lifetimes. readPublicationObject replaces object-byte arrays. Frontier verification consumes ordered segments incrementally. Existing encrypted fixture bytes are unchanged.

## Evidence and limits

Implementation: S01 `694c741` / `13e83f1` / `8674766`, S02 `c7e6507` / `d75830d`, S06 `084ecf9` (+ correction `7e785e4`) through `2d8ff2d` (basis-frontier coverage, above), as applicable to the paths above. See [F05 boundaries](F05-boundaries.md) for CA ownership and proof limits, and [current registry](MODULE-REGISTRY.md) for mechanically derived runtime edges.

Independent receive at `2d8ff2d`: typecheck/lint exit 0; full unit 229 files/2520 pass/3 inherited skips; CP1+installed gate 39 files/473 pass; browser J3 2/2, sync/compaction+bundle 3/3, J1/append/status/records/gate-f02/import-journey 18/18 (port 8081, fresh build). No new module dependency edge: `frontier.ts`'s basis-coverage check reuses the same commit/frontier types this module already imports from M09.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Final reconciliation replaced that planned status with the landed subset and folded received implementation deltas. No full F05 capability is claimed.
- 2026-09-25 — S06 compaction (CAP-44/CA-35): `verifyBackupFrontier` gained
  basis-frontier coverage over supplied V2 evidence (`084ecf9`, counterexample
  closed `7e785e4`, through `2d8ff2d`), independently verified. Reconciled
  here rather than left as a stapled delta (Principle 2).
