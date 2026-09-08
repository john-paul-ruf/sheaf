# M55 — Entry (`src/main.tsx`)

Extracted from specs/architecture.md §Module Structure (Entry). F01 scope.

- **Owns:** Minimal browser entry: apply shell theme, `startApp()`, mount
  router under the React root, fatal bootstrap handling (render the SCR-001
  recoverable state on unsupported capability).
- **Depends on:** M40, M53, M54.
- **Must not:** hold logic beyond composition; import workers/persistence/
  crypto directly; load any external resource.
- **History note:** created as a static placeholder in SESSION-01 (checkpoint
  toolchain proof), replaced with real composition in SESSION-07 — the two
  sessions serialize on this file by dependency order.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Placeholder: SESSION-01; real entry: SESSION-07.
