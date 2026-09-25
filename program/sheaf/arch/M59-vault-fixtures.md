# M59 — vault-fixtures (`tests/fixtures/vaults/`)

## Status

Planned at `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51` for F05; no implementation readiness is implied.

## Public API and internal structure

versioned generated vault KATs. Session Files tables own the exact source/test paths. Types and boundaries derive from specs/architecture.md Module Contracts and specs/database.md; migrations remain DB-owned.

## Contract and conventions

F05 fixtures isolated in f05; production generator self-tests compare actual byte output. F01 local-v1 fixture remains authoritative.

## Dependencies

See PROGRAM-CONFIG runtime [R]/declared [D] edges and F05 IMPORT-EDGES.md. Recheck actual imports after producer checkpoint; projected dependencies are not realized.

## Change History

- 2026-09-24 — Planner seeded from approved author contracts; implementation pending.

<!-- durable-home-backup SESSION-01 -->
## M59 — vault fixtures

`tests/fixtures/vaults/f05/{head.cbor,checkpoint.shf,manifest.shf,index.shf}` are
byte-exact deterministic producer known answers. `generate.ts` writes only those
four names in its own directory. Tests regenerate in memory, detect a deliberately
corrupted answer, and open the graph from the fixture vault passphrase/recovery
via real crypto and existing checkpoint codecs. This is an empty-app fixture;
full application reconstruction/storage/restart remains S02/S06 proof.


