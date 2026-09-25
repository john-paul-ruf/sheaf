# M27 — Bundle adapter (`src/sync/providers/bundle/`)

Reconciled at production `47a633b`, F05 continuation.

## Current contract

Bundles are manual and retain no writable file handle. `format.ts` exports `bundleChunks`, emitting migration-006 preamble/header, SHF1 objects in storage-ID order, canonical footer/directory hash and trailer one envelope at a time. `verifyBundle` makes a second pass over Blob slices for bounds/order/IDs/ciphertext hashes and whole-artifact equality with the data worker's publication stream. IO cannot decrypt; authenticated closure belongs to the M33 exporter and M24 publication path.

`reader.ts` exports `openBundle`: verify framing/directory/object hashes, open the vault using its passphrase or recovery code, authenticate index and app manifest, and compare frontier/size identity. The returned worker-only app object carries an opaque key and bounded frame reader, never page RPC key material. Close/abort destroys decoder keys; failed opens dispose their handles. No local root, catalog or device storage is used.

M33 `recoverBackupGraph` reconstructs the supported graph and authored digest from the authenticated retained app head. Future nonempty conflict/audit/unscoped-retained branches still reject pending DB/Author plus S06's writer/reader/proof contract. This decoder does not implement F06 adoption UI.

## Evidence and limits

Full save branch `a93a87c`, mounted journey `7b1bb58`, recovery `7ee5ce8`, hydration correction `823012b`; current composed regression at `47a633b`. The r9 import failure blocked acceptance at that revision, then deterministic concurrency regressions and the real import/artifact gate closed it at r10. Current J1 and vault-only artifact recovery are accepted. Native destination is doubled; actual OS durability is unqualified. See [F05 boundaries](F05-boundaries.md) and [registry](MODULE-REGISTRY.md); runtime dependencies are M01/M08/M09/M10/M24, derived mechanically.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Initial final reconciliation recorded native component subset at `d75830d`.
- 2026-09-25 — Continuation final folded reader/recovery and r10 acceptance into the current contract; preserved future nonempty obligations.
