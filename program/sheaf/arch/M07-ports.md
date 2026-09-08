# M07 — Application ports (`src/application/ports/`)

Extracted from specs/architecture.md §Module Contracts (Application ports). F01
scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Dependency-inversion contracts.
- **Exports (full target):** LocalEventRepository, ProjectionEngine,
  CryptoPort, DurableHomePort, FilePort, ClockPort, EntropyPort,
  CapacityProbe, LifecyclePort.
- **F01 subset (landed, D9):** `clock.ts` → `ClockPort { nowEpochMs(): number }`
  and `entropy.ts` → `EntropyPort { randomBytes(byteLength): Uint8Array }`.
  Nothing else was added. Repository/projection/provider ports arrive with
  their first composer (F02+); do not add speculative interfaces.
- **Depends on:** domain types only.
- **Must not:** contain a browser, database, provider, or UI implementation.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 subset implemented by SESSION-02 (`acca5a8`).
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged.
