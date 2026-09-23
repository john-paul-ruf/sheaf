# M02 — Validation (`src/domain/validation/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Validation. Reconciled against the tree at `5bc19fb`
> (F04 final; formulas-queries-charts).

## Contract

- **Owns:** Type, required, enum, relationship, cross-field, schema, and merge
  validation.
- **Exports (full target):** `ValidationRuleIR`, `ValidationContext`,
  `ValidationReport`, `validateRecord`, `validateSchemaTransition`,
  `analyzeImpact` (landed as `analyzeSchemaChange`, F04 — see below).
- **Depends on:** M01 domain model, and (F04) M03 **type-only** — `import
  type` from `src/domain/formulas/`, never a value import. Enforced by
  `tests/unit/validation/module-boundaries.test.ts` (pure `violationsOf` with
  zero-file and value-import negative controls).
- **Must not:** Let any caller opt out of referential or cross-field checks.
- **Invariant 5 (binding):** the exact same `validateRecord` implementation is
  called for an authored write, restore, automatic merge, manual repair, and
  adoption replay/promotion, and (F04) schema-change value conversion. That
  means: record CRUD (M34), record restore (M34), import promotion (M23/M33),
  and schema-change patches (M34's `schema-commands.ts`) all call this one
  function.

## Landed surface

`analyzeImpact` (full generality) is superseded by the landed, more specific
F04 `analyzeSchemaChange` (below); `validateSchemaTransition` is F04's.

- `rules.ts` — `VALIDATION_ISSUE_KINDS` / `VALIDATION_SEVERITIES` (migration
  005's `record_issues` closed sets, pinned by test), `ValidationIssueV1`,
  `ValidationReport`, `buildReport` (invalid ⇔ a blocking issue exists),
  `ValidationRuleIR` + `RuleConditionV1` — a deliberately total record-rule IR
  (`field-present` / `field-absent` / `field-equals` / `all` / `any` / `not`):
  no arithmetic, no calls, nothing that could execute imported behavior.
  Reasons are `messageKey` + typed `messageParameters`; **the offending cell
  value is never a parameter.**

  **F04 rule IR v2 (CA-27, D52).** `RuleConditionV2`, `ValidationRuleIRV2
  {irVersion: 2, …}`, `COMPARE_OPERATORS`, `RuleMeasureV2` (`"text-length"`,
  the optional `measure` on `compare`/`between`), `RULE_V2_MESSAGE_KEYS`,
  `FORMULA_ISSUE_MESSAGE_KEYS` (unprefixed CA-26 keys, unlike F02/F03's
  `validation.*` keys).

- `validate-record.ts` — `validateRecord(context, record)`, `ValidationContext`
  (table, enum options, rules, `referenceExists` resolver, `referenceTargets?`
  — F03 — and, since F04, `ValidationContext.rules: readonly
  (ValidationRuleIR | ValidationRuleIRV2)[]`), `RecordUnderValidationV1`,
  `ReferenceResolver`. **Invariant 5 is held by the signature**: two
  parameters, no options object, so no caller can opt out of the referential
  or cross-field checks.

  **F04 additions.** `ruleHolds(rule, record)` — three-valued: an
  undetermined comparison never fires; v1 rules evaluate exactly as before.
  Computed fields (`formulaId` set) skip required/type checks; a
  `user`-provenance value on a computed field without `evidence.frozen`
  produces a blocking `formula` issue `computed-not-authored`.

- `schema-checks.ts` — `validateSchema(tables, enumOptions, relationships = [])`:
  unique IDs and ordinals, labels present, enum-option ownership/activity,
  key/label fields owned by their table, and — F03 — migration 005's
  relationship trigger as a domain check (issue keys
  `schema.relationship-source-not-in-table`,
  `schema.relationship-source-not-reference`,
  `schema.relationship-target-not-key`,
  `schema.duplicate-relationship-source`, `schema.duplicate-relationship-id`).

- `schema-impact.ts` (new, F04) — `SchemaChangeV1` (D59's 16-kind closed
  union plus `set-table-key` from S03's lease r1, CA-28/D64 — 17 kinds total),
  `SchemaSnapshotV1`, `analyzeSchemaChange(change, schema, records,
  ImpactEnvV1) → ImpactReportV1` (exact counts + `patches` = the
  `record.patched` values), `convertValueForType` (also returns `unchanged`),
  `validateSchemaTransition(before, after) → {isAllowed, refusals}`
  (`SCHEMA_TRANSITION_REFUSALS`, 9 kinds; reuses `validateSchema`).

  `set-table-key {tableId, keyFieldId: FieldId | null}` (S03, CA-28
  \"set key\" → `table.changed`, D64): impact is `missingNow` (records with no
  key value) and `keptAndFlagged` (records repeating an earlier record's key
  value); nothing is patched. Its transition reuses `validateSchemaTransition`
  → `validateSchema`'s endpoint rule, so a key still targeted by a
  relationship is refused (`schema.relationship-target-not-key`); computed or
  inactive keys are refused as before.

  `change-field-type` gains optional `enumOptions` (S06 lease r2, CP4a
  `3b7ecfa`): the field's complete option list after the change, with the
  newly named choices active. `analyzeSchemaChange` converts against
  `change.enumOptions` when present, else the field's own options; the
  exact-label comparison (`convertValueForType`) is unchanged, and nothing is
  derived from the column's existing values. This is the domain half of D57's
  Text → Choice list step (SCR-035); the command half (`optionLabels` on the
  wire and in `schema-commands.ts`) is M34's, described there.

**Severity policy (F02-binding, unchanged by F03/F04):** imported-invalid
values and broken references are preserved and flagged as **warnings** — they
commit, which is what FR-4 requires. Blocking is reserved for what a user
authored and can fix now: wrong type, missing required, unknown enum option,
unknown field, wrong table, and (F04) an authored write to a computed field.
D23 carries the **whole** `ValidationReport` across the RPC as a typed result,
never as an error kind.

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
  `react`, or any third-party package. Pure domain. **F04: a value import from
  M03 is refused; a type-only import is required to be present** (the sweep
  checks both directions, so the module can neither drift back to no formula
  awareness nor smuggle in a runtime coupling).
- Shipped as `tests/unit/validation/module-boundaries.test.ts`: `src/domain/
  {model,validation}` import only relative paths, never a package, never
  outward; M02 → M01 (+ M03 type-only) only, never the reverse.

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
- 2026-09-23 — F04: rule IR v2, `ruleHolds`, computed-field validation and the
  new `schema-impact.ts` (the F04 exports the F02 test used to assert were
  absent) landed by SESSION-01 (`50d1c51`..`488f49e`); `set-table-key` added by
  SESSION-03 lease r1 (`5b9fd27`); `change-field-type.enumOptions` added by
  SESSION-06 lease r2 (`3b7ecfa`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): three SESSION deltas
  folded into "Landed surface"; the head's `Depends on`/`Dependency must-nots`
  sections rewritten to state the M02→M03 type-only edge as the module's
  current, permanent contract rather than a delta note.
