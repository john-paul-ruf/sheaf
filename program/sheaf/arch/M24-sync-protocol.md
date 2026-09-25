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
wrong app/predecessor, and mismatched final frontier.

`publication.ts#buildPublicationCandidate` takes supplied authenticated graph,
production crypto/vault ports and entropy. It re-authenticates every supplied
object/edge, verifies supplied graph closure and checkpoint app/frontier, confirms
chain evidence, and hashes canonical authored-state bytes separately from local
head and ciphertext hashes. M33 now supplies payload-specific descendant extraction and independent
semantic reconstruction for current producers. Nonempty local retained/conflict/
audit branches reject pending GRAPH-CONTRACT/S06; M24 does not infer their layouts.

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

Implementation: S01 `694c741` / `13e83f1` / `8674766`, S02 `c7e6507` / `d75830d`, as applicable to the paths above. See [F05 boundaries](F05-boundaries.md) for CA ownership and proof limits, and [current registry](MODULE-REGISTRY.md) for mechanically derived runtime edges.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Final reconciliation replaced that planned status with the landed subset and folded received implementation deltas. No full F05 capability is claimed.
