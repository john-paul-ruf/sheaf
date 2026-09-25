# M27 — bundle (`src/sync/providers/bundle/`)

## Current contract

Landed native bundle component at S02 partial CP3 `d75830d`; full CP3 and J1 remain incomplete. Bundles remain manual: no automatic write or retained writable handle is introduced.

bundleChunks emits migration-006 preamble/header, SHF1 objects in storage-ID order, canonical footer/directory hash and trailer, with one envelope at a time. verifyBundle performs a second pass over Blob slices: bounds/order/IDs/ciphertext hashes plus whole-artifact equality to the data worker's authenticated publication stream. Graph authentication/reachability belongs to the existing CP2 exporter/publication producer; IO cannot decrypt. Runtime dependencies: M01, M08 hash only, M09, migrations.

## Evidence and limits

Implementation: S01 `694c741` / `13e83f1` / `8674766`, S02 `c7e6507` / `d75830d`, as applicable to the paths above. See [F05 boundaries](F05-boundaries.md) for CA ownership and proof limits, and [current registry](MODULE-REGISTRY.md) for mechanically derived runtime edges.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Final reconciliation replaced that planned status with the landed subset and folded received implementation deltas. No full F05 capability is claimed.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M27 / M33 — vault-only artifact recovery

`openBundle` verifies framing/directory/object hashes, authenticates the vault index and app manifest with the vault passphrase or recovery code, checks index/manifest frontier and size agreement, and owns decoder-key disposal. Its worker-only app object exposes an opaque app key and bounded frame reader, never a page RPC key. `recoverBackupGraph` reconstructs the complete current-producer graph from the authenticated retained app head, compares manifest roots/frontier and padded size, and verifies the independently reconstructed canonical authored-state digest. It reads no local root/catalog/storage. Nonempty future conflict/audit/unscoped-retained branches remain fail-closed pending S06's owner proofs; this is not F06 adoption UI.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.
