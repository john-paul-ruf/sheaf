# M21 — Inference (`src/import/inference/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import inference + § Import Architecture Stage 3.
> Reconciled against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

## Contract

- **Owns:** Evidence-weighted proposals, not source parsing — for a single
  delimited table, a multi-sheet workbook (F03), and (F04) the live-structure
  legs of a workbook import: formula translation, chart mapping, and
  validation→rule conversion.
- **Exports:** `inferWorkbook` (F04: the sole entry — `inferProposal` is
  removed, see below), `applyReviewEdit` / `applyWorkbookReviewEdit`,
  `sourceTextToCellValue`, `tableRowExtents`, `delimitedStream`, and (F04)
  `translateProposedFormula`, `refreshFormulas`, `deriveFormulaSurface`,
  `mapChartPart`, `chartMappingEvidence`, `deriveChartSurface`,
  `ruleConditionOf`. `RowIdentityProposal` (F06) is still unbuilt.
- **Depends on:** M65 (workbook facts), M03 (formulas — lookup/reference
  extraction and, since F04, translation), M01 (`values`, `schema`, `events`).
  **Boundary:** inference imports no `ids.ts` — identities (including F04's
  formula/chart ids) are injected as `FormulaIdentitiesV1`, never generated
  here.
- **Contract:** Declared structure beats inference; lookup formula beats key
  match (FR-7); every decision carries evidence and a reversible review edit;
  a review rejection is an explicit stored negative decision
  (`inference-decision.recorded`, written at promotion for EDITED and
  REJECTED statements only).

## F02 scope (value-only subset, still the delimited path's behaviour)

- Header-row detection with leading junk-row discard.
- Column type inference over: date, currency, number, phone, email, URL,
  boolean, enum, free text. Reference is F03+ only for workbooks — a
  value-only delimited import still never proposes one.
- Enum detection from bounded distinct-value evidence.
- App/table name proposals from file name + content.
- Values not matching their inferred type are preserved and flagged as
  issues, never coerced or discarded (FR-6).
- Review edits are pure functions over the proposal.

## Landed surface

`values.ts` — the single rule that decides both what inference counts as
fitting a type and what promotion stores. `ProposedFieldTypeV1 =
Exclude<FieldTypeV1, {kind:"reference"}>` makes D25 a type error rather than a
review note. `SourceValueFormatV1` (`text | iso-date | slash-date{order} |
decimal{currencySymbol} | boolean | enum`) travels on every proposed field so
promotion converts exactly as inference measured. `sourceTextToCellValue(text,
typing) → SourceCellV1` is total. Also exports `splitCurrency`, `readDecimal`,
`matchesPattern`, `isEmailText`, `isWebUrlText`, `isTelephoneText`,
`CURRENCY_SYMBOLS`.

`statements.ts` — `InferenceStatementV1 {statementId, subject, editKind,
columnIndex, evidence, evidenceFingerprint, disposition}` over
`INFERENCE_SUBJECTS`, `REVIEW_EDIT_KINDS`, `VALUE_PATTERNS`; `EvidenceV1`
closed union with `EVIDENCE_EXAMPLE_LIMIT = 3`; `statementIdOf`,
`inferenceStatement`, `evidenceFingerprintInput`. **Fingerprint rule:** the
input names *what the decision was about*, never *how much was seen*, so
appending rows leaves fingerprints unchanged and a recorded rejection keeps
standing. **F04** adds the `formula` and `chart` subjects and the
`formula-outcome` / `chart-mapping` evidence kinds.

`infer.ts` — `ProposedAppV1 {fileName, appName, table{...}, headerRowIndex,
leadingRows, discardedRows, discardedRowCount, rowCount, isRowCountExact: true,
statements, diagnostics}`. Type priority: currency → boolean → iso-date →
slash-date → number → email → url → phone → enum → text, at `TYPE_CONFIDENCE =
0.9`. Header detection takes the first full-width row of non-empty,
non-value-shaped, distinct cells. Also exports `detectHeaderRow`,
`fieldNamesFrom`, `generatedFieldName`, `DISCARD_REASONS`,
`PROPOSAL_DISCARDED_ROW_LIMIT = 50`, and **`delimitedStream(items)`** — strips
a delimited stream's one `sheet` fact so F02's statements/fingerprints
(`isDelimited: true`) stay exact.

**F04: `inferProposal` is removed.** F03 kept it alive as a thin adapter over
`inferWorkbook` only because S02's own tests still called it directly; F04's
SESSION-07 removed it from `infer.ts` (types + `delimitedStream` kept) once
those tests moved to the F02 view helper `tests/unit/import/
delimited-proposal.ts`. `infer.ts` now has no `src/` caller of a
delimited-only entry point — `inferWorkbook` is the sole entry for every
format, including a single implicit sheet.

`review-edits.ts` — `applyReviewEdit(proposal, edit) → ReviewEditResultV1`,
pure and total; property-proven to never throw, never mutate, be idempotent.
`ReviewEditV1` closed union; `REVIEW_EDIT_REJECTIONS` closed reason list.
Deliberate limit: `set-header-row` does not re-infer types — the measured
violation counts drop to `null` rather than go stale.

### F03 workbook tier (SESSION-02, CA-19 producer)

Files (Custom Rule 7): `workbook.ts` (`inferWorkbook`), `regions.ts` (builder,
header rules, discards — F04 adds footer/totals-row capture for table
metrics), `types.ts` (column stats + declared/value typing), `keys.ts`,
`relationships.ts`, `classify.ts`, `rejection-memory.ts`,
`workbook-proposal.ts` (the proposal's types, split out so inference and edits
share them without importing each other).

**Additive, never widening.** Every F02 union (`EvidenceV1`,
`INFERENCE_SUBJECTS`, `REVIEW_EDIT_KINDS`, `REVIEW_EDIT_REJECTIONS`,
`SourceValueFormatV1`, `ProposedAppV1`, `DISCARD_REASONS`) is byte-identical.
Workbook supersets: `WORKBOOK_INFERENCE_SUBJECTS`, `WORKBOOK_REVIEW_EDIT_KINDS`,
`WorkbookEvidenceV1 = EvidenceV1 | WorkbookStructureEvidenceV1`,
`WORKBOOK_REVIEW_EDIT_REJECTIONS`, `WorkbookSourceValueFormatV1` (+
`serial-date{system}`), `WORKBOOK_DISCARD_REASONS` (+ `totals-row`).

`inferWorkbook(items, {fileName, sheetSelection, rejectionMemory,
fingerprintOf, existingApp}) → ProposedWorkbookV1`; throws without a summary.
A delimited stream (no `sheet` fact) = one sheet/one table with F02's
statements and fingerprint inputs (`isDelimited: true`).

`ProposedWorkbookV1 {fileName, isDelimited, appName, sheets, tables,
relationships, recordRules, inertItems, inertCounts, statements, diagnostics,
isRowCountExact: true}` (F04 adds `formulas`, `charts`, `lastDataRowIndex` —
see below); keys: sheet `s<i>`, declared table `s<i>.t<n>`, region table
`s<i>.r<n>`, column `<tableKey>.c<sheetColumn>`, relationship
`rel:<childColumnKey>`, rule `rule:<columnKey>`; statement id
`<subject>:<targetKey>`.

Merged regions are separate `ProposedTableV2` entries with
`joinedToTableKey`; reject/restore of `table-merge`/`table-split` toggles the
join. `decisionKindOf(subject)` (total; name-only subjects → null);
`INFERENCE_DECISION_KINDS` and `SHEET_ROLES` restated (M21 may not import
`domain/model/snapshots.ts`) and pinned against it.

Fingerprint v2: `["sheaf.inference.v2", subject, sheetName, tableIdentity,
column?, ...qualitative terms]`; `previously-rejected` never enters it.
`applyWorkbookReviewEdit(proposal, edit) → ReviewEditResultV2` over
`WorkbookReviewEditV1` (F04: 13 kinds, unchanged in count from F03 — the F04
formula/chart/rule legs are producer-side inference, not new review-edit
kinds); total/pure/idempotent.

Thresholds: `KEY_SKETCH_LIMIT = 10_000`, `KEY_MATCH_CONTAINMENT = 0.98`,
`KEY_MATCH_MINIMUM_VALUES = 8`, `LABEL_DISTINCT_SHARE = 0.8`,
`IDENTIFIER_WORDS = id, code, no, key, #`, `DECLARED_FORMAT_SHARE = 0.5`,
`VALIDATION_ENUM_OPTION_LIMIT = 64`, `SUMMARY_MAX_USED_CELLS = 500`,
`SHEET_REGION_LIMIT = 32`, `SHEET_VALIDATION_LIMIT = 256`,
`SHEET_PRESERVED_PART_LIMIT = 4096`, `COLUMN_LOOKUP_LIMIT = 8`.

**`tableRowExtents(items) → Map<tableKey, {firstRowIndex, lastRowIndex}>`**
(F03 S06) — the one fact a proposal leaves out, extracted by the same read
pass (`candidatesOf`, itself extracted so its behaviour stays pinned by S02's
suites), for M23's promotion row plan. `TableRowExtentV1` exported.

**Known limit (accepted, not fixed):** HTML demo pair produces **no**
key-match relationship (58/60 = 0.967 < `KEY_MATCH_CONTAINMENT`, a broken key
appears twice) — a conservative default, not a defect; recorded in the
GATE-F03/F04 demo packages' known-limits list.

### F04: live-structure inference (SESSION-07)

- `formulas.ts` (new): `translateProposedFormula`, `refreshFormulas(proposal,
  ids)`, `deriveFormulaSurface`. Fill-down proof via M03's `relativeShapeKey`.
  Shared-formula children take their master's shape. A nondeterministic
  metric/dashboard value (a table-metric or dashboard-value target evaluating
  `RAND`-family functions) becomes `unsupported`, reason `value-not-kept`,
  rather than frozen (freezing is per-record, and a metric has no record).
- `charts.ts` (new): `mapChartPart` (D55: single series only; bar/column/
  stacked/line/pie/doughnut/scatter map; pivots map to bar), the mapping
  requires every category and value series to reference **one** column each of
  the same imported table region. `chartMappingEvidence`,
  `deriveChartSurface`. Area, multi-series, two-sheet-series and sparkline
  charts → `chart-not-rebuilt` (D55's named non-candidates).
- `rules.ts` (new): `ruleConditionOf` maps workbook comparison validations to
  rule IR v2 (`compare` / `between` / `not-between`, measure `text-length`
  for text-length validations). Non-comparison (`custom`) validations stay
  inert.
- `workbook-proposal.ts` gains `ProposedFormulaV1`, `ProposedChartV1`,
  `formulas`, `charts`, `lastDataRowIndex`, and `FORMULA_KEEP_REASONS`. A
  formula whose text could not be read is never proposed — it stays an inert
  `formula-not-live-yet` item, because migration 005 requires
  `original_text`; `unreadable` is therefore dropped from
  `FORMULA_KEEP_REASONS` and from the wire `FormulaKeepReasonWireV1` at CP4.
  `regions.ts` captures table footers so a totals row becomes a table metric.
  Statements gain the `formula` / `chart` subjects and their evidence kinds
  (above).

## Dependency edges as landed

- M13 → (nothing; browser `Blob`/`TextDecoder` only)
- M14 → M13, M19, M65 (F03), never an adapter
- M15–M20 → M13, M65
- M19 → M13, M01 (`domain/model/values`), M65
- M21 → M65 (facts), M03 (formulas — F03 extraction, F04 translation), M01
  (`values`, `schema`, `events`)

`tests/unit/import/module-boundaries.test.ts` asserts mechanically that the
**pipeline directories** import nothing from `src/persistence/`,
`src/crypto/`, `src/workers/`, `src/ui/`, `src/application/`, or any
third-party package; that they reach the domain only through `values.js`,
`schema.js`, `events.js`; and that no file builds a cell value as an object
literal instead of through the landed constructors. It names the module
directories rather than `src/import` as a whole, because `src/import` is not
one module (M22/M23 live there too and declare opposite edges).

The F02 `review-edits.ts` → `infer.ts` runtime import was redirected to
`regions.ts`/`types.ts` (types-only from `infer.ts`) so `infer → workbook →
rejection-memory → review-edits` has no runtime cycle.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — implemented by SESSION-03 (`ad0871e`): CA-16 producer READY, the
  demo proposal pinned by exact expectation, `applyReviewEdit` property-proven
  total/pure/idempotent over 600 runs.
- 2026-09-08 — consumed through the stage by SESSION-04 (`cd74e6d`) and at the
  review surface by SESSION-07 (`8a665c1`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-03 staple folded
  into the contract; "S04" rewritten as the module that actually consumes it;
  the F03 heuristic gaps recorded in scope rather than only in the session record.
- 2026-09-23 — F03: the workbook tier (`workbook.ts` and six sibling files)
  landed by SESSION-02 (`43ba6a1`..`3e99aa1`); `tableRowExtents` and
  `delimitedStream` added, `inferProposal` reduced to a thin adapter, by
  SESSION-06 (`4287569`..`677b947`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): two SESSION staples
  folded into the Landed-surface and F03-workbook-tier sections; the F02
  "F03 note" placeholders about reference/relationship inference replaced with
  the landed contract; the HTML key-match known limit recorded once, here,
  rather than only in the Final Report.
- 2026-09-23 — F04: `formulas.ts`, `charts.ts`, `rules.ts` landed and
  `inferProposal` fully removed by SESSION-07 (`978bb77`..`f9a1565`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): the SESSION-07 delta
  folded into a new "F04: live-structure inference" subsection; the "thin
  adapter, carried debt" note for `inferProposal` replaced with its actual
  removal, so the fragment no longer describes a debt that is already paid;
  the workbook-tier section's proposal shape and review-edit kind count
  updated to name the F04 additions without re-deriving the whole contract.
