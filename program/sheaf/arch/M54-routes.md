# M54 — Routes (`src/routes/`)

Extracted from specs/architecture.md §Module Contracts (Routes). F01 scope.
Reconciled against the tree at `2c0248a`.

- **Owns:** URL ↔ approved-SCR mapping, lock-state guards, (later) OAuth
  return routing.
- **F01 exports (landed):**
  - `route-table.tsx` → `SheafApp`.
  - `guards.tsx` → `ROUTE_PATHS`, `ROUTE_HREFS`, `RouteName`, `RoutePath`,
    `SessionPhase`, `RouteGuardResult`, `guardRoute`, `fallbackRoute`,
    `LOCKED_ROUTES`, `UNLOCKED_ROUTES`, `FIRST_RUN_ROUTES`.
  - `app-runtime.tsx` → `useSheafRuntime`, `RuntimeState`, `SheafRuntime`,
    `SecurityWiring`.
- **Depends on:** M53 (`startApp`), M36 (all seven machines), M37 (selectors),
  M41, M42, M38 (`Button`, `BusyIndicator`), react-router 8 (`HashRouter`) and
  `@xstate/react`.
- **Must not:** implement commands; infer state from provider availability;
  compose a surface missing from specs/design.md; **import a state-machine
  runtime into `src/ui/**`** — the actors live here and screens receive view
  models and callbacks.

## Route table (F01)

`/welcome`, `/setup`, `/unlock`, `/recover`, `/reset` (locked reset),
`/library`, `/settings/security`, `/settings/security/passphrase`,
`/settings/security/recovery-codes`, `/settings/security/reset` (readable
reset). `ROUTE_HREFS` is the same table with the `#` prefix, so the ten call
sites do not each re-add it.

## CA-07 guards

`guardRoute(phase, pathname)` is a **pure function of the bootstrap/session
phase and the path only** — it reads no provider, storage or capability fact.
Locked reaches only welcome/setup/unlock/recover/reset(locked); unlocked
redirects those to library; unknown → library|unlock; first-run (no bootstrap
row) → welcome. `first-run` is deliberately **not** a flavour of locked:
FR-22's cold-unlock screen would be a lie before a bootstrap row exists.

The implemented matrix equals STATE's recorded agreement exactly and needed no
amendment — SESSION-07 verified and reported CA-07's proof rather than
recording it as new (replan finding F-11).

## Two structural facts

- **`app-runtime.tsx` exists because a lock is a *termination*.**
  `AppRuntime.lockNow` terminates the client, and a terminated
  `DataWorkerClient` never spawns another — so relock, purge and "start over"
  are all the same operation: discard the runtime and probe again with
  `getStatus`.
- **New dependency edge M54 → M08 (crypto), dynamic.** `app-runtime.tsx` wires
  M36's `RecoveryCodeFormatPort` to `parseRecoveryCode` through a dynamic
  `import()`, because workflows may not import crypto. The import is dynamic so
  a page that never reaches SCR-004 never loads the libsodium chunk.
  `src/ui/**` still imports no crypto, which
  `tests/unit/ui/architecture.test.ts` enforces.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-07 (`9174b6d`, re-run at `2c0248a`);
  `route-guards.spec.ts` proves 34 guard cases including deep links.
- 2026-09-08 — reconciled by Roshi (final pass): route table restated from
  `ROUTE_PATHS` as landed; session-delta staple merged.
