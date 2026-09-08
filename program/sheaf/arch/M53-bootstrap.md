# M53 — Bootstrap (`src/bootstrap/`)

Extracted from specs/architecture.md §Module Contracts (Browser bootstrap). F01 scope.

- **Owns:** Runtime capability decision, lock lifetime, worker composition,
  lifecycle fan-out.
- **F01 exports:** `startApp()` → `{kind:'unsupported', missing}` |
  `{kind:'ready', client…}`; `lockNow()`; pagehide/termination relock hook;
  `UnlockedSession`, `LockReason`, `CapabilityReport` re-export.
- **Depends on:** M50, M51, M32.
- **Must not:** read user records; call a provider; retain any key after
  locking (keys never reach this side of the boundary at all); start the data
  worker before capability checks pass.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-05.

<!-- foundation-first-unlock SESSION-05 -->
- 2026-09-08 — SESSION-05 landed (final revision `27ba411`). Delta:

### M53 — Bootstrap (`src/bootstrap/`) — first implementation

`app-bootstrap.ts` → `startApp(options?) : StartAppResult` (`{kind:'unsupported',
missing, report}` | `{kind:'ready', report, app}`), `AppRuntime` (`client`,
`lockNow(reason)`, `onLock`, `setIdleTimeout(minutes)`, `noteActivity()`,
`dispose()`), `LockReason` (`user` | `pagehide` | `idle-timeout`),
`UnlockedSession`, and a `CapabilityReport` re-export.
`StartAppOptions.spawnWorker` overrides worker construction; the default is
`new Worker(new URL("../workers/data.worker.ts", import.meta.url), {type:"module"})`.
Lifecycle: `pagehide` re-locks; `visibilitychange` only restarts the idle
countdown, which is disarmed unless the user chose a timeout.
