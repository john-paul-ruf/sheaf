# M54 — Routes (`src/routes/`)

Extracted from specs/architecture.md §Module Contracts (Routes). F01 scope.

- **Owns:** URL ↔ approved-SCR mapping, lock-state guards, (later) OAuth
  return routing.
- **F01 exports:** hash-route table (`#/welcome`, `#/setup`, `#/unlock`,
  `#/recover`, `#/reset`, `#/library`, `#/settings/security`,
  `#/settings/security/passphrase`, `#/settings/security/recovery-codes`,
  `#/settings/security/reset`), `RouteGuardResult` guards per CA-07:
  locked → only welcome/setup/unlock/recover/reset(locked); unlocked
  redirects those to library; unknown → library|unlock; first-run (no
  bootstrap row) → welcome.
- **Depends on:** UI feature modules + M37 VMs + M53 state.
- **Must not:** implement commands; infer state from provider availability;
  compose a surface missing from specs/design.md.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-07.

<!-- foundation-first-unlock SESSION-07 -->
- 2026-09-08 — SESSION-07 landed (final revision `9174b6d`). Delta:

**M54 — Routes (`src/routes/`)**
- **Exports:** `SheafApp` (`route-table.tsx`); `ROUTE_PATHS`, `ROUTE_HREFS`,
  `SessionPhase`, `RouteGuardResult`, `guardRoute`, `fallbackRoute`,
  `LOCKED_ROUTES`, `UNLOCKED_ROUTES`, `FIRST_RUN_ROUTES` (`guards.tsx`);
  `useSheafRuntime`, `RuntimeState`, `SheafRuntime`, `SecurityWiring`
  (`app-runtime.tsx`).
- `guardRoute(phase, pathname)` is a pure function of the *bootstrap/session
  phase* and the path only — it reads no provider, storage or capability fact
  (CA-07).
- **New file, not in the session's Files table:** `app-runtime.tsx`. It exists
  because a lock is a *termination*: `AppRuntime.lockNow` terminates the
  client, and a terminated `DataWorkerClient` never spawns another, so relock,
  purge and "start over" are all the same operation — discard the runtime and
  probe again with `getStatus`.
- **New dependency edge M54 → M08 (crypto), dynamic.** `app-runtime.tsx` wires
  M36's `RecoveryCodeFormatPort` to `parseRecoveryCode` through a dynamic
  `import()`, per SESSION-06's handoff (workflows may not import crypto). The
  import is dynamic so a page that never reaches SCR-004 never loads the
  libsodium chunk. `src/ui/**` still imports no crypto, which
  `tests/unit/ui/architecture.test.ts` enforces.
- Also depends on M53 (`startApp`), M36 (all seven machines), M37 (selectors),
  M41, M42, M38 (`Button`, `BusyIndicator`), react-router 8 (`HashRouter`) and
  `@xstate/react`.
- **Must not (added):** import a state-machine runtime into `src/ui/**` — the
  actors live here and screens receive view models and callbacks.
