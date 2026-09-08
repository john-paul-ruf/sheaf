# M33 — Worker entries (`src/workers/*.worker.ts`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC) +
§Runtime Topology. F01 scope.

- **Owns:** Per-worker composition roots and key confinement.
- **F01 scope:** `data.worker.ts` only — sole owner of the main IndexedDB
  database and all unlocked key handles; composes M08 + M11 + catalog codec;
  handlers for CAP-01..07; session-memory attempt-delay state (CA-05,
  pinned by AD-5: failures 1–5 carry no delay; the first delay is 2s at the
  6th attempt, doubling to 1h cap; reset on success and on worker
  termination);
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

<!-- foundation-first-unlock SESSION-05 -->
- 2026-09-08 — SESSION-05 landed (final revision `27ba411`). Delta:

### M33 — Worker entries (`src/workers/`) — first implementation

`data.worker.ts` is a composition root only: it supplies `ClockPort` +
`EntropyPort`, warms `loadSodium()`, and moves messages. Every command lives in
`src/workers/data/handlers.ts` (`createDataWorkerHandler({clock, entropy,
calibration?})` → `{handle, dispose}`), which is therefore unit-testable
without a worker. **New in-lease file beyond the session's Files table**, for
that reason.

`data/catalog.ts` → `LocalCatalogV1` and its entry types,
`buildLocalCatalog`, `encodeLocalCatalog`, `decodeLocalCatalog`,
`validateLocalCatalog` (database.md checks 1–6 only — check 7 is the reset
path's obligation and is asserted in the handlers), `withIdleTimeout`,
`idleTimeoutMinutes`, `CATALOG_VERSION`.

`data/session.ts` → `WorkerSession` (locked/unlocked state, zeroization via
`destroySecretKey` on lock and on re-unlock), `AttemptDelay`, `attemptDelayMs`,
`ATTEMPT_FREE_FAILURES = 5`, `ATTEMPT_FIRST_DELAY_MS = 2_000`,
`ATTEMPT_DELAY_CAP_MS = 3_600_000`.

Composition facts worth recording: setup calibrates with `calibrateKdf(clock)`
(floor-enforced) rather than taking the floor; the catalog is sealed with
`deflate-raw-v1`; the D10 recovery-code view is its own envelope under the
local root, stored as `serializeEnvelopeTransport` bytes inside the catalog
payload and copied verbatim by later catalog commits (its AAD is
self-contained, logical revision `1`).
