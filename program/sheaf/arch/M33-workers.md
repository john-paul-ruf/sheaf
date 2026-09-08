# M33 — Worker entries (`src/workers/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC) +
§Runtime Topology. F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Per-worker composition roots and key confinement.
- **F01 scope:** `data.worker.ts` only — sole owner of the main IndexedDB
  database and of every unlocked key handle; composes M08 + M11 + the catalog
  codec; handlers for CAP-01..07 plus `updateSettings`; session-memory
  attempt-delay state; zeroize + self-termination on lock. `import.worker`
  (F02), `io.worker` (F05) and `export.worker` (F07) do not exist yet — do not
  stub them.
- **Depends on:** M08, M09, M11, M32, migrations index.
- **Must not:** import DOM/React; send key bytes or catalog plaintext to the
  page beyond view-safe session results; open any network connection.

## Landed structure

`data.worker.ts` is a composition root only: it supplies `ClockPort` +
`EntropyPort`, warms `loadSodium()`, and moves messages. Every command lives in
`src/workers/data/handlers.ts` (`createDataWorkerHandler({clock, entropy,
calibration?})` → `{handle, dispose}`), which is therefore unit-testable
without spawning a worker.

- `data/catalog.ts` → `LocalCatalogV1` and its entry types,
  `buildLocalCatalog`, `encodeLocalCatalog`, `decodeLocalCatalog`,
  `validateLocalCatalog`, `withIdleTimeout`, `idleTimeoutMinutes`,
  `CATALOG_VERSION`.
- `data/session.ts` → `WorkerSession` (locked/unlocked state, zeroization via
  `destroySecretKey` on lock and on re-unlock), `AttemptDelay`,
  `attemptDelayMs`, `ATTEMPT_FREE_FAILURES = 5`,
  `ATTEMPT_FIRST_DELAY_MS = 2_000`, `ATTEMPT_DELAY_CAP_MS = 3_600_000`.

## Attempt delay (CA-05, pinned by AD-5)

Failures 1–5 carry **no** delay; the first delay is **2s at the 6th
consecutive failed attempt**, doubling per further failure to a 1h cap; reset
on success and on worker termination; **never persisted** (D4 — database.md v1
budgets no counter, and the cleartext-budget test proves no persistable counter
API exists). The counter also covers recovery-code attempts and passphrase
re-checks; any success resets it. Unit vector `0,0,0,0,0,2s,4s,…` plus one live
2s observation at `27ba411`; the e2e leg observes the delay at the 6th wrong
attempt.

## Catalog (CA-03, D10 / AD-8)

`LocalCatalogV1` is a CBOR map per database.md, sealed with `deflate-raw-v1` in
a single `local.catalog` scope for F01.

- **`validateLocalCatalog` implements database.md checks 1–6 only.** Check 7 is
  not a validator predicate; it is CAP-07's **reset-path obligation**, asserted
  in the handlers (two refusal branches, the drift branch proven with two
  workers over one store) and again in SESSION-07's e2e reset leg. The confirm
  token *is* canonical CBOR of the recomputed inventory; confirm recomputes
  from storage and refuses with `stale-confirmation` on disagreement, purging
  nothing.
- **The D10 recovery-code view is its own nested envelope**, not wrapped bytes:
  M08 exposes no way to read wrapped bytes back (`readKeyBytes` is internal).
  It is stored as `serializeEnvelopeTransport` bytes inside the catalog
  payload, has self-contained AAD at logical revision `1`, and is copied
  verbatim by later catalog commits. No schema touched; AD-8 holds.
- Setup calibrates with `calibrateKdf(clock)` (floor-enforced) rather than
  taking the floor.
- `ResetInventoryAppV1` has **no F01 producer** — the readable-reset list is
  always empty, and the surface says "none", never "unknown".
- `changePassphrase{via:'recovery'}` from a passphrase-unlocked session is
  refused as `malformed-request`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — CA-05 wording reconciled by Jikijitsu at `d97aa17` after the
  planning pass found three incompatible statements of the free-attempt
  threshold (replan finding F-05 → AD-5).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`). **First journey proven at
  worker level**: setup → settings → lock → wrong-pass → unlock → reload →
  unlock, against a real worker, real libsodium WASM and real IndexedDB.
- 2026-09-08 — proven end-to-end through the real `index.html` entry by
  SESSION-07 (`9174b6d`, re-run at `2c0248a`).
- 2026-09-08 — reconciled by Roshi (final pass): the module path is
  `src/workers/**` (the registry's `src/workers/*.worker.ts` describes only the
  entry files, not the leasing unit that shipped); session-delta staple merged.
