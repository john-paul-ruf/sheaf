# M53 — Bootstrap (`src/bootstrap/`)

Extracted from specs/architecture.md §Module Contracts (Browser bootstrap).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

- **Owns:** Runtime capability decision, lock lifetime, worker composition,
  lifecycle fan-out.
- **Exports (landed):** `app-bootstrap.ts` → `startApp(options?):
  StartAppResult` (`{kind:'unsupported', missing, report}` |
  `{kind:'ready', report, app}`), `AppRuntime` (`client`, `lockNow(reason)`,
  `onLock`, `setIdleTimeout(minutes)`, `noteActivity()`, `dispose()`),
  `LockReason` (`user` | `pagehide` | `idle-timeout`), `UnlockedSession`, and a
  `CapabilityReport` re-export; `import-worker.ts` → `spawnImportWorker()` and
  `createImportWorkerClient()` (F02, unchanged by F03).
- **Depends on:** M50, M51, M32.
- **Must not:** read user records; call a provider; retain any key after
  locking; start the data worker before capability checks pass.

## Contracts worth recording

- `StartAppOptions.spawnWorker` overrides worker construction; the default is
  `new Worker(new URL("../workers/data.worker.ts", import.meta.url),
  {type:"module"})`.
- Lifecycle: `pagehide` re-locks; `visibilitychange` only restarts the idle
  countdown, which is **disarmed unless the user chose a timeout**.
- **Two countdowns exist and must stay reconciled.** `AppRuntime` and M36's
  `sessionMachine` both own an idle countdown; both converge on an idempotent
  lock.
- `LockReason` is imported **type-only** by M36, so there is no runtime edge
  from application to bootstrap.
- **`spawnImportWorker` is the literal Vite statically analyses.** It is
  *injected* into the application layer by M54's `ImportArea` (D17/PC-12), so
  `src/application/**` keeps no edge to `src/bootstrap/`. F03's workbook
  import runs through this same spawned worker and lifetime unchanged — no
  second import worker was needed for the new formats.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 (`27ba411`); capability branches
  covered by jsdom unit tests.
- 2026-09-08 — driven through the real entry by SESSION-07 (`9174b6d`, re-run
  at `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): staple merged; the
  two-countdown reconciliation recorded here.
- 2026-09-08 — F02: `import-worker.ts` added by SESSION-04 (`cd74e6d`) and
  wired from `ImportArea` by SESSION-07 (`8a665c1`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the second composition
  root recorded; the injection rule stated here.
- 2026-09-23 — F03: SESSION-06 (`4287569`..`677b947`) reported no change to
  `src/application/ports/**` or `src/bootstrap/import-worker.ts` — F03's
  workbook import composes through the existing spawn/lifetime path.
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-06
  "no-change" note folded into the `spawnImportWorker` paragraph as confirming
  evidence, rather than left as a standalone staple with nothing to reconcile.


<!-- durable-home-backup SESSION-02 partial CP3 d75830d -->
## M53 — bootstrap
startApp owns AppRuntime.saveBundle, spawnIoWorker's literal Vite URL, and each transfer's AbortController. lock/pagehide/dispose cancel saves and terminate IO resources. Data/IO constructors remain lazy until explicit use. Tests can inject destination and constructors.
