# M02 — Validation (`src/domain/validation/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Validation. Reconciled against the tree at `5ab3b07`.

## Contract

- **Owns:** Type, required, enum, relationship, cross-field, schema, and merge
  validation.
- **Exports (full target):** `ValidationRuleIR`, `ValidationContext`,
  `ValidationReport`, `validateRecord`, `validateSchemaTransition`,
  `analyzeImpact`.
- **Depends on:** M01 domain model and formula result types (M03 types arrive
  F04; F02 uses a placeholder-free subset that names no formula results).
- **Must not:** Let any caller opt out of referential or cross-field checks.
- **Invariant 5 (binding):** the exact same `validateRecord` implementation is
  called for an authored write, restore, automatic merge, manual repair, and
  adoption replay. In F02 that means: record CRUD (M34), record restore (M34),
  and import promotion (M23/M33) all call this one function.

## Landed surface (F02)

F02 lands `validateRecord`, the `ValidationRuleIR` type family, and the schema
well-formedness checks promotion needs. `analyzeImpact` and the full
`validateSchemaTransition` surface belong to F04's schema editors and are **not
exported**; a test asserts their absence.

- `rules.ts` — `VALIDATION_ISSUE_KINDS` / `VALIDATION_SEVERITIES` (migration
  005's `record_issues` closed sets, pinned by test), `ValidationIssueV1`,
  `ValidationReport`, `buildReport` (invalid ⇔ a blocking issue exists),
  `ValidationRuleIR` + `RuleConditionV1` — a deliberately total record-rule IR
  (`field-present` / `field-absent` / `field-equals` / `all` / `any` / `not`):
  no arithmetic, no calls, nothing that could execute imported behavior.
  Reasons are `messageKey` + typed `messageParameters`; **the offending cell
  value is never a parameter.**
- `validate-record.ts` — `validateRecord(context, record)`, `ValidationContext`
  (table, enum options, rules, `referenceExists` resolver),
  `RecordUnderValidationV1`, `ReferenceResolver`. **Invariant 5 is held by the
  signature**: two parameters, no options object, so no caller can opt out of
  the referential or cross-field checks.
- `schema-checks.ts` — `validateSchema(tables, enumOptions)`: unique IDs and
  ordinals, labels present, enum-option ownership/activity, key/label fields
  owned by their table — the constraints migration 005 enforces, checked before
  promotion writes a schema the projection could not load.

**Severity policy (landed, F02-binding):** imported-invalid values and broken
references are preserved and flagged as **warnings** — they commit, which is
what FR-4 requires. Blocking is reserved for what a user authored and can fix
now: wrong type, missing required, unknown enum option, unknown field, wrong
table. D23 carries the **whole** `ValidationReport` across the RPC as a typed
result, never as an error kind.

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
