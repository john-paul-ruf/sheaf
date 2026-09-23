# M20 — HTML-table adapter (`src/import/formats/html-table/`)

> Seeded by Planner for F03 (workbook-fidelity) from `specs/architecture.md`
> § Import and inference (module table) and § Fidelity and preservation.

## Contract

- **Owns:** A non-executing tokenizer for legacy HTML table exports (typically
  disguised as `.xls`), producing value-only M65 facts.
- **Exports (planned, F03 S05):** `readHtmlTableInventory` (M65
  `InventoryReaderV1`), `htmlTableAdapter` (M65 `WorkbookAdapterV1`).
- **Depends on:** M13 (`RandomAccessSource`), M65. Its own tokenizer — **not**
  M13's XML tokenizer, because legacy HTML is not well-formed XML.
- **Contract:** Scripts, styles, event attributes, images, links and external
  resources are ignored; only table structure (`table`/`tr`/`td`/`th`,
  `colspan`/`rowspan` expanded sparsely and bounded) and decoded text become
  value-only facts. Each `<table>` is one sheet in document order. Entities are
  decoded from a fixed table plus numeric references; nothing is fetched, no
  markup reaches any snapshot, and the ignored active content is inventoried as
  inert (`script`, `external-link`, `image`) rather than silently dropped
  (FR-9).

## Dependency must-nots (ship as tests)

- As M15.

## Change History

- 2026-09-22 — fragment seeded (Planner, F03 planning).

<!-- workbook-fidelity SESSION-05 -->
### workbook-fidelity SESSION-05 (2026-09-22, commits 871924f..5df4b01)

**M20 — HTML-table adapter (`src/import/formats/html-table/`) — created**

- **Exports (landed):** `readHtmlTableInventory` (`InventoryReaderV1`, format `"html-table"`), `htmlTableAdapter` (`WorkbookAdapterV1`) from `index.ts`. Internal: `tokenizeHtml`, `detectHtmlEncoding`, `DEFAULT_HTML_ENCODING` (`tokenizer.ts`), `decodeCharacterReferences`, `NAMED_CHARACTER_REFERENCES` (`entities.ts`), `createTableWalker` (`structure.ts`), `HTML_MAX_VALUE_CELLS = 250_000` (`parse.ts`), `MIN_HTML_CELL_MARKUP_BYTES = 5` (`inventory.ts`).
- **Files:** `tokenizer.ts`, `entities.ts`, `structure.ts` (Custom Rule 7: the table model shared by inventory and adapter so both name the same sheets), `inventory.ts`, `parse.ts`, `index.ts`.
- **Edges:** M13 (`bounds`, `sniff.SNIFF_SAMPLE_BYTES`, `source` type), M65, M01 `values`. Own tokenizer, not M13's XML one.
- **Encoding rule:** BOM (UTF-8/UTF-16LE/UTF-16BE) → `<meta charset>` / `http-equiv` charset in the first 8 KiB (unknown label ignored; a UTF-16 label without BOM → UTF-8, per the HTML standard) → else **Windows-1252**.
- **Invariant 8 (type/structure-held):** `<script>` content is skipped as raw text and never delivered by the tokenizer; `<style>` content only as a `raw` token read for `mso-number-format` (a code containing markup is discarded); comments/CDATA/declarations skipped, conditional-comment bodies read only for `x:Name`. Active content → `preserved-part`: `script` (script tag, `on*` attribute, `javascript:`/`vbscript:` URL), `image`, `external-link` (other off-document `href`/`src`/`data`/`action`), `hyperlink` (`#…`), `embedded-object`, `form-control`; one `formula` part per sheet with `x:fmla` (formulas never read), one `cell-styling` per styled sheet.
- **Sheets:** each top-level `<table>`; name = `<caption>`, else Excel `x:Name` (in order), else `Table N`; nested tables fold into their cell's text. Grid: browser-style implied closes, `rowspan` occupancy, `colspan` ≤ 1000, `rowspan` ≤ 65534. Values: text (NFC, `replacement-character` diagnostic on U+FFFD), except `x:num` → decimal, `x:bool` → boolean, `x:err` → invalid-preserved + `error-value`; `mso-number-format` (inline or class) → `cell-format` by M65's rule (a cell declaring none is `General`).
- **Inventory:** reads at most `SNIFF_SAMPLE_BYTES` (8 KiB). Whole file in the sample → exact sheets/rows/cells, `sheetListKnown: true`; larger → `sheetListKnown: false`, last seen table extrapolated by bytes-per-row (no row seen → rows `null`, cells `size/5`). No macro outcome exists for HTML.
