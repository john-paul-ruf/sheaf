# M07 — Application ports (`src/application/ports/`)

Extracted from specs/architecture.md §Module Contracts (Application ports). F01 scope.

- **Owns:** Dependency-inversion contracts.
- **Exports (full target):** LocalEventRepository, ProjectionEngine,
  CryptoPort, DurableHomePort, FilePort, ClockPort, EntropyPort,
  CapacityProbe, LifecyclePort.
- **F01 subset (D9):** `ClockPort`, `EntropyPort` only. Repository/projection/
  provider ports arrive with their first composer (F02+). Do not add
  speculative interfaces.
- **Depends on:** domain types only.
- **Must not:** contain a browser, database, provider, or UI implementation.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). No code yet.

<!-- foundation-first-unlock SESSION-02 -->
- 2026-09-08 — SESSION-02 landed (final revision `acca5a8`). Delta:

### M07 — Application ports (`src/application/ports/`) — first implementation

`clock.ts` → `ClockPort { nowEpochMs(): number }`;
`entropy.ts` → `EntropyPort { randomBytes(byteLength): Uint8Array }`.
F01 subset only (D9); no other port was added.
