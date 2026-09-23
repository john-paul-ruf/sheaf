# M53 — Bootstrap (`src/bootstrap/`)

Extracted from specs/architecture.md §Module Contracts (Browser bootstrap).
Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** Runtime capability decision, lock lifetime, worker composition,
  lifecycle fan-out.
- **Exports (landed):** `app-bootstrap.ts` → `startApp(options?):
  StartAppResult` (`{kind:'unsupported', missing, report}` |
  `{kind:'ready', report, app}`), `AppRuntime` (`client`, `lockNow(reason)`,
  `onLock`, `setIdleTimeout(minutes)`, `noteActivity()`, `dispose()`),
  `LockReason` (`user` | `pagehide` | `idle-timeout`), `UnlockedSession`, and a
  `CapabilityReport` re-export; `import-worker.ts` → `spawnImportWorker()` and
  `createImportWorkerClient()` (F02).
- **Depends on:** M50, M51, M32.
- **Must not:** read user records; call a provider; retain any key after
  locking (keys never reach this side of the boundary at all); start the data
  worker before capability checks pass.

## Contracts worth recording

- `StartAppOptions.spawnWorker` overrides worker construction; the default is
  `new Worker(new URL("../workers/data.worker.ts", import.meta.url),
  {type:"module"})`.
- Lifecycle: `pagehide` re-locks; `visibilitychange` only restarts the idle
  countdown, which is **disarmed unless the user chose a timeout**.
- **Two countdowns exist and must stay reconciled.** `AppRuntime` and M36's
  `sessionMachine` both own an idle countdown; both converge on an idempotent
  lock. M54 mirrors the *adopted* (worker-persisted) value with
  `app.setIdleTimeout(...)` after each successful persist and routes
  `noteActivity()` from the same handler. Never arm from an optimistic value
  (D13/AD-7).
- `LockReason` is imported **type-only** by M36, so there is no runtime edge
  from application to bootstrap.
- **`spawnImportWorker` is the literal Vite statically analyses.**
  `new Worker(new URL("../workers/import.worker.ts", import.meta.url),
  {type:"module"})` must stay written out; it is *injected* into the application
  layer by M54's `ImportArea` (D17/PC-12), so `src/application/**` keeps no edge
  to `src/bootstrap/`. The import worker is spawned per run and terminated at
  every terminal state, and a lock ends it with the unlocked area.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`); capability branches
  covered by jsdom unit tests, one per required capability.
- 2026-09-08 — driven through the real entry by SESSION-07 (`9174b6d`, re-run
  at `2c0248a`); `capability-gate.spec.ts` proves no worker is spawned and no
  route is reachable (including by deep link) when a required capability is
  missing.
- 2026-09-08 — reconciled by Roshi (F01 final pass): staple merged; the
  two-countdown reconciliation recorded here rather than only in a handoff.
- 2026-09-08 — F02: `import-worker.ts` added by SESSION-04 (`cd74e6d`) and wired
  from `ImportArea` by SESSION-07 (`8a665c1`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the second composition root
  recorded in the export list and the injection rule stated here, where the
  literal lives. F02 wrote no delta into this fragment; the facts come from the
  sessions' returns and the tree.

<!-- workbook-fidelity SESSION-06 -->
### workbook-fidelity SESSION-06 (2026-09-23, commits 4287569..677b947)

**M07 / M53**
- No change (`src/application/ports/**`, `src/bootstrap/import-worker.ts` untouched).
