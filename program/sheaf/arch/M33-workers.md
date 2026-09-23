# M33 — Worker entries (`src/workers/**`, minus `protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC) +
§Runtime Topology. Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** Per-worker composition roots and key confinement.
- **Landed scope:** `data.worker.ts` (sole owner of the main IndexedDB database
  and of every unlocked key handle) and `import.worker.ts` (parse only).
  `io.worker` (F05) and `export.worker` (F07) do not exist yet — do not stub
  them.
- **Depends on:** M08, M09, M11, M12, M21, M22, M23, M32, M34, M35, migrations
  index.
- **Must not:** import DOM/React; send key bytes or catalog plaintext to the
  page beyond view-safe session results; open any network connection. The
  **import** worker additionally holds no key, no IndexedDB handle and no
  crypto: its module graph is asserted free of dexie, libsodium, `src/crypto/`
  and `persistence/envelope-store` **transitively**, and the emitted chunk is
  fetched and grepped in the browser suite.

## Landed structure

`data.worker.ts` is a composition root only: it supplies `ClockPort` +
`EntropyPort`, warms `loadSodium()`, forwards `event.ports` into dispatch, and
moves messages. Every command lives beside it in `src/workers/data/`
(`createDataWorkerHandler({clock, entropy, calibration?})` → `{handle,
dispose}`), which is therefore unit-testable without spawning a worker.

| File | Holds |
|---|---|
| `data/catalog.ts` | `LocalCatalogV1` + entry types, `buildLocalCatalog`, `encodeLocalCatalog`, `decodeLocalCatalog`, `validateLocalCatalog`, `withIdleTimeout`, `idleTimeoutMinutes`, `CATALOG_VERSION`, `APP_ACCENT_IDS`, `AppIdentityV1` |
| `data/session.ts` | `WorkerSession`, `AttemptDelay`, `attemptDelayMs`, `ATTEMPT_FREE_FAILURES = 5`, `ATTEMPT_FIRST_DELAY_MS = 2_000`, `ATTEMPT_DELAY_CAP_MS = 3_600_000` |
| `data/handlers.ts` | Command registration, unlock/lock lifetime, dispose |
| `data/import-handlers.ts` | Port adapters, the channel receiver, fact accumulation, the seven import commands |
| `data/app-session.ts` | Durable roots → projection mapping, `AppSessionRegistry` |
| `data/event-store.ts` | `loadApp`, `openAppKey`, `createEventStore`, `deviceOnlyChangeCount` |
| `data/record-event-payloads.ts` | Both directions of the record payload codec |
| `data/record-handlers.ts` | The ten app commands and the wire↔domain mapping |
| `import.worker.ts` | Sniff → size → refuse, or await the stage and stream facts + source |
| `import/parse-session.ts` | `preflightFile`, `streamFacts`, `streamSource` |

## Attempt delay (CA-05, pinned by AD-5)

Failures 1–5 carry **no** delay; the first delay is **2s at the 6th
consecutive failed attempt**, doubling per further failure to a 1h cap; reset
on success and on worker termination; **never persisted** (D4 — database.md v1
budgets no counter, and the cleartext-budget test proves no persistable counter
API exists). The counter also covers recovery-code attempts and passphrase
re-checks; any success resets it. Unit vector `0,0,0,0,0,2s,4s,…` plus one live
2s observation at `27ba411`; the e2e leg observes the delay at the 6th wrong
attempt.

## Catalog (CA-03, D10 / AD-8, CA-09)

`LocalCatalogV1` is a CBOR map per database.md, sealed with `deflate-raw-v1` in
a single `local.catalog` scope.

- **`validateLocalCatalog` implements database.md checks 1–6 only.** Check 7 is
  not a validator predicate; it is CAP-07's **reset-path obligation**, asserted
  in the handlers (two refusal branches, the drift branch proven with two
  workers over one store) and again in the e2e reset leg. The confirm token *is*
  canonical CBOR of the recomputed inventory; confirm recomputes from storage
  and refuses with `stale-confirmation` on disagreement, purging nothing.
- **The D10 recovery-code view is its own nested envelope**, not wrapped bytes:
  M08 exposes no way to read wrapped bytes back (`readKeyBytes` is internal).
  It is stored as `serializeEnvelopeTransport` bytes inside the catalog
  payload, has self-contained AAD at logical revision `1`, and is copied
  verbatim by later catalog commits. No schema touched; AD-8 holds.
- Setup calibrates with `calibrateKdf(clock)` (floor-enforced) rather than
  taking the floor.
- **CA-09 app entries (F02).** `LocalCatalogAppEntryV1` carries `displayName`,
  `identity: AppIdentityV1 { accentId, glyph }`, `createdAtEpochMs`,
  `lastOpenedAtEpochMs: number | null`, `rowCountCache: number | null`,
  `tableCount`. `APP_ACCENT_IDS` (`leaf | clay | marigold | river | violet`)
  each name a colour that **already exists** in M40's `tokens.css`; the catalog
  stores the *token id*, never a colour value. CA-09's field constraints live in
  a separate `assertAppDisplayMetadata`, so the numbered spec checks and the
  agreement's constraints stay visibly distinct.
- **No legacy-entry decode path exists and none must be added.** `apps` was
  `[]` in every catalog F01 could write, so an entry without these fields has
  no producer; the assumption is recorded as a test comment, not as code.
- **CAP-18 (readable reset).** `inventoryOf` reads `app.displayName` instead of
  echoing `app.appId`, and `deviceOnlyChangeCount` is recomputed from each app's
  **decrypted head frontier** (S05; it was a placeholder `0` at S04). The
  confirm token gained `displayName` and `appHeadStorageId`, so a rename or a
  commit between enumerate and confirm invalidates the token rather than purging
  under a name the user never read. With `apps: []` the token encoding is
  byte-unchanged, so no F01 CA-05/CAP-07 evidence moved.

## Import composition (F02, D17)

- The import worker parses only. Fact batches ride a page-created
  `MessageChannel` to the data worker; inference runs in the data worker over
  accumulated facts; the stage is authoritative for proposal + edits.
- **Backpressure is the control flow.** Each item is sent and awaited, so batch
  `n + 1` cannot be sent before ack `n`; the receiver's order is **encrypt →
  commit → ack**, never the other way (invariant 1).
- **A `MessagePort` must be started.** `addEventListener` — unlike assigning
  `onmessage` — does not start a port implicitly. Missing that turned
  backpressure into a hang; `streamFacts` calls `port.start()`. Any later
  channel inherits this.
- `bootstrap/import-worker.ts` (M53) holds `spawnImportWorker` with the literal
  `new Worker(new URL(...), {type:'module'})` Vite statically analyses, plus
  `createImportWorkerClient`.
- The unlock path runs `sweepStaleImports` **before the session view is
  returned**, so a reload mid-import cannot present a half-existing import;
  `dispose` closes channels.

## App session composition (F02, S05)

- `app-session.ts` maps durable roots → projection. Three decisions: **issues
  are recomputed by the one shared validator and required to agree** with the
  record page's stored verdict (the page has no `messageParameters`; a
  disagreement is an integrity failure); **per-field provenance is empty**,
  because a record page stores none; **`createdCommitId` is the canonically last
  commit the checkpoint's frontier covers**. `validationRules: []` is truthful,
  not a missing producer — F02 has no rule-authoring event. The tail is replayed
  **one commit at a time** so the validator decides each event against the state
  the projection actually holds.
- `event-store.ts` verifies every root's `semanticSha256` and each record page's
  declared count before believing it. One transaction per command: segment + new
  head + new catalog added, superseded head deleted, bootstrap repointed.
  `chainState()` requires the head's frontier and its decoded segments to agree
  and fails closed otherwise. **D27 confirmed in the writer:** one
  `EventSegmentV1` envelope per commit, `semanticSha256` over the commit's own
  hash, `eventSegments` growing by one, `headRevision` monotonic.
- `record-event-payloads.ts` encodes through **M23's own**
  `encodeCellValue`/`decodeCellValue`; field entries are sorted by field id so
  `resultingRecordSha256` hashes a record rather than a spelling.
- `record-handlers.ts`: an app that is not open opens itself; a command whose
  projection disposed itself drops the session so the next request re-hydrates.
- `handlers.ts`: `lock()` and `dispose()` destroy every open projection and app
  key **and** dispose the import handlers — their channel state holds parsed
  plaintext facts (invariant 3).

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — CA-05 wording reconciled by Jikijitsu at `d97aa17` (replan
  finding F-05 → AD-5).
- 2026-09-08 — F01 implemented by SESSION-05 (`27ba411`); proven end-to-end
  through the real `index.html` entry at `9174b6d` / `2c0248a`.
- 2026-09-08 — reconciled by Roshi (F01 final pass): the module path is
  `src/workers/**` (the registry's `src/workers/*.worker.ts` described only the
  entry files, not the leasing unit that shipped); staple merged.
- 2026-09-08 — F02: catalog display metadata + the import worker, channel
  receiver and seven import commands by SESSION-04 (`82c38fc` → `cd74e6d`, incl.
  lease-r2 `978f4ff`); app session, event store and the ten app commands by
  SESSION-05 (`d47b3d2`), where the first worker-tier journey (open → query →
  CRUD → restart) was verified.
- 2026-09-08 — reconciled by Roshi (F02 final pass): both session staples folded,
  including SESSION-04's "Not landed at part 1" list — every item on it landed in
  checkpoints 2–5 and the note is removed rather than left standing; the file
  inventory rewritten as a table of what exists at `5ab3b07`.

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**M33 — Data worker**
- `app-session.ts`: manifest → projection mapped straight through (no hardcoded classification/rules); checkpoint pages validated with a resolver over the pages' own records; tail replayed through `validateAgainstProjection` (live schema, real resolver, provenance rule); `AppSessionV1.openSnapshot(storageId)` (manifest digest vs `head.snapshotManifests`, chunk digest vs manifest ref).
- `record-event-payloads.ts`: `TAIL_EVENT_KINDS`, `isTailEventKind`, `decodeTailEventPayload` (reads promotion's `table.created` with or without `sourceSheet`, `field.created`, `enum.changed`, `inference-decision.recorded`).
- `record-handlers.ts` / `handlers.ts`: the nine new RPCs; `toDomainValue` maps authored `reference`.

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**Tests (M56/M57/M60)**
- `tests/browser/projection/workbook.spec.ts` (CA-20 hydration, restart row-identity, CA-23 tail build, two dispose controls).
- `tests/browser/worker/workbook-app-fixture.ts` seals a synthetic multi-table app through production crypto/store (page-side, runtime is disposed while it runs); `relationships.spec.ts` (CAP-24 journey + restart; CA-22 V2 pages/find/inert); `app.spec.ts` += F02 delimited snapshot read.

<!-- workbook-fidelity SESSION-06 -->
### workbook-fidelity SESSION-06 (2026-09-23, commits 4287569..677b947)

**M33 — Workers (`src/workers/`)**
- NEW `import/adapters.ts`: `WORKBOOK_REGISTRY {readers, adapters}` — xlsx (OOXML), xlsb, xls (BIFF), ods, html-table (D35).
- `import/parse-session.ts`: `preflightFile(file, name, emit, acceptedFlows = ["delimited"], registry)` → `proceed | workbook | refused`; `acceptedSelection(report, selection)`; `streamFacts` (delimited, opened with its sheet fact), `streamWorkbookFacts` (selected sheets via the registry adapter), `openContainer`, one ack-gated `sendItems` loop; progress names every sheet a batch opens; failures carry `detail`.
- `import.worker.ts`: reads `acceptedFlows`, emits `workbook-preflight`, validates `proceed.selectedSheets` (malformed-request otherwise), refuses `selectedSheets` for delimited.
- `data/import-handlers.ts`: workbook stages (inventory + selection validated, D31 budget), existing-app destination for delimited; `runInference` → `inferWorkbook` (delimited via `delimitedStream`, append gets `existingApp.tableNames` + rejection memory); staged facts re-read from the fact chunks (digest-checked) when the channel's copy is incomplete; `applyReviewEdit` → workbook edits; promotion → `promoteImport`, append → `appendTable` then the app session is closed; exports `proposalWire`, `rejectionMemoryOf`, `tailDecisionsOf`, `ImportAppAccessV1`, `RecordedDecisionV1`. `SessionCatalogPort.sealWithAppendedApp`.
- `data/record-handlers.ts`: `appSession(appId)`, `closeAppSession(appId)`; `data/handlers.ts` hands them to the import handlers.

<!-- workbook-fidelity OWNER-PROMOTION-SEAMS -->
### workbook-fidelity OWNER-PROMOTION-SEAMS (2026-09-23, commits cd4fe9d, 0634e81)

**M33 Workers**
- `src/workers/data/import-handlers.ts` exports `rejectedPromotionResponse(result)`.
  Promote and append both use it, so the page always receives `columnKey`.
