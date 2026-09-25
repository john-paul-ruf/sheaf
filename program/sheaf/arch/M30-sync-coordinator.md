# M30 — sync-coordinator (`src/sync/coordinator/`)

## Status

Planned at `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51` for F05; no implementation readiness is implied.

## Public API and internal structure

bundle receipt and cloud push (planned S02/S07). Session Files tables own the exact source/test paths. Types and boundaries derive from specs/architecture.md Module Contracts and specs/database.md; migrations remain DB-owned.

## Contract and conventions

Frozen snapshot → immutable publication → conditional receipt → local encrypted transaction. Divergence refuses overwrite until F06 reconciliation; pulling/merging is not implemented by a success stub.

## Dependencies

See PROGRAM-CONFIG runtime [R]/declared [D] edges and F05 IMPORT-EDGES.md. Recheck actual imports after producer checkpoint; projected dependencies are not realized.

## Change History

- 2026-09-24 — Planner seeded from approved author contracts; implementation pending.
