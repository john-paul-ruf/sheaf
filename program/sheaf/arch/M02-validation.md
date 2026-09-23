# M02 — Validation (`src/domain/validation/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Validation. Reconciled against the tree at `425562d`
> (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Type, required, enum, relationship, cross-field, schema, and merge
  validation.
- **Exports (full target):** `ValidationRuleIR`, `ValidationContext`,
  `ValidationReport`, `validateRecord`, `validateSchemaTransition`,
  `analyzeImpact`.
- **Depends on:** M01 domain model and formula result types (M03 arrives F04's
  IR/catalog/graph/evaluator; F02/F03 use a placeholder-free subset that names
  no formula results).
- **Must not:** Let any caller opt out of referential or cross-field checks.
- **Invariant 5 (binding):** the exact same `validateRecord` implementation is
  called for an authored write, restore, automatic merge, manual repair, and
  adoption replay/promotion. That means: record CRUD (M34), record restore
  (M34), and import promotion (M23/M33) all call this one function.

## Landed surface

`analyzeImpact` and the full `validateSchemaTransition` surface belong to F04's
schema editors and are **not exported**; a test asserts their absence.

- `rules.ts` — `VALIDATION_ISSUE_KINDS` / `VALIDATION_SEVERITIES` (migration
  005's `record_issues` closed sets, pinned by test), `ValidationIssueV1`,
  `ValidationReport`, `buildReport` (invalid ⇔ a blocking issue exists),
  `ValidationRuleIR` + `RuleConditionV1` — a deliberately total record-rule IR
  (`field-present` / `field-absent` / `field-equals` / `all` / `any` / `not`):
  no arithmetic, no calls, nothing that could execute imported behavior.
  Reasons are `messageKey` + typed `messageParameters`; **the offending cell
  value is never a parameter.**
- `validate-record.ts` — `validateRecord(context, record)`, `ValidationContext`
  (table, enum options, rules, `referenceExists` resolver, and — F03 —
  `referenceTargets?`), `RecordUnderValidationV1`, `ReferenceResolver`.
  **Invariant 5 is held by the signature**: two parameters, no options object,
  so no caller can opt out of the referential or cross-field checks.
- `schema-checks.ts` — `validateSchema(tables, enumOptions, relationships = [])`:
  unique IDs and ordinals, labels present, enum-option ownership/activity,
  key/label fields owned by their table, and — F03 — migration 005's
  relationship trigger as a domain check (issue keys
  `schema.relationship-source-not-in-table`,
  `schema.relationship-source-not-reference`,
  `schema.relationship-target-not-key`,
  `schema.duplicate-relationship-source`, `schema.duplicate-relationship-id`).

**Severity policy (F02-binding, unchanged by F03):** imported-invalid values and
broken references are preserved and flagged as **warnings** — they commit,
which is what FR-4 requires. Blocking is reserved for what a user authored and
can fix now: wrong type, missing required, unknown enum option, unknown field,
wrong table. D23 carries the **whole** `ValidationReport` across the RPC as a
typed result, never as an error kind.

**F03: reference-field severity (D36).** In a `reference` field,
`invalid-preserved` ⇒ `broken-reference` **warning**; `reference{recordId}` not
live in the field's target table ⇒ `broken-reference`, **blocking when the
value is authored in this write** (`provenance` entry `source: "user"`),
**warning otherwise** (imported, or carried over unchanged). Parameters
`{fieldLabel, targetTable}`, never the key. A reference field with no active
relationship points nowhere (`targetTable: ""`).
`ValidationContext.referenceTargets?: ReferenceTargetV1[] {fieldId, tableId,
tableLabel}` (optional only so F02 promotion compiles; absent ≡ `[]`).
`RecordUnderValidationV1.provenance?` = the provenance each value carries *in
this write*.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/workers/`, `src/import/`, `src/ui/`,
  `react`, or any third-party package. Pure domain.
- Shipped as `tests/unit/validation/module-boundaries.test.ts`:
  `src/domain/{model,validation}` import only relative paths, never a package,
  never outward; M02 → M01 only, never the reverse.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — implemented by SESSION-01 (`3ffee63`): CA-08 consumer half of the
  one-validator contract; F04 exports withheld by test.
- 2026-09-08 — consumed at the surface tier by SESSION-08 (`5ab3b07`): typed
  CRUD field-level failures render from this report, ack only after the durable
  commit.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the seeded "F02 scope note"
  and the SESSION-01 delta folded into one landed-surface statement; severity
  policy recorded here, where it binds future callers.
- 2026-09-23 — F03: relationship schema checks and reference-field severity
  (D36) landed by SESSION-03 (`f29ac33`..`a2c4cf0`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-03 staple
  folded into the per-file sections and the severity-policy paragraph.

<!-- formulas-queries-charts SESSION-01 -->
### F04 delta — SESSION-01 (M02 — Validation (`arch/M02-validation.md`))

- `rules.ts`: `RuleConditionV2`, `ValidationRuleIRV2 {irVersion: 2, …}` (CA-27), `COMPARE_OPERATORS`, `RuleMeasureV2`
  (`"text-length"`, optional `measure` on `compare`/`between` — the CA-27 conversion bullet's "len operand"),
  `RULE_V2_MESSAGE_KEYS`, `FORMULA_ISSUE_MESSAGE_KEYS` (unprefixed CA-26 keys).
- `validate-record.ts`: `ValidationContext.rules: readonly (ValidationRuleIR | ValidationRuleIRV2)[]`; new export
  `ruleHolds(rule, record)` (three-valued: an undetermined comparison never fires; v1 unchanged). Computed fields
  (`formulaId` set) skip required/type; a `user`-provenance value without `evidence.frozen` → blocking `formula`
  `computed-not-authored`. Still the only entrance, still two parameters.
- New `schema-impact.ts`: `SchemaChangeV1` (D59, 17 kinds), `SchemaSnapshotV1`, `analyzeSchemaChange(change, schema,
  records, ImpactEnvV1) → ImpactReportV1` (exact counts + `patches` = the `record.patched` values), `convertValueForType`,
  `validateSchemaTransition(before, after) → {isAllowed, refusals}` (`SCHEMA_TRANSITION_REFUSALS`, 9 kinds; reuses
  `validateSchema`).
- Dependency edge now **M02 → M03 type-only** (`import type` from `src/domain/formulas/`), enforced by the rewritten
  `tests/unit/validation/module-boundaries.test.ts` (pure `violationsOf` with zero-file and value-import negative controls;
  the "F02 withholds F04 exports" assertion is replaced by "F04 exports present, no evaluator in M02").

<!-- formulas-queries-charts SESSION-03 -->
### F04 delta — SESSION-03 (M02 — Validation (`src/domain/validation/schema-impact.ts`, lease r1, S01-KEY))

- `SchemaChangeV1` gains `{ kind: "set-table-key"; tableId; keyFieldId: FieldId | null }` (CA-28 "set key" → `table.changed`, D64). Impact: `missingNow` = records with no key value, `keptAndFlagged` = records repeating an earlier record's key value; nothing patched. Transition: reuses `validateSchemaTransition` → `validateSchema`'s endpoint rule, so a key still targeted by a relationship is refused (`schema.relationship-target-not-key`); computed/inactive keys refused as before.


<!-- formulas-queries-charts SESSION-06 r2 -->
### F04 delta — SESSION-06 lease r2 (CP4a 3b7ecfa)


- **M02** `schema-impact.ts`: `SchemaChangeV1` `change-field-type` gains optional `enumOptions` (the field's complete option list after the change; the named choices active). `analyzeSchemaChange` converts against `change.enumOptions` when present, else the field's own options; the exact-label comparison (`convertValueForType`) is unchanged. Nothing is derived from the column's values.
- **M34** `schema-commands.ts`: `SchemaChangeRequestV1` `change-field-type` gains optional `optionLabels`. When a non-enum field becomes `enum`, the command allocates one active option per named label (new ids, ordinals as given); options from an earlier choice-list life stay, inactive, after them. With no label, the after-schema has no active option and the transition is refused `schema.enum-field-without-options`, as before. Events in one commit: `field.changed` → `enum.changed` (prior digest when earlier options exist) → `record.patched` for each rewritten value.
- **M32** `messages.ts`: `SchemaChangeWireV1` `change-field-type` gains optional `optionLabels: readonly string[]`. **M33** `structure-handlers.ts` `toRequest` forwards it.
- **M37** `records.ts`: `toIssueVm(issue, fields = [])`. `rule-compare` / `rule-between` record-rule issues are said from their own parameters: `"{left} must be on or after {right}."` (the words follow the compared fields' kind, from `fields`; neutral words without them), `"{left} must be at least the number set in the rule “{ruleLabel}”."` for a literal (its kind, never its value), `"{field} is outside what the rule “{ruleLabel}” allows."` for a range (between and not-between share the key). Unknown keys or missing parameters keep the generic sentence. `selectRecordDetailVm`, `selectRecordFormVm` and MOD-010 pass the table's fields.
- **M37** `schema.ts`: `describeChange` for `change-field-type` with `optionLabels`: `Change {field} to Choice list with the choices A, B`. **M46** `field-editor.tsx`: when the chosen kind is Choice list and the field is not one, a `[data-editor="new-choices"]` list asks the person to name the choices; Change type is disabled until at least one choice is named.
