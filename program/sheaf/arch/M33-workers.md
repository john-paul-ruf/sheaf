# M33 — Worker entries (`src/workers/**`, minus `protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC) +
§Runtime Topology. Reconciled against production `47a633b` plus S06 compaction
through `2d8ff2d` (F05 continuation; S01/S02/S03/S06 accepted, S04/S05/S07
blocked on provider inputs).

- **Owns:** Per-worker composition roots and key confinement.
- **Landed scope:** `data.worker.ts` (sole owner of the main IndexedDB
  database and of every unlocked key handle) and `import.worker.ts` (parse
  only, every accepted format), and `io.worker.ts` (F05 ciphertext bundle
  receiver). `export.worker` (F07) does not exist yet.
- **Runtime dependencies:** M01, M02, M05, M08–M24 where listed in the
  [current registry](MODULE-REGISTRY.md), M27, M32, M34 and M35. The registry
  derives each edge from source; M65 vocabulary is type-only in this module.
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
| `data/catalog.ts` | `LocalCatalogV1` + entry types, `buildLocalCatalog`, `encodeLocalCatalog`, `decodeLocalCatalog`, `validateLocalCatalog`, `withIdleTimeout`, `idleTimeoutMinutes`, `CATALOG_VERSION`, `APP_ACCENT_IDS`, `AppIdentityV1`; (F04) app entry `chartDraft?: Uint8Array` and the `themeTile` cache; (F05, S06) `withCompactedApp` |
| `data/session.ts` | `WorkerSession`, `AttemptDelay`, `attemptDelayMs`, `ATTEMPT_FREE_FAILURES = 5`, `ATTEMPT_FIRST_DELAY_MS = 2_000`, `ATTEMPT_DELAY_CAP_MS = 3_600_000` |
| `data/handlers.ts` | Command registration, unlock/lock lifetime, dispose; (F03) hands `appSession`/`closeAppSession` to the import handlers; (F05, S06) composes and owns the one compaction scheduler's lifecycle — see "S06 compaction", below |
| `data/import-handlers.ts` | Port adapters, the channel receiver, fact accumulation, the import commands (F03: workbook stages, `runInference`/`applyReviewEdit`/promotion/append over every format; F04: refreshes formulas after rejection memory, proposal wire carries formulas/charts/rules); (F05, S06) exports `SessionCatalogPort` (+ `sealWithCompactedApp`), and promotion/cancel/unlock-sweep cleanup now consults reachability |
| `data/app-session.ts` | Durable roots → projection mapping, `AppSessionRegistry`; (F03) `appSession(appId)`, `closeAppSession(appId)`; (F04) `localClockReading(clock)`, tail replay through the command layer's `projectionRevalidator`; (F05, S06) V2 (or evidence-bearing) heads hydrate through the authenticated graph projection, V1 path unchanged |
| `data/event-store.ts` | `loadApp`, `openAppKey`, `createEventStore`, `deviceOnlyChangeCount`; (F04) the head's `schemaRevision` now advances with `commit.schemaRevisionAfter`; (F05, S06) `loadApp` of a V2 head returns every original commit (from audit) so `chainState` continues the original chain |
| `data/record-event-payloads.ts` | Both directions of the record payload codec, incl. (F03) tail decoders, (F04) every schema/rule/formula/chart tail kind and the optional fourth `evidence: {frozen}` provenance key; (F05, S06) `decodeEvidenceEventPayload`/`isEvidenceEventKind` for the original conflict/audit event kinds |
| `data/record-handlers.ts` | The app commands and the wire↔domain mapping, incl. (F03) the nine relationship/snapshot RPCs, (F04) `recalculated` on every accepted command, computed-cell mapping, `refreshVolatile` before reads, `toDomainFilter` |
| `data/structure-handlers.ts` (F04, new) | The four schema/metrics RPCs; wire↔domain; definition digests over M23's canonical encoders + M08 SHA-256; the relationship-removal fingerprint via M21's `workbookFingerprintInput`; per-event payload size for D38; local-time formula clock; forwards `optionLabels` (lease r2) |
| `data/schema-event-payloads.ts` (F04, new) | The F04 schema payload codec, exact keys; `encodeTableDefinition` |
| `data/chart-handlers.ts` (F04, new) | The nine chart RPCs; wire↔domain mapping; drafts |
| `data/chart-event-payloads.ts` (F04, new) | `chart.saved`/`chart.deleted` codec over M23's definition codec, refusing a payload whose name/pin/id disagree with its definition |
| `data/theme-handlers.ts` (F04, new) | `listThemePalettes`, `changeTheme` (authored `theme.changed` through `executeCommand`; updates the catalog's `themeTile` cache on the same path as `noteAppOpened`), `toThemeWire`, `toThemeTileWire`, `themeTileOf` |
| `data/backup-graph.ts` (F05) | Authenticated descendant extraction and current-graph reconstruction (S02); (F05, S06) V2 traversal with owning-context reconciliation, historical head authentication and original-chain reconstruction — `openBackupGraphProjection(graph, signal, clock?)`, `originalGraphCommits(graph, signal)` |
| `data/compaction.ts` (F05, S06, new) | `prepareCompaction` (candidate + authored/history/evidence equivalence), `compactApp` (atomic head/catalog/ticket CAS, optional `exclusive` swap), `drainCompactionCleanup`, `postCheckpointCommitCount`, `CompactionGate`, `createCompactionScheduler`; `COMPACTION_TAIL_THRESHOLD = 128` post-checkpoint commits, `COMPACTION_INTERVAL_MS = 1500` — see "S06 compaction", below |
| `import.worker.ts` | Sniff → size → refuse, or await the stage and stream facts + source (F03: reads `acceptedFlows`, emits `workbook-preflight`, validates `selectedSheets`) |
| `import/parse-session.ts` | `preflightFile`, `streamFacts`, `streamSource`, (F03) `streamWorkbookFacts` |
| `import/adapters.ts` (F03) | `WORKBOOK_REGISTRY {readers, adapters}` — xlsx (OOXML), xlsb, xls (BIFF), ods, html-table (D35) |

File count: 23 (3 top-level workers + 17 `data/` + 2 `import/` + 1 `io/`;
`compaction.ts` is the one S06 addition, `data/` was 16 before it).

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
  app key **and** dispose the import handlers (F05, S06: and stop the
  compaction scheduler — see below).

## Durable-home implementation (F05, current)

`createDataWorkerHandler` composes backup handlers from envelope store, crypto, ClockPort, current session and vault crypto. Mounted typed RPC creates a bundle home and reveals its separate recovery code; reuse verifies the local secret again. `home-state.ts` encrypts independent vault bootstrap/recovery material, locally protected vault key, app-key wraps, pins and app-scoped receipts. Assignment atomically updates home/catalog with its authored event, clears scratch reminder state and invents no successful-backup time.

`AppEventStoreV1.appendHome` atomically commits assignment, new head, app-key wrap/home state and catalog under the current app/head/session revision. Superseded home envelopes are removed in that transaction; the tail codec checks assignment payload and wrap version. `pin` records the authenticated head before returning. `release` preserves current heads, peer pins and retained app roots, deleting only an otherwise retired head atomically with its pin update. Pins survive restart separately from import workflow/cleanup tickets.

`readAppHead` avoids eager graph loading during pin/release. `backup-graph.ts` authenticates every supported current-producer descendant and covered commit chain, retains the pinned source head, and independently reconstructs canonical authored state in SQLite. It rejects unsupported nonempty retained/conflict/audit roots without publication or cleanup — **this V1-current rejection is now closed for supported roots by S06's V2 traversal, below**; only genuinely unsupported/malformed roots still reject. Exported keys/cursors have owned cancellation, error, release, lock, reset and replacement lifetimes; release cancels readers before dropping their retention roots. Event-store and import append consult the same durable pin decision.

`io.worker.ts` composes `receiveBundle`, holds ciphertext Blob parts and offers output only after second-pass verification; it has no key/store/projection path. `connectBundle` composes pin, graph, publication and transport. A correlated native or explicit post-delivery saved completion refreshes/authenticates the current catalog, checks session/epoch/app/home/artifact, frontier bounds and nonregression, and atomically records captured frontier/time with its own pin release. Newer edits remain pending. Valid non-saved completion and same-session graceful abort release their own pin. Lock, process termination or failed cleanup conservatively retain encrypted pins for `exportGraph`/`release` after unlock; no startup sweep, revived confirmation authority or peer-pin pruning is implied. F06 owns future recovery/adoption UI.

`readAppDurability` authenticates current app head and matching HomeState receipt for library, app session and reset inventory. `pendingChangeCount` sums uncovered sequences across every locally held device frontier and refuses absent/ahead-of-local confirmed entries. Absolute per-device chain sequence remains separate. Optional receipts remain backward-readable for pre-receipt homes.

M27's `openBundle` supplies a vault-only opaque app key and bounded frame reader. `recoverBackupGraph` follows its authenticated retained head, compares roots/frontier/padded size and reconstructed authored digest without local root/catalog/storage. This is current artifact recovery, **now extended to the nonempty V2 graph** by S06 (below); F06 adoption still remains future work.

`AppSessionRegistry.open(appId, hydrate)` shares an in-flight hydration; close/dispose invalidate late results and dispose them instead of installing them. Failed opens are removed for a fresh request, `withApp` cleans failed keys, and overlapping `noteAppOpened` calls share one operational catalog write. Correction `823012b` closes the r9 disposed-projection/revision-conflict counterexample exposed by asynchronous receipt reads; it does not weaken cross-worker stale-write guards.

`createEventStore.append` puts the latest authored triggering commit into the existing encrypted catalog in the same transaction. Import/reconciliation commits count for backup but do not prompt; dismissal progression survives later authored edits. Reminder query/dismiss refresh current context. Dismissal compares app/home/trigger/count/eligibility, uses worker time and writes encrypted operational state without an event. `handlers.ts` imports M05 policy at runtime. `getRecord` derives preserved-value source copy from projected provenance when present; legacy imports are not assigned invented provenance.

### S06 compaction (CA-35/36/41, CAP-44, current)

**`backup-graph.ts`:** V2 traversal walks every declared local historical head
edge recursively (identical children dedup, cycle/alias-conflict rejection),
authenticates historical heads in their own context (a current-checkpoint
snapshot lookup uses the root head; a historical head needs its own), and
reconstructs the original commit chain from `AuditPageV1`/`CommitEvidenceRefV1`
rather than the tail alone. `openBackupGraphProjection(graph, signal, clock?)`
and `originalGraphCommits(graph, signal)` are the exported entry points M12's
`checkpoint-export.ts`/`evidence-events.ts` compose against (see
`M12-projection.md`). Global traversed `baselineCount` does not size the
selected head's baseline stream — retained history is not additional current
rows.

**`event-store.ts`:** `loadApp` of a V2 head now returns every original commit
(sourced from the audit pages), so `chainState` continues the **original**
chain rather than restarting from the compacted tail — this is what lets an
ordinary edit or an appended import after compaction produce the correct next
sequence/hash without re-deriving history the compaction already proved.

**`app-session.ts`:** V2 (or evidence-bearing) heads hydrate through the
authenticated graph projection above; the V1 path is byte-for-byte unchanged,
so an app that has never compacted takes exactly its pre-F05 route.

**`compaction.ts` (new file — see "Landed structure", above):**
`prepareCompaction` builds a candidate and proves authored/history/evidence
equivalence against the original graph before anything is written;
`compactApp` performs the atomic head/catalog/ticket CAS (an optional
`exclusive` swap variant); `drainCompactionCleanup` retires the superseded
head's now-unreachable objects under the same reachability check
`isBackupHeadPinned` uses (below); `postCheckpointCommitCount` is the pure
counter the gate/scheduler read. `CompactionGate` and
`createCompactionScheduler` implement `COMPACTION_TAIL_THRESHOLD = 128`
post-checkpoint commits, checked every `COMPACTION_INTERVAL_MS = 1500` ms —
these are `DEC-73`'s reversible defaults, not a protocol or retention-policy
change (`DEC-74`: no remote garbage collection or age-based baseline
pruning — S06 retains every reachable root).

**`handlers.ts`:** `createDataWorkerHandler` composes **one** scheduler,
started on setup/unlock and stopped on lock/reset/dispose. Every `handle()`
call and `backup.connectBundle` transfer runs through the gate; commands only
wait while an already-started swap or its cleanup commits — compaction never
blocks on an unrelated app, and a save is acknowledged before background
compaction starts (per CAP-44's action trace). `DataWorkerDependencies.
compaction` (threshold/interval/timers) exists for component tests only; no
new protocol message was added to carry it.

**`catalog.ts` / `import-handlers.ts` / `home-state.ts` / `backup-handlers.ts`:**
`catalog.ts` adds `withCompactedApp`; `import-handlers.ts` exports
`SessionCatalogPort` (+ `sealWithCompactedApp`), and promotion/cancel/
unlock-sweep cleanup now consults reachability instead of deleting
unconditionally; `home-state.ts` adds `reachableAppObjects` (current heads +
every durable pin's closure), which `isBackupHeadPinned` now uses instead of a
single-head check; `backup-handlers.ts`'s pin-release path tickets unreachable
closure objects for the cleanup drain above rather than deleting them inline.

Independent receive at `2d8ff2d`: typecheck/lint exit 0; full unit 229
files/2520 pass/3 inherited skips; CP1+installed gate 39 files/473 pass;
browser J3 2/2 (real periodic 128-tail production-timer compaction, two real
compactions, same-context restart, retained-history restore, V2 edit+append,
vault-only oracle equivalence for every artifact — 127/V1 → 128/V1 → V2 cp129
→ V2 cp257), sync/compaction+bundle 3/3, J1/append/status/records/gate-f02/
import-journey 18/18 (port 8081, fresh build). CP1 intermittent counterexample
closed `7e785e4`: the fixture chose a random demo row that sometimes carried
validation warnings while hard-coding an empty report; production's refusal
was correct and is unchanged — the test now covers clean and pinned-warned
subjects with shared-validator reports plus an empty-report negative control.
Real-browser quota refusal is proven **component-level only** (Chromium
ignores the CDP quota override); carried as final-report debt to S07's
J6/security harness, not a gap in this module. Perf follow-up (not a defect,
carried to S07/F06 owner review): `isBackupHeadPinned` exports the full graphs
of other roots and pins on every edit.

Source: production `47a633b`, S06 `084ecf9` (+ correction `7e785e4`) through `2d8ff2d`, current STATE at `9d72cf7`/Final Report `53f7c73`; [F05 boundaries](F05-boundaries.md) records proof limits and owners.

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
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.
- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
- 2026-09-25 — S06 compaction (CAP-44) landed the V2 backup-graph traversal,
  `data/compaction.ts` (new file, count 22 → 23), the one worker-owned
  scheduler and the reachability-based cleanup path (`084ecf9`, counterexample
  closed `7e785e4`, through `2d8ff2d`), independently verified. Folded into
  "Landed structure" and a new "S06 compaction" subsection rather than left as
  a stapled delta (Principle 2).
