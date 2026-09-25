# M24 — sync-protocol (`src/sync/protocol/`)

## Status

Planned at `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51` for F05; no implementation readiness is implied.

## Public API and internal structure

vault codec/graph/publication contracts (planned S01). Session Files tables own the exact source/test paths. Types and boundaries derive from specs/architecture.md Module Contracts and specs/database.md; migrations remain DB-owned.

## Contract and conventions

Canonical migration-006 graph and conditional head. Distinguish ciphertext hashes, local reference hashes and semantic authored-state hashes. Never infer receipt from queued bytes.

## Dependencies

See PROGRAM-CONFIG runtime [R]/declared [D] edges and F05 IMPORT-EDGES.md. Recheck actual imports after producer checkpoint; projected dependencies are not realized.

## Change History

- 2026-09-24 — Planner seeded from approved author contracts; implementation pending.

<!-- durable-home-backup SESSION-01 -->
## M24 — sync protocol

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
head and ciphertext hashes. S02 still owns payload-specific descendant extraction
and independent semantic reconstruction; these are not inferred by M24.

Replace candidates authenticate the prior index against exact head bytes,
preserve other app entries, deletion markers, device receipts and the current
index's retention roots, increment once, and bind previous head/index/manifest
hashes and opaque provider revision. No historical retention list is promoted.
Permanent marker resurrection and frontier regression fail closed.
Candidate bytes live in a private WeakMap; `readPublicationCandidate` returns
copies. `publishCandidate` rechecks predecessor bytes/revision, uploads immutable
objects first, then performs exact head CAS, validates its receipt and reads back matching
head bytes/revision. A concurrent newer publication during that read fails
confirmation conservatively; no retry or reconciliation is invented. It performs
no local persistence, provider SDK call, reconciliation or UI readiness update.
Provider adapters remain the authority for actual successful external CAS.


