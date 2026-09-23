# M21 — Inference (`src/import/inference/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import inference + § Import Architecture Stage 3.
> Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Evidence-weighted proposals, not source parsing — for both a
  single delimited table and (F03) a multi-sheet workbook.
- **Exports:** `inferProposal` (delimited, F02 shape — now a thin adapter),
  `inferWorkbook` (F03, multi-table), `applyReviewEdit` /
  `applyWorkbookReviewEdit`, `sourceTextToCellValue`, `tableRowExtents`,
  `delimitedStream`. `RowIdentityProposal` (F06) is still unbuilt.
- **Depends on:** M65 (workbook facts), M03 (formulas — lookup/reference
  extraction), M01 (`values`, `schema`, `events`).
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
standing.

`infer.ts` — `inferProposal(items, {fileName}) → ProposedAppV1`. **Throws** on
a stream with no summary. `ProposedAppV1 {fileName, appName, table{...},
headerRowIndex, leadingRows, discardedRows, discardedRowCount, rowCount,
isRowCountExact: true, statements, diagnostics}`. Type priority: currency →
boolean → iso-date → slash-date → number → email → url → phone → enum → text,
at `TYPE_CONFIDENCE = 0.9`. Header detection takes the first full-width row of
non-empty, non-value-shaped, distinct cells. Also exports `detectHeaderRow`,
`fieldNamesFrom`, `generatedFieldName`, `DISCARD_REASONS`,
`PROPOSAL_DISCARDED_ROW_LIMIT = 50`.

**F03: `inferProposal` is a thin adapter over `inferWorkbook`,** kept alive
only because S02's own tests still call it directly (no `src/` caller
remains) — carried debt, owner: the next session leasing this directory,
removable once those tests migrate. `infer.ts` also exports
**`delimitedStream(items)`** — strips a delimited stream's one `sheet` fact so
F02's statements/fingerprints (`isDelimited: true`) stay exact.

`review-edits.ts` — `applyReviewEdit(proposal, edit) → ReviewEditResultV1`,
pure and total; property-proven to never throw, never mutate, be idempotent.
`ReviewEditV1` closed union; `REVIEW_EDIT_REJECTIONS` closed reason list.
Deliberate limit: `set-header-row` does not re-infer types — the measured
violation counts drop to `null` rather than go stale.

### F03 workbook tier (SESSION-02, CA-19 producer)

New files (Custom Rule 7): `workbook.ts` (`inferWorkbook`), `regions.ts`
(builder, header rules, discards), `types.ts` (column stats + declared/value
typing), `keys.ts`, `relationships.ts`, `classify.ts`, `rejection-memory.ts`,
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
isRowCountExact: true}`; keys: sheet `s<i>`, declared table `s<i>.t<n>`,
region table `s<i>.r<n>`, column `<tableKey>.c<sheetColumn>`, relationship
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
`WorkbookReviewEditV1` (13 kinds); total/pure/idempotent.

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

**Known limit (accepted, not fixed in F03):** HTML demo pair produces **no**
key-match relationship (58/60 = 0.967 < `KEY_MATCH_CONTAINMENT`, a broken key
appears twice) — a conservative default, not a defect; recorded in the
GATE-F03 demo package's known-limits list.

## Dependency edges as landed

- M13 → (nothing; browser `Blob`/`TextDecoder` only)
- M14 → M13, M19, M65 (F03), never an adapter
- M15–M20 → M13, M65
- M19 → M13, M01 (`domain/model/values`), M65
- M21 → M65 (facts), M03 (formulas — F03), M01 (`values`, `schema`, `events`)

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
