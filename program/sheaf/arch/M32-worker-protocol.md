# M32 — Worker protocol (`src/workers/protocol/`)

Extracted from specs/architecture.md §Module Contracts (Workers and RPC).
Reconciled against `d75830d` (F05 partial).

- **Owns:** Thread boundary semantics: versioned typed RPC, correlation,
  cancellation, progress, transfer ownership, error redaction.
- **Runtime dependencies:** M01 and M11 across the module; see the mechanically
  derived [registry](MODULE-REGISTRY.md). `messages.ts` itself imports nothing,
  proved by `tests/unit/workers/module-boundaries.test.ts`.
- **Must not:** carry key bytes, passphrases in responses, or repository
  objects; locked responses expose no decrypted values; errors crossing the
  boundary are redacted via allowlist (CA-04). **Key bytes are type-excluded,
  not merely absent** — the page RPC union in `messages.ts` names no `Uint8Array`, `ArrayBuffer`,
  `Transferable`, port, or key type anywhere, and a grep assertion pins it.
  Import bytes therefore live in `import-messages.ts`, never here. **F04: a
  logo crosses as base64 text** (`AppLogoWireV1.pngBase64`), for the same
  reason — no byte type crosses this contract, ever.

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
- **F04: structure requests (S03).** `getAppStructure`,
  `previewSchemaChange`, `applySchemaChange`, `getAppMetrics`; wire types
  `SchemaChangeWireV1`, `RuleConditionWireV1`, `FormulaTargetWireV1`,
  `AppStructureViewV1` (+ table/field/rule/relationship/formula views),
  `ImpactReportWireV1`, `SchemaRefusalWireV1`, `SchemaPreviewViewV1`,
  `SchemaApplyOutcomeV1`, `MetricViewV1`, `AppMetricsViewV1`.
  `ComputedCellWireV1 {state, code?}`; `CellWireEntryV1.computed?` (additive;
  `CellWireValueV1` **not** widened). `RecalculatedNoticeV1 {fieldIds}` as
  optional `recalculated` on the accepted `RecordCommandOutcomeV1` (always
  sent by the worker). `SchemaChangeWireV1.change-field-type` gains optional
  `optionLabels: readonly string[]` (S06 lease r2, D57's Text → Choice list
  step).
- **F04: query requests (S04).** `QueryRecordsRequestV1` gains optional
  `filters?: FilterWireV1[]`, `sort?: SortWireV1 | null` and `sortCursor?:
  SortCursorWireV1 | null`. `SortCursorWireV1` is `{kind: "none" | "integer" |
  "key"}`, where `key` carries base64url text — no bytes cross the wire.
  `RecordPageViewV1` gains optional `nextSortCursor`, `total` and `partial`
  (`RecordQueryPartialWireV1`). `QueryRecordsResponseV1` gains optional
  `refusal?: FilterRefusalWireV1`, returned with `page: null`. The handler
  NFC-normalizes filter text (D28); a malformed id yields `malformed-request`,
  redacted to its kind.
- **F04: chart requests (S05).** `listCharts`, `getChart`, `saveChart`,
  `setChartPin`, `deleteChart`, `getChartDraft`, `saveChartDraft`,
  `discardChartDraft`, `getChartDataset {source: chart|draft, tableOffset?}`.
  Wire shapes `ChartGroupingWireV1`, `ChartMeasureWireV1`,
  `ChartDefinitionWireV1` (a definition without its id), `ChartViewV1`,
  `ChartDraftViewV1`, `ChartRefusalWireV1`, `ChartCommandOutcomeWireV1`,
  `ChartKeyWireV1`, `ChartMarkWireV1`, `ChartDatasetViewV1`,
  `GetChartDatasetResponseV1`. Still no byte or key type.
- **F04: theme requests (S08).** `listThemePalettes` →
  `ThemePaletteWireV1[]`; `changeTheme {appId, themeKey, mode, density,
  customAccent|null, logo: keep|remove|set(AppLogoWireV1)}` →
  `ThemeOutcomeWireV1` `changed|unchanged|refused(ThemeRefusalWireV1:
  unknown-palette|invalid-accent|logo{unreadable|over-bytes|over-edge}|
  contrast{failures})|unknown-app`. `AppThemeWireV1` v2: optional `mode`,
  `density`, `customAccent`, `darkTokens` (the palette's dark set), `logo:
  AppLogoWireV1 {pngBase64, width, height}`. `LibraryAppV1.themeTile?:
  LibraryThemeTileV1 {primary, label, logo|null}`;
  `AppSessionViewV1.accentId?`/`glyph?` (closes the F02 carry).
- **F04: schema/theme copy correction (S06 lease r2, CP4a `3b7ecfa`).**
  `records.ts`'s `toIssueVm(issue, fields = [])` composes rule-issue sentences
  from the rule's own parameters instead of a generic message (see
  `M37-view-models.md`); `schema.ts`'s `describeChange` names the new choices
  for a `change-field-type` with `optionLabels`; `structure-handlers.ts`
  forwards the wire's `optionLabels` unchanged (below).

Response union `DataWorkerResponseV1` + `ResponseForV1<K>`; views
`UnlockedSessionViewV1`, `LockedSessionViewV1`, `SessionStatusViewV1`,
`LocalSettingsViewV1`, `ResetInventoryViewV1`, `ImportStageViewV1`,
`LibraryAppV1`, `ImportCleanupReceiptViewV1`, `AppSessionViewV1`,
`RecordPageViewV1`, `RecordDetailViewV1`, `ChangeHistoryPageViewV1`, and the
restated proposal shapes.
Error envelope `DataWorkerErrorV1 { kind, retryAfterMs? }` over the closed
`DATA_WORKER_ERROR_KINDS_V1`.
Message envelopes + the `isDataWorker*MessageV1` guards.

### Two contracts the type system holds

- **`DATA_WORKER_ERROR_KINDS_V1` is unchanged across all of F02, F03 and
  F04** (CA-12 deviation from F02, recorded and accepted; D42 reaffirms it —
  no new kind, no new `RefusalV1` kind). Validation failures cross as typed
  **results** carrying the whole `ValidationReport` (D23); absent-stage reads
  answer idempotently; M36 gates every *mutating* stage call on
  `getImportStage` so no caller reaches for a kind that does not exist. The
  union is keyed exhaustively by M37's `REFUSAL_ANNOUNCEMENT`, so extending it
  is a cross-lease change — see PROGRAM-CONFIG's lease conventions. F03's
  plan named the sole extender in advance (`PROMOTION_REJECTIONS` gains
  `append-too-large`, co-leased with `M37`'s `import.ts` by S06) — the closed
  union stayed intact and no cross-lease seam repeated. **F04 needed no new
  member either** — the schema/query/chart/theme refusal families are each
  their own typed result union (`SchemaRefusalV1`, `FilterRefusalWireV1`,
  `ChartRefusalWireV1`, `ThemeRefusalWireV1`), following the D23 pattern
  rather than growing the one shared closed union.
- **`CellWireValueV1` (pinned, F02 S05).** `text` · `number{decimal}` ·
  `boolean` · `option{optionId}` · `date{epochDay}` · `blank` · `missing` ·
  `invalid{sourceText}` · `reference{recordId}` (F03: now **authorable** —
  see above). `AuthoredCellWireValueV1 = Exclude<CellWireValueV1,
  {kind:"invalid"} | {kind:"reference"}>` in F02; F03 lifts the `reference`
  exclusion. D28: authored text is NFC-normalized in the wire→domain mapping,
  silently.

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
`stage-channel.ts` batches are now `WorkbookFactStreamItemV2`. **F04 makes no
further change to this protocol version** — every F04 import-side extension
(formulas, charts, rules) rides the existing fact-stream item vocabulary
(M65) rather than a new protocol shape.

`messages.ts` gains (still import-free, byte-free):
`BeginImportStageRequestV1.detected: DetectedDelimitedV1 | DetectedWorkbookV1`,
`.preflight: ImportPreflightFactsV1 | WorkbookStageFactsV1`, `.destination?:
ImportDestinationWireV1`; `WorkbookFormatWireV1`, `WorkbookSheetSummaryWireV1`;
the CA-19 wire `ProposedWorkbookWireV1` (+ its per-table/sheet/relationship/
rule/statement/evidence wire families, F04-extended with formula/chart
families) and `WorkbookReviewEditWireV1`;
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

## Durable-home implementation (F05, current)

DataWorkerClient.prepareBundle uses a separate ioVersion=1 attach message and two transferred ports; messages.ts remains byte-free. The worker-to-worker channel has sequential acknowledgements, refusal/timeout/abort handling. The page control channel binds operation/app/home/artifact hash, accepts one completion, and rejects mismatches/replays. io-client accepts only exact artifact/ready/completed shapes and owns termination/disposal.

Source: S01 `694c741` / `13e83f1` / `8674766`, S02 `03ee571` / `c7e6507` / `d75830d` (as applicable to this module); F05 STATE at `95a539d` and Final Report. Scope and remaining owners: [F05 boundaries](F05-boundaries.md).

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
- 2026-09-23 — F04: structure/query requests + computed-cell wire by SESSION-03
  (`a69e6e0`..`2235cce`); query filter/sort/partial requests by SESSION-04
  (`f736fa8`..`27a2667`); chart requests by SESSION-05 (`6ee204c`..`3dd1d2d`);
  the `optionLabels`/`toIssueVm`/`describeChange` correction by SESSION-06
  lease r2 (`3b7ecfa`); theme requests by SESSION-08 (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): five SESSION deltas
  folded into the `messages.ts` section in landing order; the closed-error-kind
  paragraph extended with F04's own zero-new-instance evidence (four new
  request families, each given its own typed refusal union rather than
  growing `DATA_WORKER_ERROR_KINDS_V1`); the SESSION-07 pointer (recorded
  jointly in `M01-domain-model.md`) left as a one-line cross-reference rather
  than restated.
- 2026-09-24 — F05 final reconciliation: folded received deltas into the current contract; S02 remains incomplete.


<!-- durable-home-backup SESSION-02 CP3 a93a87c -->
## M32 / M53 — CP3 save lifetime
prepareBundle optionally reports disposal to its owner. AppRuntime.saveBundle(appId, interaction?) keeps a verified delivered operation alive until explicit confirmation, dismissal, timeout, replacement or teardown. The worker's existing operation/app/home/artifact correlation and atomic receipt transaction remain authoritative. Native picker activation still precedes asynchronous preparation.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M32 / M33 — worker protocol and authenticated readers

`createBundleHome` and `revealVaultRecoveryCode` are mounted typed RPCs. Reuse verifies the current local secret again; neither plaintext passphrase is retained. Local and vault recovery codes retain independent scopes. `AppDurabilityViewV1` carries authenticated home identity/name, app-scoped confirmation time and receipt-relative pending count. `readAppDurability` reads the durable head and matching HomeState receipt for open and closed apps; missing or ahead-of-local facts fail closed. Pending count sums uncovered commits across every locally held device frontier and rejects any receipt frontier absent from or ahead of the local head. Absolute device sequence and chainState are unchanged. `listLibrary`, `toSessionView`, and reset `inventoryOf` consume the same reader. Reset rows now require `confirmedAtMs: number | null`; reset confirmation remains bound to the current durable transaction.

`refreshBackupContext` authenticates the latest bootstrap/catalog before save completion, preserving a concurrent newer edit as pending while rejecting writer-epoch or session replacement. `connectBundle` releases its own pin after a graceful cancellation when the same session is still available. Lock, process termination or failed cleanup conservatively retain encrypted pins; existing `exportGraph` and `release` recover/release them after unlock without inferring completion or pruning another operation. No blind startup sweep or age-based retention rule is introduced.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.


<!-- durable-home-backup SESSION-03 r3 -->
## M32 — worker protocol

`SchemaApplyOutcomeV1` adds `unchanged {schemaRevision}`. New requests `getScratchReminder {appId}` and `dismissScratchReminder {appId, homeId, triggeringCommitId, dismissalCount}`. Both return nullable `ScratchReminderViewV1 {appId, homeId, triggeringCommitId, dismissalCount, nextEligibleAtEpochMs, eligible, deviceOnlyChangeCount}`; dismissal additionally returns `dismissed | stale`. No test-only opcode, key bytes or authority claim is introduced.


Independent receive at47a633b: typecheck/lint exit0;223files/2461unit pass/3inherited skips; exact combined current-build browser gate11pass/0skip/0retry. Original full e2e81pass is Coder-run, source-identical evidence reviewed; focused composed gates independently rerun. S06/S07 future graph/provider proofs remain owned.
