# M21 — Inference (`src/import/inference/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import inference + § Import Architecture Stage 3.
> Reconciled against the tree at `5ab3b07` (F02 final).

## Contract

- **Owns:** Evidence-weighted proposals, not source parsing.
- **Exports:** `ProposedAppV1`, `ProposedFieldV1`, `InferenceStatementV1`,
  `EvidenceV1`, `inferProposal`, `applyReviewEdit`, `sourceTextToCellValue`
  (`RejectionMemory` and `RowIdentityProposal` gain substance in F03/F06).
- **Depends on:** normalized workbook facts (M19) and domain model/validation
  (M01, M02).
- **Contract:** Declared structure beats inference (vacuous for delimited —
  nothing is declared); every decision carries evidence and a reversible
  review edit; a review rejection is an explicit stored negative decision
  (`inference-decision.recorded`, written at promotion for EDITED and REJECTED
  statements only).

## F02 scope (value-only subset, FR-4/FR-6 subset)

- Header-row detection with leading junk-row discard (discarded rows shown at
  review; retained via the source + snapshot chunks, D21).
- Column type inference over: date, currency, number, phone, email, URL,
  boolean, enum, free text (no address heuristic; date forms are limited —
  both recorded as F03 notes). **Reference is F03**: a value-only import can
  never propose one, and the type system says so.
- Enum detection from bounded distinct-value evidence.
- App/table name proposals from file name + content.
- Values not matching their inferred type are preserved and flagged as issues,
  never coerced or discarded (FR-6).
- Review edits are pure functions over the proposal: rename table/field,
  override type, adjust header row, edit enum options, rename app.

## Landed surface (F02, S03)


Four files (`values.ts` is beyond the planned three, disclosed under Custom
Rule 7).

`values.ts` — the single rule that decides *both* what inference counts as
fitting a type and what promotion stores, so the review screen's "two values do
not match" names exactly the two `sourceTextToCellValue` refuses.
`ProposedFieldTypeV1 = Exclude<FieldTypeV1, {kind:"reference"}>` makes D25 a
type error rather than a review note. `SourceValueFormatV1`
(`text | iso-date | slash-date{order} | decimal{currencySymbol} | boolean |
enum`) travels on every proposed field so promotion converts exactly as inference
measured. `sourceTextToCellValue(text, typing) → SourceCellV1` is total:
`value{CellValueV1}` or `enum-option{label}` (the `OptionId` is promotion's to
allocate). Decimal spelling rule: leading zeros and bare points are
**canonicalized**; exponents are **preserved as invalid**, because rewriting
`1e300` would invent an authored spelling. Also exports `splitCurrency`,
`readDecimal`, `matchesPattern`, `isEmailText`, `isWebUrlText`,
`isTelephoneText`, `CURRENCY_SYMBOLS`.

`statements.ts` — `InferenceStatementV1 {statementId, subject, editKind,
columnIndex, evidence, evidenceFingerprint, disposition}` over
`INFERENCE_SUBJECTS`, `REVIEW_EDIT_KINDS`, `VALUE_PATTERNS`; `EvidenceV1` closed
union (`value-pattern`, `distinct-values`, `header-text`, `file-name`,
`row-shape`, `value-conflict`) with `EVIDENCE_EXAMPLE_LIMIT = 3`;
`statementIdOf`, `inferenceStatement`, `evidenceFingerprintInput`.
**Fingerprint rule:** the input names *what the decision was about* (subject,
column, heading text, pattern, sorted option labels, file name) and never *how
much was seen* (no counts, examples, or row indexes), so appending rows to the
same file leaves every fingerprint unchanged and a recorded rejection keeps
standing. Terms are JSON-encoded, so no two decisions can collide. M23 hashes the string through
M08; M08 stays the digest owner.

`infer.ts` — `inferProposal(items, {fileName}) → ProposedAppV1`, synchronous over
an `Iterable` of stream items so the data worker can feed accumulated batches
(D17). **Throws** on a stream with no summary: a cancelled parse has no exact
counts to propose from. Bounded state only: `PROPOSAL_LEADING_ROWS = 20` rows
kept whole, per-column tallies and ≤3 examples — 250,000 cells cost what 250 do.
`ProposedAppV1 {fileName, appName, table{tableName, fields}, headerRowIndex,
leadingRows, discardedRows, discardedRowCount, rowCount, isRowCountExact: true,
statements, diagnostics}`; `ProposedFieldV1 {columnIndex, fieldName,
isNameGenerated, type, sourceFormat, enumOptions, violations}` where
`violations: null` means "a user override nothing has measured yet".
`isRowCountExact` is the literal `true` and is the counterpart to pre-flight's
`isEstimate: true`. Type priority: currency → boolean → iso-date → slash-date →
number → email → url → phone → enum → text, at `TYPE_CONFIDENCE = 0.9`; enum
needs `ENUM_MINIMUM_VALUES = 8` values, 2–`ENUM_OPTION_LIMIT = 12` distinct, and
each option averaging twice. Header detection takes the first full-width row of
non-empty, non-value-shaped, distinct cells. **The table is as wide as the
widest row**, never the modal one — a ragged row's extra cells are real values.
Also exports `detectHeaderRow`, `fieldNamesFrom`, `generatedFieldName`,
`DISCARD_REASONS` (`above-header`, `empty-row`),
`PROPOSAL_DISCARDED_ROW_LIMIT = 50`.

`review-edits.ts` — `applyReviewEdit(proposal, edit) → ReviewEditResultV1`
(`applied{proposal} | rejected{reason}`), pure and **total**: property-proven to
never throw, never mutate its input, be idempotent, and mark at most the one
statement the edit names `edited`. `ReviewEditV1` is the closed union
`rename-app | rename-table | rename-field | override-type | set-header-row |
edit-enum-options`; `REVIEW_EDIT_REJECTIONS` is the closed reason list. Also
exports `defaultSourceFormat(type)`. Deliberate limit: `set-header-row`
re-derives names, discards, the exact row count, and the affected statements'
evidence, but does **not** re-infer types — a pure function has no fact stream;
the measured violation counts drop to `null` rather than go stale, and the user
overrides from the same screen.

## Dependency edges as landed

- M13 → (nothing; browser `Blob`/`TextDecoder` only)
- M14 → M13, M19 (pre-flight splits its sample through the real parser)
- M19 → M13, M01 (`domain/model/values`)
- M21 → M19 (facts), M01 (`values`, `schema`, `events`)

`tests/unit/import/module-boundaries.test.ts` asserts mechanically that the
**four pipeline directories** — `src/import/{source,preflight,formats,
inference}` — import nothing from `src/persistence/`, `src/crypto/`,
`src/workers/`, `src/ui/`, `src/application/`, or any third-party package; that
they reach the domain only through `values.js`, `schema.js`, `events.js`; and
that no file builds a cell value as an object literal instead of through the
landed constructors (which would bypass the NFC check D28 depends on).

It names those four directories rather than `src/import` as a whole because
**`src/import` is not one module**: M22 and M23 live there too and declare the
opposite edges (M09 codecs, ports), and their must-nots ship separately in
`tests/unit/staging/module-boundaries.test.ts`. The original sweep swept the
shared parent and turned S04's correct M23→M09 import into a red gate in another
session's lease; `978f4ff` re-scoped it. Nothing was relaxed for the four
modules it covers.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — implemented by SESSION-03 (`ad0871e`): CA-16 producer READY, the
  demo proposal pinned by exact expectation (24 statements, 9 fields, 40 exact
  rows), `applyReviewEdit` property-proven total/pure/idempotent over 600 runs.
- 2026-09-08 — consumed through the stage by SESSION-04 (`cd74e6d`) and at the
  review surface by SESSION-07 (`8a665c1`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-03 staple folded
  into the contract; "S04" rewritten as the module that actually consumes it;
  the F03 heuristic gaps recorded in scope rather than only in the session record.
