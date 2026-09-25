# M05 — policy (`src/domain/policy/`)

## Status

Planned at `2c35bfb620d060c46b6f3022a2a2e8d22ddc3d51` for F05; no implementation readiness is implied.

## Public API and internal structure

scratchReminderSchedule, backupFreshness (planned S03). Session Files tables own the exact source/test paths. Types and boundaries derive from specs/architecture.md Module Contracts and specs/database.md; migrations remain DB-owned.

## Contract and conventions

Pure domain policy; consumes committed event/frontier and ClockPort-supplied time, never UI or persistence. Persistent scratch badge cannot be dismissed. Removal/account lifecycle extensions remain later scope.

## Dependencies

See PROGRAM-CONFIG runtime [R]/declared [D] edges and F05 IMPORT-EDGES.md. Recheck actual imports after producer checkpoint; projected dependencies are not realized.

## Change History

- 2026-09-24 — Planner seeded from approved author contracts; implementation pending.
