# M19 — Delimited adapter (`src/import/formats/delimited/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Format adapters + § Import Architecture Stage 2.
> Reconciled against the tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Chunked CSV/TSV delimiter/encoding handling, row iteration, and
  value-only facts (FR-1: no structure assumed).
- **Exports:** `parseDelimited`. The fact vocabulary itself (`WorkbookFactV1`/
  `V2`, `ImportDiagnosticV1`, `factStreamItemToCanonicalValue`) moved to M65 in
  F03 (D32, below); this module no longer owns it.
- **Depends on:** M13 source primitives, M65 (facts). Never UI, never
  persistence, never crypto.
- **Contract:** Incremental and cancellable; bounded batches; quoted fields,
  embedded delimiters/newlines, and mixed line endings handled; malformed
  input degrades to preserved raw text values with diagnostics, never a crash
  and never a silent drop. The whole file is never required in memory (FR-3).
- CSV/TSV emit **value-only** facts: no formula, validation, chart, or
  relationship structure is ever claimed (SCR-017 copy).
- The fact vocabulary is **format-neutral by design** and is shared with F03's
  OOXML/XLSB/BIFF/ODS/HTML adapters (M15–M18, M20) through M65.

## Landed surface

`parse.ts`: `parseDelimited(source, format, options?) →
AsyncGenerator<WorkbookFactStreamItemV2>`. Bounds:
`DELIMITED_READ_CHUNK_BYTES = 65_536`, `DELIMITED_FACTS_PER_BATCH = 1024`
(hard — a row's facts may span two batches), `DELIMITED_MAX_ROW_CHARACTERS =
4_194_304` (an unterminated quote ends the row with a diagnostic instead of
buffering the file). All three are overridable through
`DelimitedParseOptionsV1`. **D28 lives here:** every cell is NFC-normalized at
this boundary and the normalization is announced as an `ImportDiagnosticV1`
(`text-normalized-nfc`); the raw source bytes stay byte-faithful in D21's
encrypted source chunks. Diagnostics are aggregated — one fact at first
occurrence per code, full tallies in the summary. Cancellation is checked
between batches.

**F03: `parseDelimited` emits V2 items.** New option `sheetName?: string`:
when given, the stream opens with one `sheet` fact (`sheetIndex 0`, the name,
`worksheet`, `visible`, `declaredRange null`, `dateSystem "1900"`); every other
fact is byte-identical to the V1 shape. The import worker passes the file
stem; pre-flight's sample parse passes nothing (so a delimited sample stays a
zero-`sheet` stream — see `delimitedStream` in M21).

## D30/D32: `facts.ts` history (closed)

F02 landed the fact vocabulary here as `facts.ts`. F03's S01 moved it to M65
(the format-neutral home every adapter needs) and left `facts.ts` as a
V1-only re-export so the seven F02 consumers compiled unchanged during the
transition; S06 migrated every consumer to import from M65 directly. **The
re-export is now deleted** (D32, closed by OWNER-IMPORT-F03-SEAMS `87da253`,
together with the pin that had kept it alive in
`tests/unit/import/facts/workbook-facts.test.ts`). M65 `src/import/facts/` is
the sole home of the fact vocabulary; this module has no `facts.ts` file at
`30396a9`.

## Sparsity and terminal-summary rules (inherited from M65, restated here for
this module's consumers)

**Sparsity is the contract.** A value fact exists only where a cell has a
value. Below a row's `cellCount` with no value fact ⇒ `blank`; at or above it
⇒ `missing`. **Never collapse them.**

**Terminal summary ⇒ completed.** A cancelled stream ends with no summary.
M21's `inferWorkbook`/`inferProposal` throw on a stream with no summary rather
than synthesising one; M36's cancel path awaits the parser's terminal event
before invoking cleanup.

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
- 2026-09-23 — F03: `facts.ts` became a V1 re-export at `dd1ff9e`..`64bc49a`
  (SESSION-01, D32 in progress); `parseDelimited` moved to V2 items with the
  `sheetName` option at `4287569`..`677b947` (SESSION-06); the re-export
  deleted at `87da253` (OWNER-IMPORT-F03-SEAMS, D32 complete).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the vocabulary-owning
  claims removed from this fragment's Contract/Exports (M65 owns them now);
  the D30/D32 transition folded into one closed history section instead of
  three separate staples describing three different states of the same file;
  the ODS-declared-table ordering counterexample that OWNER-IMPORT-F03-SEAMS
  also fixed is recorded in `M18-ods.md` and `M65-workbook-facts.md`, where the
  fix actually landed — not duplicated here.
