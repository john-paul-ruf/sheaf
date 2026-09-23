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
