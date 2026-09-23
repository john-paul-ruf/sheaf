# M14 — Pre-flight (`src/import/preflight/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import source and pre-flight + § Import Architecture
> Stage 1. Reconciled against the tree at `5ab3b07` (F02 final).

## Contract

- **Owns:** Metadata-only sizing, safety bounds, unsafe-format detection, and
  the selection plan **before any cell data is parsed**.
- **Exports:** `RefusalV1`, `REFUSAL_KINDS`, `REFUSAL_REMEDIES`,
  `classifyRefusal`, `preflightDelimited`, `PreflightReportV1`,
  `PreflightOutcomeV1`, `isDelimitedSniff` (`SheetInventory` gains substance in
  F03).
- **Depends on:** M13 source primitives; domain capacity (F02: fixed
  conservative budget constants — see D20; the adaptive M04 budgets are F07).
- **Contract:** May read magic bytes, directories, and declared structure;
  must not iterate cell data. For delimited text, sizing is a bounded sample:
  row counts are estimates and must be presented as estimates until the parse
  completes (D24; architecture § capacity: counts are never shown as exact
  unless known exactly).

## Landed surface (F02, S03)

`refusal.ts`: `RefusalV1` closed union over `REFUSAL_KINDS` (`macro-content`,
`numbers-file`, `pages-file`, `pdf-file`, `workbook-format-later-release`,
`over-import-budget`, `binary-unreadable`) with the remedy id **held by the
type** — each kind names exactly one of `REFUSAL_REMEDIES`, so no surface can
pair the macro remedy with the PDF refusal. `classifyRefusal(sniff) →
RefusalV1 | null` is total over `DetectedFormatV1`; `null` means "proceed to
delimited pre-flight". `macro-content` has no F02 producer (F03 owns it) and
`over-import-budget` is issued by `preflight.ts`, not here.

`preflight.ts`: `preflightDelimited(source, sniff: DelimitedSniffV1) →
PreflightOutcomeV1` (`proceed{report} | refused{refusal}`), plus the guard
`isDelimitedSniff`. One bounded read of `PREFLIGHT_SAMPLE_BYTES = 65_536`,
whatever the file size — including on the over-budget path, because SCR-019 has
to state real numbers. `PreflightReportV1.isEstimate` is the **literal `true`**,
so D24 is a type rather than a convention. Budgets (D20):
`F02_IMPORT_MAX_SOURCE_BYTES = 52_428_800`,
`F02_IMPORT_MAX_ESTIMATED_CELLS = 250_000`; `PREFLIGHT_SAMPLE_ROWS = 10`.
`estimatedRowCount` counts **every physical row, header included** — which row
is the header is M21's finding at review, not a guess pre-flight makes.
Pre-flight splits its sample through M19's real parser rather than a second row
splitter, so quoting and encodings behave identically on both paths.

**Refusal payloads carry real numbers.** `over-import-budget` names `exceeded`,
`sourceByteLength`, `maxSourceByteLength`, `estimatedCellCount`,
`maxEstimatedCellCount`; every other kind carries `fileName` plus its remedy id.
SCR-019's composed delimited variant and SCR-021's later-release card are
assembled from these facts, never from invented copy (D19/D20).

## F02 routes as landed

- Delimited within budget → `proceed` (SCR-017/018 facts: delimiter, encoding,
  estimated rows, column count).
- Delimited over the fixed F02 budget → `over-import-budget` → SCR-019
  delimited variant (D20; no sheet list, no capacity-detail link until F07).
- ZIP/CFB workbook containers and HTML tables → `workbook-format-later-release`
  → the composed SCR-021 card (D19).
- Numbers / Pages / PDF → their approved per-format refusals (mock copy in
  `import-refused.html`).
- Every refusal names the file and carries a remedy id; no staging exists at
  refusal time, so no cleanup is required (FR-2: no partial app).

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

<!-- workbook-fidelity SESSION-01 -->
### workbook-fidelity SESSION-01 (2026-09-22, commits dd1ff9e..64bc49a)

**M14 — Pre-flight (`src/import/preflight/`) — extended**
- `budgets.ts`: `IMPORT_BUDGET_V1` (D31), `ImportBudgetV1`. `preflight.ts`'s `F02_IMPORT_MAX_*` are now aliases of it (names kept).
- `refusal.ts`: `binary-unreadable` gains **optional** `detail?: UnreadableDetailV1` (optional only because `src/workers/import/parse-session.ts:82`, S06's, builds the refusal without it; every M14 producer sets it). New exports `unreadable(fileName, detail)`, `iworkRefusal`, `laterRelease`. `classifyRefusal` routing unchanged (binary / unknown zip now carry `detail: "unrecognized-content"`).
- `workbook.ts`: `preflightWorkbook(source, sniff, readers) → WorkbookPreflightOutcomeV1`, `routeOf(sheets, sheetListKnown, budget?)`, `WorkbookPreflightReportV1 {fileName, sourceByteLength, format, formatContradiction, sheets, sheetListKnown, dateSystem, totals{sheetCount, estimatedRowCount|null, estimatedCellCount|null, preservedPartCounts}, route, defaultSelection, budgets, isEstimate: true}`, `WorkbookRouteV1`, `WorkbookFormatContradictionV1 {declaredExtension, detectedFormat}`, `WorkbookTotalsV1`. Identification: zip by `[Content_Types].xml` (xlsb / xlsx) → iWork (`Index/`, `.iwa`) → `mimetype` (ods); cfb → encrypted refusal or `Workbook`/`Book` → xls; html-table → text. No reader ⇒ `workbook-format-later-release`. Routing: > 50 sheets ⇒ handoff; total ≤ 250k ⇒ fits (all); else subset if any sheet fits alone and the sheet list is known (default = longest workbook-order prefix that fits) else handoff (empty selection).
- Edges: M13 + M65 only; imports no adapter (swept).

<!-- workbook-fidelity SESSION-06 -->
### workbook-fidelity SESSION-06 (2026-09-23, commits 4287569..677b947)

**M14 — Pre-flight (`src/import/preflight/`)**
- `refusal.ts`: `binary-unreadable.detail` is **required** now. `classifyRefusal` no longer refuses CFB / OOXML zip / ODS zip / HTML table (returns `null` → workbook pre-flight); it still refuses PDF, binary, iWork, unknown zip. New `laterReleaseRefusal(sniff)`: F02's `workbook-format-later-release` answer, verbatim, for a page without the workbook flow (D48); `null` for anything not a workbook container.
