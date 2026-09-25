# M37 — View models (`src/application/view-models/`)

Extracted from specs/architecture.md §Module Contracts (View models).
Reconciled through production `47a633b` (F05 continuation).

- **Owns:** Minimum-data projections for approved surfaces + announcements.
- **Depends on:** M05 freshness policy; M36 (machine snapshot types + the ordering and phrase
  constants), M32 protocol **types only**, M51 `CapabilityReport` **type
  only**. No runtime import from `src/workers/**`; asserted by
  `tests/unit/workflows/module-boundaries.test.ts`.
- **Must not:** include app names/counts/backup times/silhouettes in any
  locked-state VM — the *types* forbid the fields, not just the values; ask for
  "your passphrase" unqualified (exact-secret scope strings live in the VM per
  design.md §Content Patterns).

## Files (current through `47a633b`)

`security.ts`, `library.ts`, `import.ts`, `records.ts`, and (F04, new)
`schema.ts`, `theme.ts`, plus F05 `durability.ts`. **There is no `snapshots.ts` or `charts.ts`.** Both
were planned as their own files at some point (F03 for snapshots, F04 for
charts) and both turned out to belong beside the records VMs they read
alongside (`records.ts`), so neither file was created — a real structural
finding disclosed under Custom Rule 7's mirror case (a planned file that a
checkpoint's own proof did not need), not an omission.
`tests/unit/view-models/snapshots.test.ts` and the chart VM tests import from
`records.ts`.

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
lease (PROGRAM-CONFIG's closed-union convention). Neither F03 nor F04 added a
`DATA_WORKER_ERROR_KINDS_V1` member (D42; F04's four new request families each
got their own typed refusal union instead — see `M32-worker-protocol.md`), so
this map is unchanged since F02.

### `library.ts` (F01, reworked F02, extended F03, F04)

`selectLibraryVm(apps, searchQuery?)` → `LibraryVm = EmptyLibraryVm |
PopulatedLibraryVm`; `LibraryTileVm`, `LibraryTileStatusV1`,
`LibrarySearchScopeV1`, `LibraryActionIntent`; `selectEmptyLibraryVm()`.
`LibraryActionVm` is a union: the enabled variant carries `intent`, the
disabled one carries `reason`, and neither has the other's field. F03 adds
`AppChoiceVm` and `selectAppChoices(apps, selectedAppId)` (SCR-017's "which
app" destination list for CSV/TSV append, CAP-26). **F04:**
`LibraryTileVm.themeTile?` (the palette/logo the library screen paints a
tile with).

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
  OWNER-PROMOTION-SEAMS `0634e81`, additive `columnKey?` on the wire).

**F04 additions (SESSION-07):** `ReviewCalculationVm`, `ReviewChartVm` (with
`isPinned`), `ReviewRuleVm` — the review screen's per-statement articles for a
computed column, a rebuilt chart, and a converted validation rule.

### `records.ts` (F02, extended F03, F04)

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
  names its table.
- Snapshots (folded here rather than a standalone file — see "Files", above):
  `SheetUseTagV1` + `SHEET_USE_LABEL` + `sheetUseTag` ("Interactive table" /
  "Read-only snapshot" / "Mixed use"), `selectSnapshotsListVm`,
  `inertKindName`, `describeInertCount`, `INERT_REASON_SENTENCE` (exhaustive
  over the inert reason keys — F04 extends it to 10 keys, see below),
  `toInertItemVm`, `columnLetters`, `SNAPSHOT_PAGE_ROWS = 50`, `pageStartFor`,
  `selectSnapshotViewerVm` (`previousFirstRow`/`nextFirstRow`, so the pager
  does not derive page size from a short last page), `toSnapshotFindVm`,
  `liveTableForSheet`, `selectSnapshotOptionsVm`, and `EXPORT_SHEET_LATER`
  ("Export arrives in a later release.", owner F07).
- **No `announcements.ts`.** Folding was allowed and taken: each announcement
  has exactly one consumer and depends on the fact beside it, so it lives on
  its VM (`announcement`) or beside its outcome type
  (`announceRecordCommand`).

**F04 additions (SESSION-04, CA-26/CA-29):**

- **Records list:** `RecordsListVm` gains `matchCount` (exact or null) and
  `partial` (`RecordsPartialVm`); `filters` (`FilterChipVm[]`),
  `filterableFields` (`FilterableFieldVm[]`, SHT-004–008, enum options
  including retired ones); `sort` (`SortVm`) and `sortableFields`.
  `selectRecordsListVm(table, page, references?, {filters, sort,
  recordLabels?})`.
- **Query exports:** `RecordsFilterV1` and `RecordsSortV1` (wire aliases for
  the UI), `filterSheetFor`, `describeActiveFilters`, `describeFilterRefusal`.
- **Computed values (CA-26):** `computedFieldsOf(structure)` and
  `ComputedFieldVm`; `ComputedCellVm {state, badge: "Live" | "Frozen at
  import" | "Unsupported formula", note, expression}` on
  `RecordDetailFieldVm.computed` and `RecordFormFieldVm.computed`;
  `announceRecalculated(fieldIds, fields)` (D60).
- **Metrics:** `selectMetricsVm(metrics, tables, structure)` returns
  `MetricVm[]`; `AppHomeVm.metrics` via `selectAppHomeVm(session, metrics =
  [])`.
- **Change history:** `describeEvent` moved here from the UI and names F04's
  structure kinds, with a truthful generic sentence for unnamed kinds.

**F04 additions (SESSION-05, CA-30, charts live here — see "Files"):**
`selectChartDetailVm` (SCR-033/pinned/preview), `appendTablePage`,
`ChartCategoryVm`/`ChartMarkVm`/`ChartScopeVm`/`ChartDetailVm`,
`ChartFieldTypeVm`; `selectChartBuilderVm`, `defaultChartDefinition`,
`CHART_TYPE_CHOICES`, `groupingKey`/`measureKey`; `selectChartsIndexVm`.
`AppHomeVm.pinnedCharts`; `RecordsListVm.chartOrigin` (+
`RecordsQueryVmInput.chartOrigin`), announced as "Selected mark · {chart}";
history sentences for `chart.saved`/`chart.deleted`.

**F04 correction (SESSION-06, lease r2, CP4a `3b7ecfa`) — rule-issue
sentences and `optionLabels` copy.** `toIssueVm(issue, fields = [])`:
`rule-compare` / `rule-between` record-rule issues are now said from their own
parameters instead of a generic sentence: `"{left} must be on or after
{right}."` (the words follow the compared fields' kind, taken from `fields`;
neutral words without them), `"{left} must be at least the number set in the
rule "{ruleLabel}"."` for a literal (its kind, never its value), `"{field} is
outside what the rule "{ruleLabel}" allows."` for a range (`between` and
`not-between` share the key). Unknown keys or missing parameters keep the
generic sentence. `selectRecordDetailVm`, `selectRecordFormVm` and MOD-010
now pass the table's fields so these sentences can be composed. This landed
here — not filed as a `M38-ui-primitives.md` delta, where an identical block
was mistakenly also stapled; see PROGRAM-CONFIG's fragment-reconciliation
note for the move.

**F04 additions (SESSION-08):** `LibraryTileVm.themeTile?` — see `library.ts`,
above (recorded once, there).

## Contracts worth recording

- **Must-nots enforced by types, not review** (each has a negative control).
  The locked models (`UnlockVm`'s `locked`/`delayed` variants, `LockedResetVm`)
  declare no field for an app name, record count, backup time or inventory, so a
  future writer cannot fill one. No view-model file names a passphrase-bearing
  field. For F02: no fictional library tile state is constructible
  (`LibraryTileStatusV1` has no conflict / listed-only / too-large / backed-up
  member; F05 receipt/freshness facts travel separately in durability data); `RecordsListVm` has no match-count field (retired at F04
  — it now has one, truthfully, per CAP-31); `AppHomeVm` had no metrics or
  chart field (F02/F03; both landed at F04, per CAP-29/32/33). For F03:
  `ReferenceCellVm`'s broken variant cannot be constructed without
  `originalKey`; `SheetEstimateVm` has no exact member.
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
  instead). A **computed** field (F04) never reaches this mapping at all — it
  renders through `ComputedCellVm`, read-only by construction.
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
  fails the suite. F04's two new files (`schema.ts`, `theme.ts`) were
  pre-issued into S06's and S08's leases before dispatch (WF-BOUNDARY), so
  neither session hit this as a blocking seam.

## `schema.ts` (new, F04, SESSION-06; extended SESSION-08)

`selectStructureVm(structure, selection)` → `StructureVm` (tables with
`fieldCountLabel`/`hasKey`, a table with fields/rules/metrics/`calculations`,
field detail with calculation, options, connection + detection-source
evidence, dashboard values). Nothing the read lacks is drawn: no per-choice
record counts, no type-inference evidence, no saved-rule failing counts.

`typeLabel`, `typeChoicesFor`, `typeForChoice`, `CHANGEABLE_TYPES`,
`CALCULATED_COLUMN_TYPES`; `ruleFieldChoices`, `operatorChoicesFor`,
`ruleValueFrom`, `ruleValueText`, `ruleValueHint`, `ruleSentence`,
`describeRuleCondition`.

MOD-014: `selectImpactVm({change, preview, structure, wasStale})` →
`ImpactDialogVm {title, counts, preservation, applyLabel, blocker,
staleNote}`; a refused preview shows no counts. `describeChange`,
`describeSchemaRefusal` (incl. known `schema.*` transition keys),
`describeApplyFailure`, `describeFormulaError` (appends S03's best-guess
position). `describeChange` for `change-field-type` with `optionLabels`
(lease r2): `"Change {field} to Choice list with the choices A, B"`.

MOD-015: `selectUnsupportedFormulaVm`. SCR-037: `selectAppSettingsVm`,
`LATER_RELEASE`. `formulaChangeFor` builds `save-formula` for all three
targets.

## `theme.ts` (new, F04, SESSION-08)

`ThemeDraft`, `draftFromTheme`, `draftTheme`, `draftLogo`,
`selectThemeVerdict`, `selectThemeEditorVm` (SCR-036), `describeThemeSummary`
("Cedar · light · comfortable"), `describeContrastCheck` (design.md headings
+ mode), `describeLogoRefusal`, `describeThemeOutcome`.

## Known gaps with owners (open at `5bc19fb`)

- **SCR-020 has no progress percentage** — no truthful denominator exists
  during a streamed parse (F02, unchanged by F03/F04: SCR-020 shows "Sheet k
  of n" + rows committed instead, still no percentage, D24 class).
- **`recordDetail`'s composed copy "Open in {table} →"** departs from the mock
  ("Open customer →") because there is no singularization source (D43,
  SESSION-08 surprise 7). Not a gap — a recorded, approved departure — but kept
  visible here for the GATE-F03/F04 reviewer.

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

## Closed in F04 (were open at `30396a9`, resolved here — not re-carried)

- **`AppSessionViewV1` carried no glyph or accent** — closed by S08 (CA-32,
  `AppSessionViewV1.accentId?`/`glyph?`).
- **`AppHomeVm` had no metrics or chart field** — closed by S04 (metrics) and
  S05 (pinned charts).
- **`RecordsListVm` had no match-count field** — closed by S04 (CAP-31).

## Durability and preserved provenance (F05)

`durability.ts` forwards authenticated `AppDurabilityViewV1` facts and exports `selectBackupStatus`: M05 freshness produces title, tone and remedy. Runtime M37→M05 is realized; wire references remain type-only. Library, app-home/frame, Settings and backup-detail consumers share the same receipt-relative facts, explicit zero and nullable confirmation time. `AppHomeVm.durability?` forwards them without supplying authority. Recovery VM exposes `canSubmit`, `remainingMs` and `remainingSeconds`; worker throttling remains authoritative. Reset uses current inventory facts.

Schema zero-event preview says “No changes to save.” `toIssueVm` uses neutral preserved-value copy for known authored/other non-import provenance; initial-import/workbook-reupload and legacy absent provenance keep existing import wording. Source `d8b4e14`, paired VM/worker tests; no stored provenance rewrite.

Source and current proof scope: [F05 boundaries](F05-boundaries.md), production `47a633b`.

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
- 2026-09-23 — F04: `records.ts`'s query/computed/metrics extensions by
  SESSION-04 (`f736fa8`..`27a2667`); the chart VM families (in `records.ts`,
  per Custom Rule 7) by SESSION-05 (`6ee204c`..`3dd1d2d`); the import review
  VMs by SESSION-07 (`978bb77`..`f9a1565`); `schema.ts` (new) by SESSION-06
  (`e7e7fe2`..`7ec391e`); the `toIssueVm`/`describeChange` correction by
  SESSION-06 lease r2 (`3b7ecfa`); `theme.ts` (new) and `LibraryTileVm.
  themeTile?` by SESSION-08 (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): six SESSION deltas
  folded into "Files", per-file sections, and two new file sections
  (`schema.ts`, `theme.ts`); the SESSION-06 lease-r2 correction — which was
  stapled into `M38-ui-primitives.md` instead of here, the module its content
  actually describes — moved into this fragment (Principle 2 / PROGRAM-CONFIG's
  fragment-reconciliation note); "Known gaps" reconciled against the F04
  Capability Readiness table so a reader does not find a gap already closed
  by CAP-29/31/32/33 still described as open.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.


<!-- durable-home-backup SESSION-06 r9 -->
## M37 — F05 compaction (M37/M44 history)

- **M37/M44 history.** `ChangeHistoryVm.scope` is `"retained-history"`, `emptiness` `"no-retained-changes"`, announcements "N retained change(s) shown." / "No retained changes yet."; the screen copy describes retained history (no checkpoint cutoff). The per-entry " · this device" origin line is unchanged.

Independent receive at 2d8ff2d: typecheck/lint exit 0; full unit 229 files/2520 pass/3 inherited skips; CP1+installed gate 39 files/473 pass; browser J3 2/2, sync/compaction+bundle 3/3, J1/append/status/records/gate-f02/import-journey 18/18 on port 8081 fresh build. CP1 intermittent counterexample closed 7e785e4 (fixture picked random warned row; production refusal correct). Real-browser quota refusal unproven (component-level only).
