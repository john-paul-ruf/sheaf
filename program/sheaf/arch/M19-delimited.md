# M19 — Delimited adapter (`src/import/formats/delimited/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Format adapters + § Import Architecture Stage 2.
> Reconciled against the tree at `5ab3b07` (F02 final).

## Contract

- **Owns:** Chunked CSV/TSV delimiter/encoding handling, row iteration, and
  value-only facts (FR-1: no structure assumed).
- **Exports:** the shared `WorkbookFactV1` stream contract (value facts, row
  facts, terminal summary), `ImportDiagnosticV1`,
  `factStreamItemToCanonicalValue`, `parseDelimited`.
- **Depends on:** M13 source primitives. Never UI, never persistence, never
  crypto.
- **Contract:** Incremental and cancellable; bounded batches; quoted fields,
  embedded delimiters/newlines, and mixed line endings handled; malformed
  input degrades to preserved raw text values with diagnostics, never a crash
  and never a silent drop. The whole file is never required in memory (FR-3).
- CSV/TSV emit **value-only** facts: no formula, validation, chart, or
  relationship structure is ever claimed (SCR-017 copy).
- The fact vocabulary is **format-neutral on purpose** and is shared with F03's
  OOXML/XLSB/BIFF/ODS/HTML adapters — `facts.ts` is the file to relocate
  unchanged when they land, not to copy.

## Landed surface (F02, S03)

`facts.ts`: `WorkbookFactV1 = row{rowIndex,cellCount} |
value{rowIndex,columnIndex,value: CellValueV1} | diagnostic{...}`,
`WorkbookFactBatchV1 {batchSeq, facts}`, `WorkbookSummaryV1
{rowCount, columnCount, valueCount, batchCount, diagnostics}`,
`WorkbookFactStreamItemV1`, `CancellationTokenV1 {aborted}`,
`ImportDiagnosticV1` over `IMPORT_DIAGNOSTIC_CODES` (`text-normalized-nfc`,
`unterminated-quote`, `quote-inside-unquoted-field`, `ragged-row`,
`replacement-character`, `row-length-bound-reached`).

**Sparsity is the contract.** A value fact exists only where a cell has a value.
Below a row's `cellCount` with no value fact ⇒ `blank`; at or above it ⇒
`missing`. The two absences stay distinct without a dense grid, and a hostile
declared width cannot force one. **Never collapse them.**

**Terminal summary ⇒ completed.** A cancelled stream ends with no summary. That
is the only completion signal; no side channel. M21's `inferProposal` throws on
a summary-less stream rather than synthesising one, and M36's cancel path awaits
the parser's terminal event before invoking cleanup.

`factStreamItemToCanonicalValue(item) → CanonicalFactValueV1` is the exact value
M23 hands the canonical CBOR encoder (CA-10). It lives here, beside the types it
mirrors, and states the CBOR value domain **structurally** so M19 keeps
importing nothing from `src/persistence/`. All integers are `bigint` so a fact
survives encode/decode unchanged.

`parse.ts`: `parseDelimited(source, format, options?) →
AsyncGenerator<WorkbookFactStreamItemV1>`. Bounds:
`DELIMITED_READ_CHUNK_BYTES = 65_536`, `DELIMITED_FACTS_PER_BATCH = 1024`
(hard — a row's facts may span two batches), `DELIMITED_MAX_ROW_CHARACTERS =
4_194_304` (an unterminated quote ends the row with a diagnostic instead of
buffering the file; nothing is dropped). All three are overridable through
`DelimitedParseOptionsV1` so the bounds are testable. **D28 lives here:** every
cell is NFC-normalized at this boundary and the normalization is announced as an
`ImportDiagnosticV1` (`text-normalized-nfc`), which is what keeps FR-4/FR-6
non-silent; the raw source bytes stay byte-faithful in D21's encrypted source
chunks. Diagnostics are aggregated — one fact at first occurrence per code, full
tallies in the summary — so a hostile file cannot turn a bounded parse into an
unbounded diagnostic list. Cancellation is checked between batches; a consumer
that stops iterating leaves no read outstanding.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  or any third-party package. Swept by
  `tests/unit/import/module-boundaries.test.ts` over the four named module
  directories.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — implemented by SESSION-03 (`ad0871e`), including D28's parse half;
  consumed by the import worker (`cd74e6d`) and, through the channel, by M23's
  staging encoder.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-03 staple folded
  in; the terminal-summary rule cross-referenced to its two consumers (M21, M36);
  the M58 fixture note that was stapled here moved to its own fragment,
  `M58-workbook-fixtures.md`.

<!-- workbook-fidelity SESSION-01 -->
### workbook-fidelity SESSION-01 (2026-09-22, commits dd1ff9e..64bc49a)

**M19 — Delimited — `facts.ts` now a V1 re-export**
- Re-exports the V1 names from M65; `IMPORT_DIAGNOSTIC_CODES` here is `IMPORT_DIAGNOSTIC_CODES_V1` so F02's exhaustive `SEVERITY` map stays exhaustive. S06 migrates consumers and deletes it.
