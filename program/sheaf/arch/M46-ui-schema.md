# M46 — UI schema (`src/ui/schema/`)

> Seeded by Planner for F04 (formulas-queries-charts) from `specs/architecture.md`
> § Module Structure / UI modules ("SCR-035–037, MOD-014–015, and SHT-014:
> schema, rule, formula, theme, and app-settings editors") and § Module
> Contracts / UI feature modules, plus `specs/design.md`. Not yet landed at
> planning base `21946c7`.

## Contract

- **Owns (approved surfaces):** SCR-035 (app structure editor), SCR-036 (theme
  editor), SCR-037 (app settings), MOD-014 (schema impact confirmation),
  MOD-015 (unsupported-formula rewrite), SHT-014 (field/table action menu).
- **Exports:** Route components and typed user intents.
- **Depends on:** M38, M39, M40 (tokens; the contrast gate for SCR-036), M37
  (`src/application/view-models/schema.ts`, `theme.ts`).
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

## Planned F04 scope

- SESSION-06: SCR-035 + SHT-014 + MOD-014 + MOD-015 + SCR-037.
- SESSION-08: SCR-036 (palettes from design-fill DF-1, custom accent,
  light/dark/system, comfortable/compact, logo, contrast verdict).

## Change History

- 2026-09-23 — fragment seeded (Planner, F04 planning).

<!-- formulas-queries-charts SESSION-06 -->
### F04 delta — SESSION-06 (M46 — UI schema (`src/ui/schema/`) — landed (SCR-035, SCR-037, MOD-014, MOD-015, SHT-014))

- **Files:** `structure-screen.tsx` (SCR-035: tables/fields lists, `FieldEditor`, rules, calculations, table rename), `field-editor.tsx` (name, kind, required, key/label, choices, connection, calculation, remove/restore; exports `FIELD_FOCUS`), `enum-editor.tsx`, `relationship-editor.tsx`, `rule-editor.tsx` (`RuleEditorDialog`, structured `compare` clause only), `formula-editor.tsx` (`FormulaEditorDialog`, `SYNTAX_HINT`), `unsupported-formula-dialog.tsx` (MOD-015), `impact-dialog.tsx` (MOD-014), `field-actions-sheet.tsx` (SHT-014; `FieldActionV1`), `app-settings-screen.tsx` (SCR-037), `schema.module.css`.
- **Contract held:** every surface proposes one `SchemaChangeVm` (alias of `SchemaChangeWireV1`) and applies nothing itself; the route previews, MOD-014 shows the preview's counts, and apply names the previewed revision. No free-text rule input (D52): the rule editor emits `{kind:"compare", left, op, right:{field}|{value}}` only. Formula text is never parsed on the page. `src/ui/schema/**` imports only React, React Aria, siblings and VM types (`tests/unit/ui/architecture.test.ts`); protocol shapes reach it through VM aliases (`SchemaChangeVm`, `RuleConditionVm`, `FieldTypeKindVm`).
- **Truthful per feature (SCR-037):** re-upload / export / remove render as disabled `Button`s with `LATER_RELEASE` ("Arrives in a later release."); no Theme & logo row (S08 adds it with its route); no backup action.
- SCR-036 (theme) remains S08's.
