# M62 — provider-contract (`tests/provider-contract/`)

## Status

Planned at `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51` for F05; no implementation readiness is implied.

## Public API and internal structure

shared HTTP doubles and opt-in live probes. Session Files tables own the exact source/test paths. Types and boundaries derive from specs/architecture.md Module Contracts and specs/database.md; migrations remain DB-owned.

## Contract and conventions

Doubles are external-only and stateful. Unit wrappers ensure discovery before live project exists. Live accounts/credentials never committed.

## Dependencies

See PROGRAM-CONFIG runtime [R]/declared [D] edges and F05 IMPORT-EDGES.md. Recheck actual imports after producer checkpoint; projected dependencies are not realized.

## Change History

- 2026-09-24 — Planner seeded from approved author contracts; implementation pending.

<!-- durable-home-backup SESSION-01 -->
## M62 — provider contract fixtures

`tests/provider-contract/shared/double.ts#DurableHomeDouble` is stateful per
account/location instance, copy-isolates bytes, accepts only identical retries of
immutable objects, atomically rejects stale/create-if-absent CAS, and observes
abort before mutation. Its self-tests are discovered under
`tests/unit/sync/protocol/provider-double.test.ts`. No external provider request,
credentials, platform-save completion or live qualification is claimed.

