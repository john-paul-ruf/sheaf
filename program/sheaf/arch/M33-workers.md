# M33 — Worker entries (`src/workers/*.worker.ts`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC) +
§Runtime Topology. F01 scope.

- **Owns:** Per-worker composition roots and key confinement.
- **F01 scope:** `data.worker.ts` only — sole owner of the main IndexedDB
  database and all unlocked key handles; composes M08 + M11 + catalog codec;
  handlers for CAP-01..07; session-memory attempt-delay state (CA-05:
  failures 1–5 free, then 2s doubling to 1h cap, reset on success);
  zeroize + self-termination on lock. `import.worker` (F02),
  `io.worker` (F05), `export.worker` (F07) do not exist yet — do not stub.
- **Depends on:** M08, M09, M11, M32, migrations index.
- **Must not:** import DOM/React; send key bytes or catalog plaintext to the
  page beyond view-safe session results; open any network connection.
- **Catalog (CA-03, D10):** `LocalCatalogV1` CBOR map per database.md, with
  the encrypted recovery-code view held as a wrapped bytes field inside the
  catalog payload (single `local.catalog` scope in F01).

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-05.
