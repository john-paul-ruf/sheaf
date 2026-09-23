# M46 — UI schema (`src/ui/schema/`)

> Seeded by Planner for F04 (formulas-queries-charts) from `specs/architecture.md`
> § Module Structure / UI modules ("SCR-035–037, MOD-014–015, and SHT-014:
> schema, rule, formula, theme, and app-settings editors") and § Module
> Contracts / UI feature modules, plus `specs/design.md`. Reconciled against
> the tree at `5bc19fb` (F04 final).

## Contract

- **Owns (approved surfaces):** SCR-035 (app structure editor), SCR-036 (theme
  editor), SCR-037 (app settings), MOD-014 (schema impact confirmation),
  MOD-015 (unsupported-formula rewrite), SHT-014 (field/table action menu).
- **Exports:** Route components and typed user intents.
- **Depends on:** M38, M39, M40 (tokens; the contrast gate result for
  SCR-036), M37 (`src/application/view-models/schema.ts`, `theme.ts`).
- **Must not:**
  - Acknowledge a schema or theme change before `CommitConfirmed`.
  - Apply a schema change without showing the previewed exact impact counts
    (FR-15).
  - Present a destructive or value-discarding path. Values are preserved and
    flagged (D57).
  - Let an app theme recolour or rename safety semantics
    (`SYSTEM_OWNED_PROPERTIES`).
  - Accept free-text rule logic. Rules are structured clauses (D52).
  - Evaluate or `eval` formula text. Formulas are parsed and translated in
    the worker.

## Landed surface (SESSION-06: SCR-035/037, MOD-014/015, SHT-014; SESSION-08: SCR-036)

**Files:** `structure-screen.tsx` (SCR-035: tables/fields lists,
`FieldEditor`, rules, calculations, table rename), `field-editor.tsx` (name,
kind, required, key/label, choices, connection, calculation, remove/restore;
exports `FIELD_FOCUS`), `enum-editor.tsx`, `relationship-editor.tsx`,
`rule-editor.tsx` (`RuleEditorDialog`, structured `compare` clause only),
`formula-editor.tsx` (`FormulaEditorDialog`, `SYNTAX_HINT`),
`unsupported-formula-dialog.tsx` (MOD-015), `impact-dialog.tsx` (MOD-014),
`field-actions-sheet.tsx` (SHT-014; `FieldActionV1`), `app-settings-screen.tsx`
(SCR-037), `theme-screen.tsx` (SCR-036, S08 new: palette radios, custom
accent, mode, density, logo, verdict, preview, "Save theme locally"),
`schema.module.css`, `theme.module.css`.

**Contract held:** every surface proposes one `SchemaChangeVm` (alias of
`SchemaChangeWireV1`) and applies nothing itself; the route previews, MOD-014
shows the preview's counts, and apply names the previewed revision. No
free-text rule input (D52): the rule editor emits `{kind:"compare", left, op,
right:{field}|{value}}` only. Formula text is never parsed on the page.
`src/ui/schema/**` imports only React, React Aria, siblings and VM types
(`tests/unit/ui/architecture.test.ts`); protocol shapes reach it through VM
aliases (`SchemaChangeVm`, `RuleConditionVm`, `FieldTypeKindVm`).

**Text → Choice list, named choices (S06 lease r2, CP4a `3b7ecfa`).** When
the chosen kind is Choice list and the field is not already one,
`field-editor.tsx` shows a `[data-editor="new-choices"]` list asking the
person to name the choices; "Change type" is disabled until at least one
choice is named. This is the UI half of D57's Text → Choice list conversion:
`SchemaChangeRequestV1.change-field-type.optionLabels` (M34) allocates one
active option per named label, `schema-impact.ts` (M02) converts existing
values against them by exact label, and `schema.ts` (M37)'s `describeChange`
states the new choices in MOD-014's preview ("Change {field} to Choice list
with the choices A, B"). Deriving choices from the column's distinct values
was **not** chosen — that would be a product decision the plan did not make.

**Truthful per feature (SCR-037):** re-upload / export / remove render as
disabled `Button`s with `LATER_RELEASE` ("Arrives in a later release."); no
backup action. The "Appearance → Theme & logo" card (S08) links SCR-036 and
shows the theme summary.

## Change History

- 2026-09-23 — fragment seeded (Planner, F04 planning).
- 2026-09-23 — SCR-035/037, MOD-014/015, SHT-014 landed by SESSION-06
  (`e7e7fe2`..`7ec391e`); the Text → Choice list named-choices editor by
  SESSION-06 lease r2 (`3b7ecfa`); SCR-036 by SESSION-08 (`42decba`..
  `7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): two SESSION deltas
  plus the lease-r2 correction folded into one "Landed surface" section (the
  r2 correction had been staple-appended to `M38-ui-primitives.md` instead of
  here — moved during reconciliation, see PROGRAM-CONFIG's
  fragment-reconciliation note and `M38-ui-primitives.md`'s own Change
  History).
