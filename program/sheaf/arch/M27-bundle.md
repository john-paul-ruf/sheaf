# M27 — bundle (`src/sync/providers/bundle/`)

## Current contract

Landed native bundle component at S02 partial CP3 `d75830d`; full CP3 and J1 remain incomplete. Bundles remain manual: no automatic write or retained writable handle is introduced.

bundleChunks emits migration-006 preamble/header, SHF1 objects in storage-ID order, canonical footer/directory hash and trailer, with one envelope at a time. verifyBundle performs a second pass over Blob slices: bounds/order/IDs/ciphertext hashes plus whole-artifact equality to the data worker's authenticated publication stream. Graph authentication/reachability belongs to the existing CP2 exporter/publication producer; IO cannot decrypt. Runtime dependencies: M01, M08 hash only, M09, migrations.

## Evidence and limits

Implementation: S01 `694c741` / `13e83f1` / `8674766`, S02 `c7e6507` / `d75830d`, as applicable to the paths above. See [F05 boundaries](F05-boundaries.md) for CA ownership and proof limits, and [current registry](MODULE-REGISTRY.md) for mechanically derived runtime edges.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Final reconciliation replaced that planned status with the landed subset and folded received implementation deltas. No full F05 capability is claimed.
