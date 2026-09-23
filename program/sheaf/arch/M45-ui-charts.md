# M45 — UI charts (`src/ui/charts/`)

> Seeded by Planner for F04 (formulas-queries-charts) from `specs/architecture.md`
> § Module Structure / UI modules, § Module Contracts / UI feature modules,
> § Formula, Query, and Chart Architecture / Charts, and `specs/design.md`.
> Reconciled against the tree at `5bc19fb` (F04 final).

## Contract

- **Owns (approved surfaces):** SCR-033 (chart detail), SCR-034 (chart
  builder), SCR-053 (charts index, DF-2), MOD-012 (discard chart draft),
  MOD-013 (chart saved / pin choice), SHT-012 (chart-mark detail), SHT-017
  (chart/table accessibility view).
- **Exports:** Route components and typed user intents.
- **Depends on:** M38 (primitives), M39 (layout), M40 (tokens — `app-accent`
  and the secondary chart series colour), M37
  (`src/application/view-models/records.ts`, where the chart VMs live — see
  `M37-view-models.md`), and **Chart.js 4.5.1** (architecture § Stack
  Decision), pinned exactly.
- **Must not:**
  - Acknowledge a chart save before `CommitConfirmed`.
  - Hide a partial or sampled chart (STA-015).
  - Let colour carry meaning alone.
  - Import persistence, crypto, parser or provider code.
  - Compute an aggregate: datasets are worker-produced and bounded
    (architecture § Charts).
- **Chart.js boundary.** Chart.js owns drawing and mark hit-testing **only**.
  It is imported from exactly one file, `chart-canvas.tsx`, which
  `tests/unit/ui/architecture.test.ts` asserts with a negative control.
  Accessibility (text summary, data table) and partial-scope truth are
  Sheaf-owned. Selecting a mark emits a typed filter intent consumed by the
  records query (M35), never by this module.

## Landed surface (SESSION-05)

Files: `chart-canvas.tsx` (the only Chart.js importer; registers Bar/Line/
Pie/Scatter controllers, Bar/Line/Point/Arc elements, Category/Linear scales,
Legend, Tooltip; palette from `--app-accent`, `--violet-600`, `--app-primary`,
`--app-ink`; `aria-hidden` canvas; hit-test → `onMark`; reduced motion →
`animation: false`; pure `chartConfiguration`), `chart-figure.tsx` (canvas +
CTL-075 mark list + summary; `ChartScope` = STA-015), `chart-text.ts` (all
chart sentences), `chart-detail-screen.tsx` (SCR-033),
`mark-detail-sheet.tsx` (SHT-012), `accessibility-view-sheet.tsx` (SHT-017),
`chart-builder-screen.tsx` (SCR-034), `discard-draft-dialog.tsx` (MOD-012),
`chart-saved-dialog.tsx` (MOD-013), `charts-index-screen.tsx` (SCR-053,
DF-2), `charts.module.css`.

**Chart.js probe (S05 CP0), passed:** registry `latest` = 4.5.1, installed
exact; 0 `eval`/`new Function`/network API use (`fetch`, `XMLHttpRequest`,
`WebSocket`, `sendBeacon`, `importScripts`)/`blob:` worker in the built
bundle; tree-shaken registration confirmed (only the needed controllers/
elements/scales registered); lazy chunk 185,890 B.

**Delivered:** chart detail with a mark → SHT-012 → a filtered records list
(keyboard-driven mark selection proven at the real entry; a canvas-coordinate
pointer click is covered in jsdom only — carried to the GATE-F04 reviewer);
SHT-017 summary and a paged table; STA-015 named sample/omission; the builder
with all five types, grouping including one relationship hop, measures, a
live preview within budget, save/pin, and drafts (encrypted operational
state, D61, one per app, owned by the data worker's `chart-handlers.ts`); the
charts index (SCR-053) listing every chart with its origin and pin state.

## Known gaps with owners (open at `5bc19fb`)

- **The chart canvas recolours only on the next render after a live scheme
  flip** (system dark/light toggling mid-session, not a page reload) —
  carried to the next feature leasing `src/ui/charts/**`.
- **Tree-shaking is partial**: dead timeseries/log-scale classes remain
  reachable in the bundle even though no chart type uses them — carried as a
  bundle-hardening item to the next feature leasing this directory.
- **No canvas-coordinate click in e2e** — covered by jsdom + keyboard
  selection only; carried to the GATE-F04 reviewer.
- **MOD-012 guards only Cancel/Close**, not a router-level navigation
  blocker — carried to the GATE-F04 reviewer.
- **At 320px the chart builder's Measure list does not open to a pointer
  click** — owner: the next feature leasing `src/ui/charts/**`; also named
  for the GATE-F04 reviewer.

## Change History

- 2026-09-23 — fragment seeded (Planner, F04 planning).
- 2026-09-23 — landed by SESSION-05 (`6ee204c`..`3dd1d2d`): CAP-32/33 proven
  through the real entry (`tests/e2e/charts.spec.ts`); the charts index
  (DF-2) landed at CP5.
- 2026-09-23 — reconciled by Archivist (F04 final pass): the SESSION-05 delta
  folded into "Landed surface"; the CP0 Chart.js probe results and the five
  Final-Report-recorded residual gaps (chart-recolour timing, partial
  tree-shaking, no canvas-click e2e, MOD-012's guard scope, the 320px Measure
  list) moved into this fragment from the Final Report, so the module's own
  record states its own open items rather than only the run-level report.
