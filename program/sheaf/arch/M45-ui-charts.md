# M45 — UI charts (`src/ui/charts/`)

> Seeded by Planner for F04 (formulas-queries-charts) from `specs/architecture.md`
> § Module Structure / UI modules, § Module Contracts / UI feature modules,
> § Formula, Query, and Chart Architecture / Charts, and `specs/design.md`.
> Not yet landed at planning base `21946c7`.

## Contract

- **Owns (approved surfaces):** SCR-033 (chart detail), SCR-034 (chart
  builder), MOD-012 (discard chart draft), MOD-013 (chart saved / pin choice),
  SHT-012 (chart-mark detail), SHT-017 (chart/table accessibility view). F04
  also places the charts-index surface here once design-fill DF-2 supplies it.
- **Exports:** Route components and typed user intents.
- **Depends on:** M38 (primitives), M39 (layout), M40 (tokens — `app-accent`
  and the secondary chart series colour), M37
  (`src/application/view-models/charts.ts`), and **Chart.js 4.x**
  (architecture § Stack Decision), pinned exactly.
- **Must not:**
  - Acknowledge a chart save before `CommitConfirmed`.
  - Hide a partial or sampled chart (STA-015).
  - Let colour carry meaning alone.
  - Import persistence, crypto, parser or provider code.
  - Compute an aggregate: datasets are worker-produced and bounded
    (architecture § Charts).
- **Chart.js boundary.** Chart.js owns drawing and mark hit-testing **only**.
  It is imported from exactly one file (planned: `chart-canvas.tsx`), which
  `tests/unit/ui/architecture.test.ts` asserts. Accessibility (text summary,
  data table) and partial-scope truth are Sheaf-owned. Selecting a mark emits
  a typed filter intent consumed by the records query (M35), never by the
  chart module.

## Planned F04 scope (SESSION-05)

Chart detail with mark → SHT-012 → a filtered records list; SHT-017 summary
and paged table; STA-015 named sample/omission; the builder with five types,
grouping including one relationship hop, measures, live preview, save/pin,
drafts (encrypted operational state, D61); pinned charts on the app home
(M44 hosts the slot).

## Change History

- 2026-09-23 — fragment seeded (Planner, F04 planning).
