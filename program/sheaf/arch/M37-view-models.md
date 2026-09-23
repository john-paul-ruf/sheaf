# M37 — View models (`src/application/view-models/`)

Extracted from specs/architecture.md §Module Contracts (View models).
Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

- **Owns:** Minimum-data projections for approved surfaces + announcements.
- **Depends on:** M36 (machine snapshot types + the ordering and phrase
  constants), M32 protocol **types only**, M51 `CapabilityReport` **type
  only**. No runtime import from `src/workers/**`; asserted by
  `tests/unit/workflows/module-boundaries.test.ts`.
- **Must not:** include app names/counts/backup times/silhouettes in any
  locked-state VM — the *types* forbid the fields, not just the values; ask for
  "your passphrase" unqualified (exact-secret scope strings live in the VM per
  design.md §Content Patterns).

## Files (landed at `30396a9`)

`security.ts`, `library.ts`, `import.ts`, `records.ts`. **There is no
`snapshots.ts`.** F03's S08 planned one in its Files table; the snapshot view
models it needed (`selectSnapshotsListVm`, `selectSnapshotViewerVm`,
`selectSnapshotOptionsVm`, `toSnapshotFindVm`, and their supporting types) all
turned out to belong beside the records VMs they read alongside
(`src/application/view-models/records.ts`), so they were added there instead
and the file was never created — a real structural finding disclosed under
Custom Rule 7's mirror case (a planned file that a checkpoint's own proof did
not need), not an omission. `tests/unit/view-models/snapshots.test.ts` imports
from `records.ts`.

### `security.ts` (F01)

`selectWelcomeVm(report)` (SCR-001, incl. the CAP-08 `unsupported` variant),
`selectSetupVm`, `selectUnlockVm`, `selectRecoveryVm`,
`selectSecuritySettingsVm`, `selectPassphraseChangeVm`, `selectRevealCodeVm`,
`selectResetVm` — each taking the corresponding machine snapshot — plus
`ErrorVm` / `toErrorVm` / `announceRefusal`, `IDLE_TIMEOUT_OPTION_VMS`,
`REFUSAL_ANNOUNCEMENT`, and the scope constants `LOCAL_PASSPHRASE_SCOPE`,
`CURRENT_LOCAL_PASSPHRASE_SCOPE`, `NEW_LOCAL_PASSPHRASE_SCOPE`,
`LOCAL_RECOVERY_CODE_SCOPE`, `LOCAL_RECOVERY_CODE_REACH`.

`REFUSAL_ANNOUNCEMENT` is `Readonly<Record<DataWorkerErrorKindV1, string>>` —
an **exhaustive map over M32's closed union**. Any new error kind breaks this
file, so the union and this map are one change, not two, and belong in one
lease (PROGRAM-CONFIG's closed-union convention). F03 added no
`DATA_WORKER_ERROR_KINDS_V1` member (D42), so this map is unchanged.

### `library.ts` (F01, reworked F02, extended F03)

`selectLibraryVm(apps, searchQuery?)` → `LibraryVm = EmptyLibraryVm |
PopulatedLibraryVm`; `LibraryTileVm`, `LibraryTileStatusV1`,
`LibrarySearchScopeV1`, `LibraryActionIntent`; `selectEmptyLibraryVm()`.
`LibraryActionVm` is a union: the enabled variant carries `intent`, the
disabled one carries `reason`, and neither has the other's field. F03 adds
`AppChoiceVm` and `selectAppChoices(apps, selectedAppId)` (SCR-017's "which
app" destination list for CSV/TSV append, CAP-26).

### `import.ts` (F02, rewritten multi-table for F03)

`selectImportVm(snapshot)` → `ImportVm` (`UploadLandingVm`,
`DelimitedTargetVm`, `WorkbookPreflightVm`, `ImportProgressVm`,
`ImportRefusedVm`, `ImportEndedVm`, `ImportReviewVm`, `ImportDoneVm`), plus
`ImportRowCountVm`, `ImportCleanupVm`, `ReviewSectionVm`, `ReviewFieldVm`,
`ReviewStatementVm`, `ImportPromotionConfirmVm`,
`REVIEW_EDIT_REJECTION_TOKENS`, `toReviewEditRejectionVm`.

**F03 shape (multi-table, replacing the F02 single-table forms in the same
file — additive at the wire, rewritten at the VM):**

- SCR-016: `AcceptedFormatGroupVm` loses `availability`.
- SCR-017: destinations carry `isSelected` and `reason:
  "listing-local-apps" | "local-apps-not-listed" | "no-local-apps" |
  "too-large-to-append"`; `destination`, `appChoices`, `appendEstimate
  {estimatedEvents, estimatedRows, eventCap}`, `needsAppName`.
- `WorkbookPreflightVm` (SCR-018 `workbookFits`, SCR-019
  `workbookSubset|workbookHandoff`): `sheets[] {shape:
  declared-table|table-region|charts-and-summary, badge:
  use|inspect|dashboard|excluded, rows/cells: SheetEstimateVm, isHidden}`,
  `selection {selectedCount, sheetCount, estimatedRows, estimatedCells,
  maxEstimatedCells, blocker}`, `drawingNotices`, `contradiction
  {declaredExtension, detectedFormat}`, `declaredExtension`, `handoff
  {instructions, copy}`. **Type-held:** `SheetEstimateVm = {estimated, value}
  | {not-declared}` — no exact member, no number on not-declared.
  `handoffInstructions(fileName)` composes import-large.html's sentences.
- SCR-020 `sheet`; SCR-021 `unreadableDetail` (D42 token; no
  `workbook-format-later-release` copy token remains — the page accepts
  workbooks, D48); SCR-022 `detail {stage, diagnostic, sheet}`; done
  `landing: app-home | appended-table{tableId}`.
- SCR-023 `ImportReviewVm` is multi-table: `tables[] {tableKey, sheetName,
  declaredTableName, rowCount (exact, joined regions summed), joined[],
  keyFieldName, labelFieldName, statements, fields[]}`, `connections[]`,
  `calculations[]`, `formulaRegionCount`, `sheets[] {classification,
  statements, inertItems}`, `appStatements`, `brokenReferenceCount`,
  `isExcelWorkbook`, `promotionIssues: PromotionIssueGroupVm[]` (grouped by
  field + token via `records.ts`'s `toIssueVm`), `confirm {kind:
  create-app|add-table, appName, tableName}`. Statements attach to owners by
  their own `targetKey`. `REVIEW_EDIT_REJECTION_TOKENS` ≡ S02's
  `WORKBOOK_REVIEW_EDIT_REJECTIONS` (test-pinned).
- `PROMOTION_REJECTION_TOKENS` ≡ M23's `PROMOTION_REJECTIONS` (incl.
  `append-too-large`); `ImportReviewVm.promotionRejection` carries the token
  only — copy composition is M43's (D43).
- **`PromotionIssueGroupVm` carries `columnKey`, `fieldName` and `tableName`,**
  mapped through the current (reviewed) proposal's tables; `null` when the
  issue has no column or the review no longer has that column (closed by
  OWNER-PROMOTION-SEAMS `0634e81`, additive `columnKey?` on the wire). This
  closes the F02-inherited gap below.

### `records.ts` (F02, extended F03)

`selectAppHomeVm`, `selectRecordsListVm`, `selectRecordDetailVm`,
`selectRecordFormVm`, `selectChangeHistoryVm`, `selectDeleteRecordDialogVm`,
`selectRestoreRecordDialogVm`, `toCommandOutcomeVm`, `toIssueVm`,
`announceRecordCommand`, `inputForField`, `handoffFor`, `MAX_SUPPORTING_FACTS`.

**F03 additions (CAP-24/CAP-25):**

- Relationships: `RecordLabelV1` (branded; `toRecordLabel`, and
  `UNLABELLED_RECORD` so an unresolved label never renders blank),
  `ReferenceCellVm` = resolved `{label, href}` | broken `{originalKey,
  relationName}` (type-held: a broken cell cannot exist without its key),
  `toReferenceCell`, `BelongsToVm`, `MissingReferenceVm`, `HasManyVm` /
  `selectHasManyVm`, `RelatedRecordVm`, `RecordDetailContext`,
  `ReferencePickerVm` / `ReferenceCandidateVm` / `selectReferencePickerVm`,
  `TableSwitcherVm` / `selectTableSwitcherVm`. `ChangeHistoryEntryVm` now
  names its table (closes the F02-inherited "assumes one table" gap below).
- Snapshots (the planned `snapshots.ts` — see Files, above): `SheetUseTagV1` +
  `SHEET_USE_LABEL` + `sheetUseTag` ("Interactive table" / "Read-only
  snapshot" / "Mixed use"), `selectSnapshotsListVm`, `inertKindName`,
  `describeInertCount`, `INERT_REASON_SENTENCE` (exhaustive over the inert
  reason keys), `toInertItemVm`, `columnLetters`, `SNAPSHOT_PAGE_ROWS = 50`,
  `pageStartFor`, `selectSnapshotViewerVm` (`previousFirstRow`/`nextFirstRow`,
  so the pager does not derive page size from a short last page),
  `toSnapshotFindVm`, `liveTableForSheet`, `selectSnapshotOptionsVm`, and
  `EXPORT_SHEET_LATER` ("Export arrives in a later release.", owner F07).
- **No `announcements.ts`.** Folding was allowed and taken: each announcement
  has exactly one consumer and depends on the fact beside it, so it lives on
  its VM (`announcement`) or beside its outcome type
  (`announceRecordCommand`).

## Contracts worth recording

- **Must-nots enforced by types, not review** (each has a negative control).
  The locked models (`UnlockVm`'s `locked`/`delayed` variants, `LockedResetVm`)
  declare no field for an app name, record count, backup time or inventory, so a
  future writer cannot fill one. No view-model file names a passphrase-bearing
  field. For F02: no fictional library tile state is constructible
  (`LibraryTileStatusV1` has no conflict / listed-only / too-large / backed-up
  member — F05–F07); `RecordsListVm` has no match-count field; `AppHomeVm` has
  no metrics or chart field (F04). For F03: `ReferenceCellVm`'s broken variant
  cannot be constructed without `originalKey`; `SheetEstimateVm` has no exact
  member.
- **Truthful enumeration.** `ReadableResetVm.inventory` is
  `"loading" | "none" | rows` — there is deliberately no `"unknown"`.
- **Estimate flags survive in both directions (D24).** Pre-flight's
  `isEstimate: true` becomes `ImportRowCountVm{kind:"estimated"}`; the
  proposal's `isRowCountExact: true` becomes `{kind:"exact"}`. Neither literal
  can be widened, so neither can be rendered as the other.
- **`totalCount` is the table's count even on a search page.** The VM names the
  field `tableRecordCount` and carries `scope` beside it, so the sentence a
  surface writes has to say which was searched.
- **The change log is post-checkpoint only.** `ChangeHistoryVm.scope` is the
  literal `"since-last-checkpoint"` and the empty state is
  `"no-changes-since-checkpoint"`.
- **`commitId: null` is a no-op, not a failure.** `RecordCommandOutcomeVm` gives
  it its own `no-op` member so it can never render as an error.
- **A nulled violation count reads "not measured yet", never "none".**
  `ReviewFieldVm.violations` is `{kind:"measured"} | {kind:"not-measured-yet"}`,
  and `isNeedsAttentionExact` goes false whenever any field is unmeasured.
- **Empty is stated, never implied (STA-025).** `ReviewEmptinessV1`
  distinguishes `not-applicable-value-only` from `none-found`;
  `RecordsEmptinessV1` distinguishes `empty-table` from `no-results`.
- **The cleanup receipt has three states, and the third says less.**
  `ImportCleanupVm` is `removed | nothing-to-remove | unconfirmed`.
- **Only unambiguous URI schemes become hrefs.** `tel:`, `mailto:` and
  `http(s)` are built here; a textual address yields `{kind:"maps", query}`
  with **no URL** (M51's platform decision, not M37's).
- **The FR-12 input mapping is total and type-held.** `inputForField` is
  exhaustive over `FieldTypeWireV1` with a `never` check; `reference` maps to
  `{kind:"unsupported", control:"read-only"}` rather than a picker (D25 — F02;
  unchanged by F03's relationship work, which reads through `ReferenceCellVm`
  instead).
- **Announcement copy provenance.** Mock-quoted strings carry source comments;
  states with no mock sentence are composed from facts in Content Patterns
  style.
- **Mock divergence per Custom Rule 3.** reset.html's survivor line names
  Google Drive; the VM carries "Dropbox, OneDrive, or bundle copies" and a
  test asserts no `/drive|google/i` match. The VMs make no `LCL-` prefix claim
  (AD-10).
- **The boundary sweep can no longer go stale.**
  `tests/unit/workflows/module-boundaries.test.ts` checks its two file lists
  against the directories themselves, so a new M36/M37 file that is not swept
  fails the suite.

## Known gaps with owners (open at `30396a9`)

- **SCR-020 has no progress percentage** — no truthful denominator exists
  during a streamed parse (F02, unchanged by F03: SCR-020 shows "Sheet k of n"
  + rows committed instead, still no percentage, D24 class).
- **Glyph and accent are not on `AppSessionViewV1`** — per-app identity renders
  from the catalog tile, not from the open session. Promoting them is F04's
  theme work. F03 touched no theme code.
- **`recordDetail`'s composed copy "Open in {table} →"** departs from the mock
  ("Open customer →") because there is no singularization source (D43,
  SESSION-08 surprise 7). Not a gap — a recorded, approved departure — but kept
  visible here for the GATE-F03 reviewer.

## Closed in F03 (were open at `5ab3b07`, resolved here — not re-carried)

- **Live-region pluralization** ("1 values need attention" at `records.ts:458`,
  "1 changes since this app was last checkpointed" at `:857`) — fixed by S08
  CP1 (assigned via STATE's inherited-obligations table).
- **`promotionIssues` carried no `fieldId` mapping** — closed: the wire+VM
  half landed at `04e09b7` before F03 planning even completed (S06 need only
  preserve it), and OWNER-PROMOTION-SEAMS (`0634e81`) added the field/table
  name mapping S07 CP3 renders.
- **`ChangeHistoryScreen` assumed one table** — closed by S08 (`tableId` named
  on every history entry).

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 implemented by SESSION-06 (`883f815`); consumed verbatim by
  SESSION-07 (`9174b6d`, re-run at `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): staple merged;
  copy-provenance and Custom Rule 3 facts promoted from the session return.
- 2026-09-08 — F02 families (`import.ts`, `records.ts`, reworked `library.ts`)
  landed by SESSION-06 (`cc60008` / `2c19e4e`, incl. the r2 union narrowing);
  bound verbatim by the surfaces at `8a665c1` and `5ab3b07`. The M37
  exhaustive-error-kind seam was cleared without widening the union: M36 gates
  every mutating stage call and reports `stage-missing`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): two session staples and
  two separate "Contracts worth recording" sections folded into one; the
  exhaustive `REFUSAL_ANNOUNCEMENT` map recorded beside the export it
  constrains; four open gaps named with owners.
- 2026-09-23 — F03: `import.ts` rewritten multi-table by SESSION-06/07
  (`4287569`..`e062f41`); `AppChoiceVm` added by SESSION-07; `PromotionIssueGroupVm`
  gained `columnKey`/`fieldName`/`tableName` via OWNER-PROMOTION-SEAMS
  (`0634e81`); relationships + snapshots VMs landed in `records.ts` by
  SESSION-08 (`eba5790`..`30396a9`) — the planned `view-models/snapshots.ts`
  was never created (recorded above, not as a gap).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three SESSION-NN
  staples folded into the Files/export description above; the "Known gaps"
  section split into what is genuinely still open at `30396a9` versus what F03
  closed (live-region pluralization, `promotionIssues` field mapping,
  change-history table naming) — all three were still listed as open in the
  fragment Roshi wrote at the F02 final pass, and F03's own sessions closed
  them without a return trip through this file.

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M37 View models (`records.ts`))

- **Records list:** `RecordsListVm` gains:
  - `matchCount` (exact or null) and `partial` (`RecordsPartialVm`);
  - `filters` (`FilterChipVm[]`), `filterableFields` (`FilterableFieldVm[]`, SHT-004–008, enum options including retired ones);
  - `sort` (`SortVm`) and `sortableFields`.
  - `selectRecordsListVm(table, page, references?, {filters, sort, recordLabels?})`.
- **Query exports:** `RecordsFilterV1` and `RecordsSortV1` (wire aliases for the UI), `filterSheetFor`, `describeActiveFilters`, `describeFilterRefusal`.
- **Computed values (CA-26):**
  - `computedFieldsOf(structure)` and `ComputedFieldVm`;
  - `ComputedCellVm {state, badge: "Live" | "Frozen at import" | "Unsupported formula", note, expression}` on `RecordDetailFieldVm.computed` and `RecordFormFieldVm.computed`;
  - `announceRecalculated(fieldIds, fields)` (D60).
- **Metrics:** `selectMetricsVm(metrics, tables, structure)` returns `MetricVm[]`; `AppHomeVm.metrics` via `selectAppHomeVm(session, metrics = [])`.
- **Change history:** `describeEvent` moved here from the UI and names F04's structure kinds, with a truthful generic sentence for unnamed kinds.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M37 view models — `src/application/view-models/records.ts`)

- Same reason, the chart VMs are sections of `records.ts`, not `charts.ts`: `selectChartDetailVm` (SCR-033/pinned/preview), `appendTablePage`, `ChartCategoryVm`/`ChartMarkVm`/`ChartScopeVm`/`ChartDetailVm`, `ChartFieldTypeVm`; `selectChartBuilderVm`, `defaultChartDefinition`, `CHART_TYPE_CHOICES`, `groupingKey`/`measureKey`; `selectChartsIndexVm`. `AppHomeVm.pinnedCharts`; `RecordsListVm.chartOrigin` (+ `RecordsQueryVmInput.chartOrigin`), announced as "Selected mark · {chart}"; history sentences for `chart.saved`/`chart.deleted`.


<!-- formulas-queries-charts SESSION-07 -->
### F04 delta — SESSION-07 (pointer)

The SESSION-07 delta for this module is recorded jointly in `arch/M36-workflows.md` under the same marker (CA-33 reason keys, live-structure promotion, import review).

<!-- formulas-queries-charts SESSION-06 -->
### F04 delta — SESSION-06 (M37 — view models (`src/application/view-models/schema.ts`) — new file)

- `selectStructureVm(structure, selection)` → `StructureVm` (tables with `fieldCountLabel`/`hasKey`, table with fields/rules/metrics/`calculations`, field detail with calculation, options, connection + detection-source evidence, dashboard values). Nothing the read lacks is drawn: no per-choice record counts, no type-inference evidence, no saved-rule failing counts.
- `typeLabel`, `typeChoicesFor`, `typeForChoice`, `CHANGEABLE_TYPES`, `CALCULATED_COLUMN_TYPES`; `ruleFieldChoices`, `operatorChoicesFor`, `ruleValueFrom`, `ruleValueText`, `ruleValueHint`, `ruleSentence`, `describeRuleCondition`.
- MOD-014: `selectImpactVm({change, preview, structure, wasStale})` → `ImpactDialogVm {title, counts, preservation, applyLabel, blocker, staleNote}`; a refused preview shows no counts. `describeChange`, `describeSchemaRefusal` (incl. known `schema.*` transition keys), `describeApplyFailure`, `describeFormulaError` (appends S03's best-guess position).
- MOD-015: `selectUnsupportedFormulaVm`. SCR-037: `selectAppSettingsVm`, `LATER_RELEASE`. `formulaChangeFor` builds `save-formula` for all three targets.
- Registered in `tests/unit/workflows/module-boundaries.test.ts` `VIEW_MODEL_FILES` (WF-BOUNDARY lease addition).
