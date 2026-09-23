# M14 — Pre-flight (`src/import/preflight/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import source and pre-flight + § Import Architecture
> Stage 1. Reconciled against the tree at `425562d` (F03 final; code ≡
> `30396a9`).

## Contract

- **Owns:** Metadata-only sizing, safety bounds, unsafe-format detection, and
  the selection plan **before any cell data is parsed** — for both delimited
  text and (F03) multi-sheet workbooks.
- **Exports:** `RefusalV1`, `REFUSAL_KINDS`, `REFUSAL_REMEDIES`,
  `classifyRefusal`, `preflightDelimited`, `PreflightReportV1`,
  `PreflightOutcomeV1`, `isDelimitedSniff`, and (F03) `preflightWorkbook`,
  `routeOf`, `WorkbookPreflightReportV1`, `WorkbookRouteV1`.
- **Depends on:** M13 source primitives; M65 (F03, inventory/adapter
  interfaces only — **M14 never imports an adapter**, D35); domain capacity
  (fixed conservative budget constants, D20/D31 — the adaptive M04 budgets are
  F07).
- **Contract:** May read magic bytes, directories, and declared structure;
  must not iterate cell data. For delimited text, sizing is a bounded sample:
  row counts are estimates and must be presented as estimates until the parse
  completes (D24). For workbooks, every sheet's estimates are metadata-only
  (D31).

## Landed surface

`refusal.ts`: `RefusalV1` closed union over `REFUSAL_KINDS` (`macro-content`,
`numbers-file`, `pages-file`, `pdf-file`, `workbook-format-later-release`,
`over-import-budget`, `binary-unreadable`) with the remedy id **held by the
type**. `classifyRefusal(sniff) → RefusalV1 | null` is total over
`DetectedFormatV1`; `null` means "proceed to delimited or workbook
pre-flight". **F03:** `binary-unreadable` gains a **required**
`detail: UnreadableDetailV1`. `classifyRefusal` no longer refuses CFB / OOXML
zip / ODS zip / HTML table (returns `null` → workbook pre-flight); it still
refuses PDF, binary, iWork, unknown zip. `laterReleaseRefusal(sniff)` answers
F02's `workbook-format-later-release` verbatim for a page that does not accept
the workbook flow (D48); `null` for anything not a workbook container.
`unreadable(fileName, detail)`, `iworkRefusal`, `laterRelease` are the
constructors.

`preflight.ts`: `preflightDelimited(source, sniff: DelimitedSniffV1) →
PreflightOutcomeV1` (`proceed{report} | refused{refusal}`), plus the guard
`isDelimitedSniff`. One bounded read of `PREFLIGHT_SAMPLE_BYTES = 65_536`.
`PreflightReportV1.isEstimate` is the **literal `true`** (D24 as a type).
Budgets: `budgets.ts`'s `IMPORT_BUDGET_V1` (D31); `preflight.ts`'s
`F02_IMPORT_MAX_*` are aliases of it. `estimatedRowCount` counts **every
physical row, header included**. Pre-flight splits its sample through M19's
real parser.

`workbook.ts` (new, F03): `preflightWorkbook(source, sniff, readers) →
WorkbookPreflightOutcomeV1`, `routeOf(sheets, sheetListKnown, budget?)`,
`WorkbookPreflightReportV1 {fileName, sourceByteLength, format,
formatContradiction, sheets, sheetListKnown, dateSystem, totals{sheetCount,
estimatedRowCount|null, estimatedCellCount|null, preservedPartCounts}, route,
defaultSelection, budgets, isEstimate: true}`, `WorkbookRouteV1`,
`WorkbookFormatContradictionV1 {declaredExtension, detectedFormat}`,
`WorkbookTotalsV1`. Identification: zip by `[Content_Types].xml` (xlsb/xlsx)
→ iWork (`Index/`, `.iwa`) → `mimetype` (ods); cfb → encrypted refusal or
`Workbook`/`Book` → xls; html-table → text. No reader ⇒
`workbook-format-later-release`. Routing (D31): > 50 sheets ⇒ handoff; total
≤ 250k ⇒ fits (all); else subset if any sheet fits alone and the sheet list
is known (default selection = longest workbook-order prefix that fits, D47)
else handoff (empty selection). Imports no adapter (swept, D35) — the
readers/`WorkbookAdapterV1` registry is composed by the import worker (M33).

## F02 routes as landed (delimited)

- Delimited within budget → `proceed`.
- Delimited over the fixed budget → `over-import-budget` → SCR-019 delimited
  variant.
- ZIP/CFB workbook containers → **F03:** `preflightWorkbook` (no longer a
  blanket `workbook-format-later-release`; see above).
- Numbers / Pages / PDF → their approved per-format refusals.
- Every refusal names the file and carries a remedy id; no staging exists at
  refusal time, so no cleanup is required (FR-2).

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`.
  Swept by `tests/unit/import/module-boundaries.test.ts` over the four named
  module directories.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — implemented by SESSION-03 (`ad0871e`); consumed by the import
  worker at `cd74e6d` and by SCR-019/021 at `8a665c1`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-03 staple folded
  in; the seeded "F02 routes" list rewritten to name the landed refusal kinds;
  the real-numbers payload rule recorded where its consumers can find it.
- 2026-09-23 — F03: `budgets.ts`, `workbook.ts` (new), and `refusal.ts`'s
  required `detail` + workbook routing change landed by SESSION-01
  (`dd1ff9e`..`64bc49a`) and SESSION-06 (`4287569`..`677b947`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the two SESSION
  staples folded into the Landed surface and F02-routes sections; the
  `binary-unreadable.detail` optional→required transition stated as the
  current fact rather than left as two conflicting statements.
