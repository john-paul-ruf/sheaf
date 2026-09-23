# M20 — HTML-table adapter (`src/import/formats/html-table/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Fidelity and preservation.
> Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** A non-executing tokenizer for legacy HTML table exports
  (typically disguised as `.xls`), producing value-only M65 facts.
- **Exports:** `readHtmlTableInventory` (M65 `InventoryReaderV1`),
  `htmlTableAdapter` (M65 `WorkbookAdapterV1`).
- **Depends on:** M13 (`RandomAccessSource`), M65. Its own tokenizer — **not**
  M13's XML tokenizer, because legacy HTML is not well-formed XML.
- **Contract:** Scripts, styles, event attributes, images, links and external
  resources are ignored; only table structure and decoded text become
  value-only facts. Each `<table>` is one sheet in document order. Entities
  are decoded from a fixed table plus numeric references; nothing is
  fetched, no markup reaches any snapshot, and the ignored active content is
  inventoried as inert (`script`, `external-link`, `image`) rather than
  silently dropped (FR-9).

## Landed surface (SESSION-05)

- **Exports (landed):** `readHtmlTableInventory` (format `"html-table"`),
  `htmlTableAdapter` from `index.ts`. Internal: `tokenizeHtml`,
  `detectHtmlEncoding`, `DEFAULT_HTML_ENCODING` (`tokenizer.ts`),
  `decodeCharacterReferences`, `NAMED_CHARACTER_REFERENCES` (`entities.ts`),
  `createTableWalker` (`structure.ts`), `HTML_MAX_VALUE_CELLS = 250_000`
  (`parse.ts`), `MIN_HTML_CELL_MARKUP_BYTES = 5` (`inventory.ts`).
- **Files:** `tokenizer.ts`, `entities.ts`, `structure.ts` (Custom Rule 7:
  the table model shared by inventory and adapter), `inventory.ts`,
  `parse.ts`, `index.ts`.
- **Edges:** M13 (`bounds`, `sniff.SNIFF_SAMPLE_BYTES`, `source` type), M65,
  M01 `values`. Own tokenizer, not M13's XML one.
- **Encoding rule:** BOM (UTF-8/UTF-16LE/UTF-16BE) → `<meta charset>`/
  `http-equiv` charset in the first 8 KiB (unknown label ignored; a UTF-16
  label without BOM → UTF-8) → else **Windows-1252**.
- **Invariant 8 (type/structure-held):** `<script>` content is skipped as
  raw text and never delivered by the tokenizer; `<style>` content only as a
  `raw` token read for `mso-number-format`; comments/CDATA/declarations
  skipped, conditional-comment bodies read only for `x:Name`. Active content
  → `preserved-part`: `script`, `image`, `external-link`, `hyperlink`
  (`#…`), `embedded-object`, `form-control`; one `formula` part per sheet
  with `x:fmla` (formulas never read), one `cell-styling` per styled sheet.
- **Sheets:** each top-level `<table>`; name = `<caption>`, else Excel
  `x:Name`, else `Table N`; nested tables fold into their cell's text. Grid:
  browser-style implied closes, `rowspan` occupancy, `colspan` ≤ 1000,
  `rowspan` ≤ 65534. Values: text (NFC), except `x:num` → decimal, `x:bool`
  → boolean, `x:err` → invalid-preserved + `error-value`;
  `mso-number-format` → `cell-format`.
- **Inventory:** reads at most `SNIFF_SAMPLE_BYTES` (8 KiB). Whole file in
  the sample → exact sheets/rows/cells, `sheetListKnown: true`; larger →
  `sheetListKnown: false`, last seen table extrapolated by bytes-per-row. No
  macro outcome exists for HTML.
- **Known limit (accepted, not a defect):** the demo HTML pair produces no
  key-match relationship (containment 58/60 = 0.967, below
  `KEY_MATCH_CONTAINMENT` = 0.98, because a broken key repeats) — a
  conservative default, recorded in the GATE-F03 demo package's known-limits
  list; see `M21-inference.md`.

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).
- 2026-09-23 — landed by SESSION-05 (`871924f`..`5df4b01`); registered and
  proven through the real worker by SESSION-06 (`4287569`..`677b947`); e2e
  smoke by SESSION-07/08.
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-05
  delta folded into "Landed surface"; the HTML key-match known limit
  cross-referenced against `M21-inference.md`, where the threshold lives,
  rather than restated in full.
