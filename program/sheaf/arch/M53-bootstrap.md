# M53 — Bootstrap (`src/bootstrap/`)

Extracted from specs/architecture.md §Module Contracts (Browser bootstrap).
F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Runtime capability decision, lock lifetime, worker composition,
  lifecycle fan-out.
- **F01 exports (landed):** `app-bootstrap.ts` → `startApp(options?):
  StartAppResult` (`{kind:'unsupported', missing, report}` |
  `{kind:'ready', report, app}`), `AppRuntime` (`client`, `lockNow(reason)`,
  `onLock`, `setIdleTimeout(minutes)`, `noteActivity()`, `dispose()`),
  `LockReason` (`user` | `pagehide` | `idle-timeout`), `UnlockedSession`, and a
  `CapabilityReport` re-export.
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

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`); capability branches
  covered by jsdom unit tests, one per required capability.
- 2026-09-08 — driven through the real entry by SESSION-07 (`9174b6d`, re-run
  at `2c0248a`); `capability-gate.spec.ts` proves no worker is spawned and no
  route is reachable (including by deep link) when a required capability is
  missing.
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged;
  the two-countdown reconciliation recorded here rather than only in a handoff.
