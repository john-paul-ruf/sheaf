# M54 — Routes (`src/routes/`)

Extracted from specs/architecture.md §Module Contracts (Routes).
Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** URL ↔ approved-SCR mapping, lock-state guards, (later) OAuth
  return routing.
- **Exports (landed):**
  - `route-table.tsx` → `SheafApp`.
  - `guards.tsx` → `ROUTE_PATHS`, `ROUTE_HREFS`, `RouteName`, `RoutePath`,
    `SessionPhase`, `RouteGuardResult`, `guardRoute`, `fallbackRoute`,
    `LOCKED_ROUTES`, `UNLOCKED_ROUTES`, `FIRST_RUN_ROUTES`, `appPath`,
    `appHref`, `appHistoryPath`, `tablePath`, `newRecordPath`, `recordPath`,
    `editRecordPath`, `hashHref`, `isAppAreaPath`.
  - `app-runtime.tsx` → `useSheafRuntime`, `RuntimeState`, `SheafRuntime`,
    `SecurityWiring`; plus the `ImportArea` and `AppArea` compositions.
- **Depends on:** M53 (`startApp`, `spawnImportWorker`), M36 (all machines +
  `createImportServices`), M37 (selectors), M41–M44, M38 (`Button`,
  `BusyIndicator`), M51 (`file-pick.ts`), react-router 8 (`HashRouter`) and
  `@xstate/react`.
- **Must not:** implement commands; infer state from provider availability;
  compose a surface missing from specs/design.md; **import a state-machine
  runtime into `src/ui/**`** — the actors live here and screens receive view
  models and callbacks.

## Route table

**Locked / first-run:** `/welcome`, `/setup`, `/unlock`, `/recover`, `/reset`
(locked reset).

**Unlocked:** `/library`, `/settings/security`,
`/settings/security/passphrase`, `/settings/security/recovery-codes`,
`/settings/security/reset` (readable reset), and — added by CA-07's two F02
amendments — `/library/search`, `/upload`, `/import`, plus the app area matched
by *shape*: `/app/:appId`, `/app/:appId/history`, `/app/:appId/t/:tableId`,
`…/new`, `…/r/:recordId`, `…/r/:recordId/edit`.

`ROUTE_HREFS` is the same table with the `#` prefix, so the call sites do not
each re-add it.

## CA-07 guards

`guardRoute(phase, pathname)` is a **pure function of the bootstrap/session
phase and the path only** — it reads no provider, storage or capability fact.
Locked reaches only welcome/setup/unlock/recover/reset(locked); unlocked
redirects those to library; unknown → library|unlock; first-run (no bootstrap
row) → welcome. `first-run` is deliberately **not** a flavour of locked:
FR-22's cold-unlock screen would be a lie before a bootstrap row exists.

F01's implemented matrix equalled STATE's recorded agreement exactly and needed
no amendment — SESSION-07 verified and reported CA-07's proof rather than
recording it as new (replan finding F-11). F02 landed **two amendments**, both
reported in their sessions' handoffs per CA-07's own rule.

### Amendment 1 (S07) — the import routes

- `/library/search`, `/upload` and `/import` are unlocked-only members of
  `UNLOCKED_ROUTES`; `guardRoute` itself is unchanged and stays a pure function
  of phase and path.
- **`#/import` is one route whose stage the machine chooses**, not a family of
  stage-named paths: a stage is a fact about a run in flight, and a stage-named
  path could be deep linked into a run that is not there. `ImportArea` redirects
  between `#/upload` and `#/import` so a deep link always lands on the stage the
  run is actually in.

### Amendment 2 (S08) — the app area

- **The app area is matched by shape, not listed.** An app id is data, so
  `UNLOCKED_ROUTES` cannot hold these paths; `guardRoute` gains one clause —
  `phase === "unlocked" && isAppAreaPath(path)` — and stays pure. A path with an
  extra segment is not an app path and still falls to the phase's fallback.
- **An unknown app id is not an unknown route.** The guard may not read a
  catalog (CA-07), so a well-formed app path *renders* and the app area answers:
  `openApp` → `session: null` → a truthful "That app is not on this device"
  notice **at the app path, with the URL preserved** — deliberately not a
  redirect, so a reload retries the same address. (Redirecting to `#/library`
  *and* showing the notice would have needed a slot inside M42's
  `LibraryScreen`, outside that session's lease.)
- Post-create navigation lands on the real app home. During S07 the reserved
  `#/app` path rendered a truthful interim library landing; S08 flipped it.
- The matrix is asserted case by case in `tests/e2e/route-guards.spec.ts`: 46
  rows across the first-run (16), locked (16) and unlocked (14) tables, plus the
  app-path and library-search cases both amendments added.

## Structural facts

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
- **`ImportArea` and `AppArea` sit above the router**, because each is many
  paths over one long-lived thing — a run in flight, or an *opened* app.
  Opening an app is a hydration, so it is opened when the area is entered and
  closed when it is left; the rest of the unlocked area renders as `children`
  while no such path is current, which is also why the library refetches its
  catalog the moment an import ends.
- **One run, one actor.** `done` is a top-level final state, so a second import
  needs a second actor. It is mounted by a key bumped when the run is over
  **and** the user has left the import area. *Leaving* is the trigger, not the
  state: a refusal arriving while the user is still on `#/upload` would
  otherwise replace the actor that had just produced it, and the refusal would
  never be seen. Both orderings were tried; the wrong one is what the S07 CP4
  e2e caught.
- **A lock ends the parser.** `ImportArea`'s cleanup calls
  `services.terminate()`, so the import worker does not outlive the unlocked
  area. Staged bytes stay for M23's unlock sweep; nothing here delays the lock.
- **The composition point is here (PC-12/D17).** `SecurityWiring` gains
  `records: RecordsServices`; the *import* services are deliberately not there —
  they own a second worker and the channel between them, so they are built
  inside `ImportArea`, the only place `spawnImportWorker` is injected from.
- **`AppAreaWiring`** is what every app-area route is given: the open session,
  the navigation, the worker edge, and the two things a write needs — an
  `announce` for the sentence a *confirmed* commit earns, and a `refresh` that
  re-opens the app so counts are re-read rather than guessed.
- **New dependency edges (F02):** M54 → M43, M54 → M44, M54 → M51
  (`file-pick.ts`), M54 → M36's `importMachine`/`createImportServices`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-07 (`9174b6d`, re-run at `2c0248a`);
  `route-guards.spec.ts` proves 34 guard cases including deep links.
- 2026-09-08 — reconciled by Roshi (F01 final pass): route table restated from
  `ROUTE_PATHS` as landed; staple merged.
- 2026-09-08 — F02: CA-07 amendment 1 + `ImportArea` by SESSION-07 (`8a665c1`);
  amendment 2 + `AppArea` by SESSION-08 (`fe3a8d4` → `5ab3b07`, incl. the
  library-search guard-row correction).
- 2026-09-08 — reconciled by Roshi (F02 final pass): SESSION-07's staple folded,
  and the `# M54 — Routes … CA-07 amendment 2` section that had been stapled
  inside `M44-ui-records.md` moved here, where the module it describes lives.

<!-- workbook-fidelity SESSION-07 -->
### workbook-fidelity SESSION-07 (2026-09-23, commits 2185774..e062f41)

**M54 Routes**
- `route-table.tsx` composes `WorkbookPreflightScreen` (SCR-018/019 workbook steps), wires `SET_DESTINATION`, `TOGGLE_SHEET`, `CLEAR_ALL`, `COPY_HANDOFF` (via injected `copyText`), and sends review edits verbatim. Post-create landing: new app → `appPath(appId)`; append → `tablePath(appId, appendedTableId)`.
