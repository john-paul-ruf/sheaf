# M27 — bundle (`src/sync/providers/bundle/`)

## Status

Planned at `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51` for F05; no implementation readiness is implied.

## Public API and internal structure

bundle assembly/verification (planned S02). Session Files tables own the exact source/test paths. Types and boundaries derive from specs/architecture.md Module Contracts and specs/database.md; migrations remain DB-owned.

## Contract and conventions

Migration-006 framing; second-pass validation; manual saved outcome; no retained writable handle or automatic bundle write.

## Dependencies

See PROGRAM-CONFIG runtime [R]/declared [D] edges and F05 IMPORT-EDGES.md. Recheck actual imports after producer checkpoint; projected dependencies are not realized.

## Change History

- 2026-09-24 — Planner seeded from approved author contracts; implementation pending.


<!-- durable-home-backup SESSION-02 partial CP3 d75830d -->
## M27 — bundle adapter
bundleChunks emits migration-006 preamble/header, SHF1 objects in storage-ID order, canonical footer/directory hash and trailer, with one envelope at a time. verifyBundle performs a second pass over Blob slices: bounds/order/IDs/ciphertext hashes plus whole-artifact equality to the data worker's authenticated publication stream. Graph authentication/reachability belongs to the existing CP2 exporter/publication producer; IO cannot decrypt. Runtime dependencies: M01, M08 hash only, M09, migrations.
