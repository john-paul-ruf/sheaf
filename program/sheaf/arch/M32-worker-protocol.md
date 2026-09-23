# M32 — Worker protocol (`src/workers/protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

- **Owns:** Thread boundary semantics: versioned typed RPC, correlation,
  cancellation, progress, transfer ownership, error redaction.
- **Depends on:** M01 safe types only — `messages.ts` in fact imports nothing
  at all, proved by `tests/unit/workers/module-boundaries.test.ts`.
- **Must not:** carry key bytes, passphrases in responses, or repository
  objects; locked responses expose no decrypted values; errors crossing the
  boundary are redacted via allowlist (CA-04). **Key bytes are type-excluded,
  not merely absent** — the union names no `Uint8Array`, `ArrayBuffer`,
  `Transferable`, port, or key type anywhere, and a grep assertion pins it.
  Import bytes therefore live in `import-messages.ts`, never here.

## Files

| File | Holds |
|---|---|
| `messages.ts` | The page ↔ data-worker wire contract. Imports nothing. |
| `client.ts` | `DataWorkerClient`, correlation, timeouts, terminate |
| `redact.ts` | `DataWorkerCommandError`, `redactError` |
| `import-messages.ts` | The page ↔ import-worker contract, where byte payloads live |
| `import-client.ts` | `ImportWorkerClient` (spawn-on-demand, events, transfer, terminate) |
| `stage-channel.ts` | The worker↔worker fact channel |

## `messages.ts` — the data-worker contract (landed)

- `PROTOCOL_VERSION = 1`.
- `IDLE_TIMEOUT_MINUTES_V1 = [0,5,15,60]` + `IdleTimeoutMinutesV1` +
  `isIdleTimeoutMinutesV1`.
- **Session requests (F01):** `setup`, `unlock`, `unlockWithRecoveryCode`,
  `changePassphrase`, `revealRecoveryCode`, `lock`,
  `updateSettings{idleTimeoutMinutes: 0|5|15|60}`, `resetLocked`,
  `resetReadable`, `getStatus`.
- **Import requests (F02):** `beginImportStage{fileName, detected, preflight}`
  → `{stageId}` · `getImportStage{stageId}` → `{stage|null}` (idempotent) ·
  `runInference{stageId}` → `{proposal}` · `applyReviewEdit{stageId, edit}` →
  `applied{proposal} | rejected{reason}` · `promoteImport{stageId,
  acceptedName}` → `promoted{appId, rowCount, tableCount,
  flaggedRecordCount} | rejected{reason, issues[]}` · `listLibrary{}` →
  `{apps: LibraryAppV1[]}` · `cancelImportStage{stageId}` →
  `{receipt{reason, deletedCount, completed:true}}` (idempotent).
- **App requests (F02):** `openApp`, `closeApp`, `noteAppOpened`,
  `queryRecords`, `getRecord`, `createRecord`/`patchRecord`/`deleteRecord`/
  `restoreRecord`, `getChangeHistory`.
- **F03: additive app requests.** `getRelatedRecords`, `getRelatedChildren`,
  `searchReferenceCandidates`, `getDeletedRecord`, `listTables{appId}`,
  `listSheetSnapshots`, `getSnapshotPage`, `findInSnapshot`,
  `listInertItems`. `RecordDetailViewV1.references?`,
  `ChangeHistoryEntryViewV1.tableId?`.
  `AuthoredCellWireValueV1` now admits `reference` (still excludes
  `invalid`).
- Response union `DataWorkerResponseV1` + `ResponseForV1<K>`; views
  `UnlockedSessionViewV1`, `LockedSessionViewV1`, `SessionStatusViewV1`,
  `LocalSettingsViewV1`, `ResetInventoryViewV1`, `ImportStageViewV1`,
  `LibraryAppV1`, `ImportCleanupReceiptViewV1`, `AppSessionViewV1`,
  `RecordPageViewV1`, `RecordDetailViewV1`, `ChangeHistoryPageViewV1`, and the
  restated proposal shapes.
- Error envelope `DataWorkerErrorV1 { kind, retryAfterMs? }` over the closed
  `DATA_WORKER_ERROR_KINDS_V1`.
- Message envelopes + the `isDataWorker*MessageV1` guards.

### Two contracts the type system holds

- **`DATA_WORKER_ERROR_KINDS_V1` is unchanged across all of F02 and F03**
  (CA-12 deviation from F02, recorded and accepted; D42 reaffirms it for F03
  — no new kind, no new `RefusalV1` kind). Validation failures cross as typed
  **results** carrying the whole `ValidationReport` (D23); absent-stage reads
  answer idempotently; M36 gates every *mutating* stage call on
  `getImportStage` so no caller reaches for a kind that does not exist. The
  union is keyed exhaustively by M37's `REFUSAL_ANNOUNCEMENT`, so extending it
  is a cross-lease change — see PROGRAM-CONFIG's lease conventions. F03's
  plan named the sole extender in advance (`PROMOTION_REJECTIONS` gains
  `append-too-large`, co-leased with `M37`'s `import.ts` by S06) — the closed
  union stayed intact and no cross-lease seam repeated.
- **`CellWireValueV1` (pinned, F02 S05).** `text` · `number{decimal}` ·
  `boolean` · `option{optionId}` · `date{epochDay}` · `blank` · `missing` ·
  `invalid{sourceText}` · `reference{recordId}` (F03: now **authorable** —
  see above). `AuthoredCellWireValueV1 = Exclude<CellWireValueV1,
  {kind:"invalid"} | {kind:"reference"}>` in F02; F03 lifts the `reference`
  exclusion (D25's type-exclusion of authored references is deliberately
  narrowed to `invalid` only, now that CAP-24's reference picker exists). D28:
  authored text is NFC-normalized in the wire→domain mapping, silently.

The proposal shapes are restated structurally rather than imported, and
`tests/unit/workers/proposal-wire.test.ts` pins them mutually assignable with
M21's proposal types at compile time.

## Import protocol and the stage channel

- `import-messages.ts` → `ImportWorkerRequestV1` (`startImport{file,
  fileName}` carrying `port1` in its transfer list, `proceed{stageId}`,
  `cancelImport`) and `ImportWorkerEventV1` (`progress`, `preflight`,
  `refused`, `completed`, `cancelled`, `failed{parse-failed|stage-rejected|
  malformed-request}`). Byte payloads live here, never in `messages.ts`.
- `stage-channel.ts` → `STAGE_CHANNEL_VERSION = 1`, inbound `{seq, batch} |
  {seq, sequence, bytes} | {abort}`, outbound `{ackSeq}` ack/nack.

**F03: additive, `IMPORT_PROTOCOL_VERSION` still 1.** `IMPORT_FLOWS_V1`/
`ImportFlowV1`; `StartImportRequestV1.acceptedFlows?` (default `["delimited"]`
— a page must opt in to receive a workbook rather than
`workbook-format-later-release`, D48); `ProceedImportRequestV1.selectedSheets?`;
`ImportProgressEventV1.sheetOrdinal?/sheetCount?/sheetName?`;
`ImportWorkbookPreflightEventV1`; `ImportFailedEventV1.detail?:
ImportFailureDetailV1 {stage: container|sheet-stream|stage, sheetOrdinal|null,
diagnostic: UnreadableDetailV1|"parse-failed"}`, `IMPORT_FAILURE_STAGES_V1`.
`stage-channel.ts` batches are now `WorkbookFactStreamItemV2`.

`messages.ts` gains (still import-free, byte-free):
`BeginImportStageRequestV1.detected: DetectedDelimitedV1 | DetectedWorkbookV1`,
`.preflight: ImportPreflightFactsV1 | WorkbookStageFactsV1`, `.destination?:
ImportDestinationWireV1`; `WorkbookFormatWireV1`, `WorkbookSheetSummaryWireV1`;
the CA-19 wire `ProposedWorkbookWireV1` (+ its per-table/sheet/relationship/
rule/statement/evidence wire families) and `WorkbookReviewEditWireV1`;
`RunInferenceResponseV1.proposal`/`ApplyReviewEditResponseV1.proposal` are the
workbook wire; `ApplyReviewEditRequestV1.edit` is
`WorkbookReviewEditWireV1`. F02's `ProposedAppWireV1`/`ReviewEditWireV1`
remain (the page's one-table view, derived from the workbook wire by M36's
`singleTableProposal`).

`PromoteImportResponseV1` rejected `issues[]` gain `columnKey?: string | null`
(OWNER-PROMOTION-SEAMS `0634e81`): the reviewed column, `null` for a
record-level issue, absent from an F02-era producer.

**D17 as landed.** The page creates the `MessageChannel`, transfers `port2` in
`beginImportStage`'s request and `port1` in `startImport`'s. **No response ever
carries a port.**

## Client

`client.ts` → `DataWorkerClient` (correlation ids, per-request timeout,
`transfer` list, `terminate()` failing everything in flight, `isRunning`),
`DataWorkerRequestError`, `DEFAULT_REQUEST_TIMEOUT_MS = 60_000`.

`redact.ts` → `DataWorkerCommandError(kind, {retryAfterMs?})` and
`redactError(cause)`. No error message ever crosses the boundary.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-05 F01 (`27ba411`). `updateSettings` is
  new against the seeded contract (replan finding F-02 / D13 / AD-7).
- 2026-09-08 — CA-04's UI leg closed by SESSION-07 F01 (`9174b6d`, re-run at
  `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): head request union
  corrected to include `updateSettings`; staple merged.
- 2026-09-08 — F02: import protocol, stage channel and the seven import
  commands by SESSION-04 (`cd74e6d`); the ten app commands and
  `CellWireValueV1` by SESSION-05 (`d47b3d2`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): both session staples folded;
  the head's "`messages.ts` is the whole wire contract" corrected — the module is
  six files and the byte-carrying half is deliberately a different one; the
  closed-error-kind deviation stated where a future extender will read it.
- 2026-09-23 — F03: additive app requests + `AuthoredCellWireValueV1`
  reference admission by SESSION-03 (`f29ac33`..`a2c4cf0`); import-protocol v2
  by SESSION-06 (`4287569`..`677b947`); `columnKey` by OWNER-PROMOTION-SEAMS
  (`cd4fe9d`, `0634e81`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three staples folded
  into the `messages.ts` section, the "two contracts" paragraph, and the
  import-protocol section; the closed-union note updated to record that F03's
  plan pre-named the sole extender (co-leased), which is why the pattern that
  bit F02 twice did not recur here.

<!-- formulas-queries-charts SESSION-03 -->
### F04 delta — SESSION-03 (M32 — Protocol (`src/workers/protocol/messages.ts`))

- `ComputedCellWireV1 { state, code? }`; `CellWireEntryV1.computed?` (additive; `CellWireValueV1` **not** widened).
- `RecalculatedNoticeV1 { fieldIds }` as optional `recalculated` on the accepted `RecordCommandOutcomeV1` (always sent by the worker).
- Requests `getAppStructure`, `previewSchemaChange`, `applySchemaChange`, `getAppMetrics`; wire types `SchemaChangeWireV1`, `RuleConditionWireV1`, `FormulaTargetWireV1`, `AppStructureViewV1` (+ table/field/rule/relationship/formula views), `ImpactReportWireV1`, `SchemaRefusalWireV1`, `SchemaPreviewViewV1`, `SchemaApplyOutcomeV1`, `MetricViewV1`, `AppMetricsViewV1`. Still no byte type and no import in the file.

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M32/M33 Worker protocol and record handlers)

- `QueryRecordsRequestV1` gains optional `filters?: FilterWireV1[]`, `sort?: SortWireV1 | null` and `sortCursor?: SortCursorWireV1 | null`. `SortCursorWireV1` is `{kind: "none" | "integer" | "key"}`, where `key` carries base64url text; no bytes cross the wire.
- `RecordPageViewV1` gains optional `nextSortCursor`, `total` and `partial` (`RecordQueryPartialWireV1`).
- `QueryRecordsResponseV1` gains optional `refusal?: FilterRefusalWireV1`, returned with `page: null`.
- The handler NFC-normalizes filter text (D28). A malformed id yields `malformed-request` and is redacted to its kind.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M32 protocol — `src/workers/protocol/messages.ts`)

- Requests: `listCharts` (L690), `getChart` (L695), `saveChart` (L705), `setChartPin` (L714), `deleteChart` (L722), `getChartDraft` (L730), `saveChartDraft` (L736), `discardChartDraft` (L742), `getChartDataset {source: chart|draft, tableOffset?}` (L751). Wire shapes `ChartGroupingWireV1` (L649), `ChartMeasureWireV1` (L659), `ChartDefinitionWireV1` (L676, a definition without its id), `ChartViewV1` (L2257), `ChartDraftViewV1` (L2269), `ChartRefusalWireV1` (L2276), `ChartCommandOutcomeWireV1` (L2292), `ChartKeyWireV1` (L2348), `ChartMarkWireV1` (L2355), `ChartDatasetViewV1` (L2376), `GetChartDatasetResponseV1` (L2402). Still no byte or key type.


<!-- formulas-queries-charts SESSION-07 -->
### F04 delta — SESSION-07 (pointer)

The SESSION-07 delta for this module is recorded jointly in `arch/M01-domain-model.md` under the same marker (CA-33 reason keys, live-structure promotion, import review).
