# M33 — Worker entries (`src/workers/**`, minus `protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC) +
§Runtime Topology. Reconciled against the tree at `5bc19fb` (F04 final;
formulas-queries-charts).

- **Owns:** Per-worker composition roots and key confinement.
- **Landed scope:** `data.worker.ts` (sole owner of the main IndexedDB
  database and of every unlocked key handle) and `import.worker.ts` (parse
  only, every accepted format). `io.worker` (F05) and `export.worker` (F07)
  do not exist yet — do not stub them.
- **Depends on:** M08, M09, M11, M12, M21, M22, M23, M32, M34, M35, M65
  (F03), migrations index.
- **Must not:** import DOM/React; send key bytes or catalog plaintext to the
  page beyond view-safe session results; open any network connection. The
  **import** worker additionally holds no key, no IndexedDB handle and no
  crypto: its module graph is asserted free of dexie, libsodium, `src/crypto/`
  and `persistence/envelope-store` **transitively**.

## Landed structure

`data.worker.ts` is a composition root only: it supplies `ClockPort` +
`EntropyPort`, warms `loadSodium()`, forwards `event.ports` into dispatch, and
moves messages. Every command lives beside it in `src/workers/data/`
(`createDataWorkerHandler({clock, entropy, calibration?})` → `{handle,
dispose}`).

| File | Holds |
|---|---|
| `data/catalog.ts` | `LocalCatalogV1` + entry types, `buildLocalCatalog`, `encodeLocalCatalog`, `decodeLocalCatalog`, `validateLocalCatalog`, `withIdleTimeout`, `idleTimeoutMinutes`, `CATALOG_VERSION`, `APP_ACCENT_IDS`, `AppIdentityV1`; (F04) app entry `chartDraft?: Uint8Array` and the `themeTile` cache |
| `data/session.ts` | `WorkerSession`, `AttemptDelay`, `attemptDelayMs`, `ATTEMPT_FREE_FAILURES = 5`, `ATTEMPT_FIRST_DELAY_MS = 2_000`, `ATTEMPT_DELAY_CAP_MS = 3_600_000` |
| `data/handlers.ts` | Command registration, unlock/lock lifetime, dispose; (F03) hands `appSession`/`closeAppSession` to the import handlers |
| `data/import-handlers.ts` | Port adapters, the channel receiver, fact accumulation, the import commands (F03: workbook stages, `runInference`/`applyReviewEdit`/promotion/append over every format; F04: refreshes formulas after rejection memory, proposal wire carries formulas/charts/rules) |
| `data/app-session.ts` | Durable roots → projection mapping, `AppSessionRegistry`; (F03) `appSession(appId)`, `closeAppSession(appId)`; (F04) `localClockReading(clock)`, tail replay through the command layer's `projectionRevalidator` |
| `data/event-store.ts` | `loadApp`, `openAppKey`, `createEventStore`, `deviceOnlyChangeCount`; (F04) the head's `schemaRevision` now advances with `commit.schemaRevisionAfter` |
| `data/record-event-payloads.ts` | Both directions of the record payload codec, incl. (F03) tail decoders, (F04) every schema/rule/formula/chart tail kind and the optional fourth `evidence: {frozen}` provenance key |
| `data/record-handlers.ts` | The app commands and the wire↔domain mapping, incl. (F03) the nine relationship/snapshot RPCs, (F04) `recalculated` on every accepted command, computed-cell mapping, `refreshVolatile` before reads, `toDomainFilter` |
| `data/structure-handlers.ts` (F04, new) | The four schema/metrics RPCs; wire↔domain; definition digests over M23's canonical encoders + M08 SHA-256; the relationship-removal fingerprint via M21's `workbookFingerprintInput`; per-event payload size for D38; local-time formula clock; forwards `optionLabels` (lease r2) |
| `data/schema-event-payloads.ts` (F04, new) | The F04 schema payload codec, exact keys; `encodeTableDefinition` |
| `data/chart-handlers.ts` (F04, new) | The nine chart RPCs; wire↔domain mapping; drafts |
| `data/chart-event-payloads.ts` (F04, new) | `chart.saved`/`chart.deleted` codec over M23's definition codec, refusing a payload whose name/pin/id disagree with its definition |
| `data/theme-handlers.ts` (F04, new) | `listThemePalettes`, `changeTheme` (authored `theme.changed` through `executeCommand`; updates the catalog's `themeTile` cache on the same path as `noteAppOpened`), `toThemeWire`, `toThemeTileWire`, `themeTileOf` |
| `import.worker.ts` | Sniff → size → refuse, or await the stage and stream facts + source (F03: reads `acceptedFlows`, emits `workbook-preflight`, validates `selectedSheets`) |
| `import/parse-session.ts` | `preflightFile`, `streamFacts`, `streamSource`, (F03) `streamWorkbookFacts` |
| `import/adapters.ts` (F03) | `WORKBOOK_REGISTRY {readers, adapters}` — xlsx (OOXML), xlsb, xls (BIFF), ods, html-table (D35) |

## Attempt delay (CA-05, pinned by AD-5)

Failures 1–5 carry **no** delay; the first delay is **2s at the 6th
consecutive failed attempt**, doubling per further failure to a 1h cap; reset
on success and on worker termination; **never persisted** (D4). The counter
also covers recovery-code attempts and passphrase re-checks; any success
resets it. Unchanged by F03/F04.

## Catalog (CA-03, D10 / AD-8, CA-09)

`LocalCatalogV1` is a CBOR map per database.md, sealed with `deflate-raw-v1` in
a single `local.catalog` scope. Unchanged in shape by F03/F04 beyond the F04
`chartDraft`/`themeTile` additive fields (above). `validateLocalCatalog`
implements database.md checks 1–6; check 7 is CAP-07's reset-path obligation
(handlers + e2e). The D10 recovery-code view is its own nested envelope.
`LocalCatalogAppEntryV1` carries `displayName`, `identity: AppIdentityV1
{accentId, glyph}`, `createdAtEpochMs`, `lastOpenedAtEpochMs: number | null`,
`rowCountCache: number | null`, `tableCount`. CAP-18 (readable reset):
`inventoryOf` reads `app.displayName`; `deviceOnlyChangeCount` is recomputed
from each app's decrypted head frontier.

## Import composition (D17, extended F03)

- The import worker parses only. Fact batches ride a page-created
  `MessageChannel` to the data worker; inference runs in the data worker over
  accumulated facts; the stage is authoritative for proposal + edits.
- **Backpressure is the control flow.** Each item is sent and awaited, so
  batch `n + 1` cannot be sent before ack `n`; the receiver's order is
  **encrypt → commit → ack**, never the other way (invariant 1). A
  `MessagePort` must be `start()`ed explicitly — `streamFacts` does this.
- `bootstrap/import-worker.ts` (M53) holds `spawnImportWorker` and
  `createImportWorkerClient`; untouched by F03/F04.
- The unlock path runs `sweepStaleImports` **before the session view is
  returned**.

**F03: `import/parse-session.ts`.** `preflightFile(file, name, emit,
acceptedFlows = ["delimited"], registry)` → `proceed | workbook | refused`;
`acceptedSelection(report, selection)`; `streamFacts` (delimited, opened with
its sheet fact), `streamWorkbookFacts` (selected sheets via the registry
adapter), `openContainer`, one ack-gated `sendItems` loop; progress names
every sheet a batch opens; failures carry `detail`. Unchanged by F04 — every
F04 import extension rides the same fact-stream vocabulary (see
`M32-worker-protocol.md`).

**F03: `data/import-handlers.ts`.** Workbook stages (inventory + selection
validated, D31 budget), existing-app destination for delimited; `runInference`
→ `inferWorkbook` (delimited via `delimitedStream`, append gets
`existingApp.tableNames` + rejection memory); staged facts re-read from the
fact chunks (digest-checked) when the channel's copy is incomplete;
`applyReviewEdit` → workbook edits; promotion → `promoteImport`, append →
`appendTable` then the app session is closed; exports `proposalWire`,
`rejectionMemoryOf`, `tailDecisionsOf`, `ImportAppAccessV1`,
`RecordedDecisionV1`. `SessionCatalogPort.sealWithAppendedApp`. Exports
`rejectedPromotionResponse(result)` (OWNER-PROMOTION-SEAMS `cd4fe9d`) so promote
and append both surface `columnKey`.

## App session composition (F02, extended F03, F04)

- `app-session.ts` maps durable roots → projection. Issues are recomputed by
  the one shared validator and required to agree with the record page's
  stored verdict; per-field provenance is empty (a record page stores none);
  `createdCommitId` is the canonically last commit the checkpoint's frontier
  covers. The tail is replayed one commit at a time.
- **F03:** the manifest → projection mapping is straight through (no
  hardcoded classification/rules); checkpoint pages are validated with a
  resolver over the pages' own records; the tail is replayed through
  `validateAgainstProjection` (live schema, real resolver, provenance rule);
  `AppSessionV1.openSnapshot(storageId)` checks the manifest digest against
  `head.snapshotManifests` and the chunk digest against the manifest ref.
- **F04:** `localClockReading(clock)` computes the local calendar day; the
  projection is opened with it (M12's required `clock` init param); tail
  replay now also passes the command layer's `projectionRevalidator`, so an
  F04 schema/rule/formula event replayed from an older segment is checked
  against the *current* projection state, not just decoded.
- `event-store.ts` verifies every root's `semanticSha256` and each record
  page's declared count before believing it. One transaction per command.
  `chainState()` requires the head's frontier and its decoded segments to
  agree and fails closed otherwise. **F04:** the head's `schemaRevision` now
  actually advances with `commit.schemaRevisionAfter` — an F02/F03 oversight
  (it was never advanced) that F04's schema commands made load-bearing and so
  forced the fix.
- `record-event-payloads.ts` encodes through M23's own
  `encodeCellValue`/`decodeCellValue`. **F03:** `TAIL_EVENT_KINDS`,
  `isTailEventKind`, `decodeTailEventPayload` (reads promotion's
  `table.created` with or without `sourceSheet`, `field.created`,
  `enum.changed`, `inference-decision.recorded`). **F04:** every schema/rule/
  formula/chart kind is a tail kind too; value provenance may carry an
  optional fourth key `evidence: {frozen: text}` (D51) — three-key payloads
  from F02/F03 decode unchanged.
- `record-handlers.ts`: an app that is not open opens itself. **F03:** nine
  new RPCs (relationships, snapshots, inert, deleted-record, table list);
  `toDomainValue` maps authored `reference`. **F04:** `recalculated` on every
  accepted command; computed cells mapped to wire (`toComputedEntry`);
  `refreshVolatile(60 s)` before `queryRecords`/`getRecord`/`getAppMetrics`;
  `toDomainFilter` for `query-records`.
- `handlers.ts`: `lock()` and `dispose()` destroy every open projection and
  app key **and** dispose the import handlers.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — CA-05 wording reconciled by Jikijitsu at `d97aa17`.
- 2026-09-08 — F01 implemented by SESSION-05 (`27ba411`); proven end-to-end
  through the real `index.html` entry at `9174b6d` / `2c0248a`.
- 2026-09-08 — reconciled by Roshi (F01 final pass): the module path is
  `src/workers/**`; staple merged.
- 2026-09-08 — F02: catalog display metadata + the import worker, channel
  receiver and seven import commands by SESSION-04 (`82c38fc` → `cd74e6d`);
  app session, event store and the ten app commands by SESSION-05
  (`d47b3d2`), first worker-tier journey verified.
- 2026-09-08 — reconciled by Roshi (F02 final pass): both session staples
  folded, including SESSION-04's superseded "Not landed" list.
- 2026-09-23 — F03: app-session/record-handler extensions and the nine
  relationship/snapshot RPCs by SESSION-03 (`f29ac33`..`a2c4cf0`); the
  workbook import worker, `import/adapters.ts` and the append-aware import
  handlers by SESSION-06 (`4287569`..`677b947`); `rejectedPromotionResponse`
  by OWNER-PROMOTION-SEAMS (`cd4fe9d`). New test infrastructure:
  `tests/browser/projection/workbook.spec.ts`,
  `tests/browser/worker/workbook-app-fixture.ts` (SESSION-03);
  `tests/browser/worker/{workbook-staging,workbook-journey,workbook-runtime,
  workbook-roots}.*` (SESSION-06).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three staples folded
  into the Landed-structure table and the Import-composition/App-session
  sections; two duplicate SESSION-03 headings in the source delta (one for
  `data/`, one for tests) merged into this one fragment without loss.
- 2026-09-23 — F04: `structure-handlers.ts`, `schema-event-payloads.ts`, the
  F04 tail-kind/recalc/schema-revision wiring by SESSION-03 (`a69e6e0`..
  `2235cce`); the `query-records` record-handler leg by SESSION-04
  (`f736fa8`..`27a2667`); `chart-handlers.ts`/`chart-event-payloads.ts`/the
  catalog `chartDraft` field by SESSION-05 (`6ee204c`..`3dd1d2d`); the
  `optionLabels` forwarding correction by SESSION-06 lease r2 (`3b7ecfa`);
  `theme-handlers.ts` and the catalog `themeTile` cache by SESSION-08
  (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): five SESSION deltas
  folded into the Landed-structure table (four new `data/` files added) and
  the App-session-composition section; the `schemaRevision`-never-advanced
  fact recorded as a closed F02/F03 latent defect that F04 made load-bearing,
  rather than left as a bare one-line note; the SESSION-07 pointer left as a
  cross-reference to `M01-domain-model.md`.

<!-- durable-home-backup SESSION-02 CP1 -->
## M33 — worker-owned home state and retention

`createDataWorkerHandler` composes `createBackupHandlers` with the production
envelope store, crypto, clock, current session and vault crypto adapter. Its
`backup` member is worker-internal; page RPC/UI exposure remains future S02 work.

`home-state.ts` owns the strict encrypted `local.home-state` payload: bundle
home/vault identity, separate vault bootstrap/recovery material, locally
protected vault key, app-key wraps and durable backup pins. Catalog identity
is checked after authentication. Assignment ends scratch without setting a
successful-backup timestamp.

`AppEventStoreV1.appendHome` atomically commits assignment, new head, app-key
wrap/home state and catalog. It checks app/head identity and current session
revision. Replacing an existing home payload deletes its superseded envelope
in the same transaction.

`pin` stores an authenticated current-head retention root before returning.
`release` preserves current heads, other pins and roots retained by the app;
otherwise it deletes the retired head atomically with the pin update. Pins
survive worker restart and are separate from import workflows/cleanup tickets.


Tail codec validates the assignment payload and supported wrap version.


<!-- durable-home-backup SESSION-02 CP2 c7e6507 -->
## M33 — data worker
readAppHead removes eager graph loading from pin/release. backup-graph authenticates every current producer descendant and original covered chain, retains the source head, independently reconstructs authored state in SQLite, and rejects unsupported nonempty retained/conflict/audit roots without mutation. Backup handlers own app keys and active cursors through abort, error, release, lock, reset, session replacement and teardown. Release cancels readers before removing retention roots.


<!-- durable-home-backup SESSION-02 partial CP3 d75830d -->
## M33 — workers
io.worker is a real dedicated worker composition root for receiveBundle, holds ciphertext Blob parts, and offers output only after second-pass verification. It has no key/store/projection path. backup.connectBundle composes durable pin, bounded graph, publication and ciphertext transport. Captured candidate/frontier/vault identity remain data-worker-owned. Native saved completion validates live session and home, checks frontier bounds/regression, and atomically commits receipt/time plus pin release. Rejected/interrupted operations preserve pins for recovery and do not advance confirmation. Worker lock/reset/session replacement/dispose abort transfers via existing backup.disposeAll. Optional HomeState receipts add app/operation/artifact/candidate/generation/frontier/time; pre-receipt homes decode unchanged. General status/count readers remain CP4/5 work.
