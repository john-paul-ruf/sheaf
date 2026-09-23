# M58 — Workbook fixtures (`tests/fixtures/workbooks/`)

> Fragment created by Roshi at the F02 final pass. Reconciled against the tree
> at `5bc19fb` (F04 final; formulas-queries-charts).

## Contract

- **Owns:** The fidelity + refusal corpus per import format.
- **Corpus owner rule:** the fixture corpus belongs to **one** session's lease
  and is unreachable to every later one. A later session either plans its
  fixtures inside its own lease or names this corpus's owner as a supplier.
  F02's S04 hit this and built synthetic in-page fixtures for its volume cases
  instead. F03 avoided a repeat: S01's `tests/fixtures/workbooks/build/`
  generator toolkit was planned into S01's own lease and reused *unmodified*
  by S02/S04/S05 through its exported helpers. **F04 continued the pattern
  without incident**: S02 extended `ooxml-builder.ts` (its own F03-owned
  fixture-building lease) to add chart/pivot specs, and every later F04
  session that needed a chart-bearing fixture (S05, S07) read S02's corpus
  rather than building a second one.

## Byte fidelity (`.gitattributes`)

`tests/fixtures/workbooks/.gitattributes` sets `* -text`. **A fixture's bytes
are the test subject.** Every fixture author under this path inherits this
attribute; adding a fixture directory outside this path re-opens the hazard.

## F02 corpus (delimited)

Delimited fidelity + refusal fixtures for M13 sniffing, M14 refusal routing,
M19 parsing and M21 inference, including the pinned demo file
`field-log-messy.csv`, an NFD crew fixture for D28, and ragged/quoting/
encoding cases.

## F03 corpus (workbook formats)

- **`build/`** (SESSION-01): `zip-writer.ts` (deterministic LZ77+fixed-Huffman
  deflate), `cfb-writer.ts`, `ooxml-builder.ts`, `corpus.ts` (the generator
  map), `oversized.ts` (test-time only) — the shared toolkit every later
  format session builds on.
- **`ooxml/`** (SESSION-01): 12 fidelity workbooks (`build-fidelity.ts`), the
  pinned demo `fieldwork-q3.xlsx` (`build-demo.ts`, `demo-counts.ts`).
  `unsafe/`: 19 refusal fixtures. `tests/unit/import/containers/corpus.test.ts`
  pins every committed byte to its generator; `SHEAF_WRITE_FIXTURES=1`
  regenerates.
- **`biff/` + `xlsb/`** (SESSION-04): `biff/build-biff.ts` (BIFF8/BIFF5 over
  S01's `writeCfb`; SST split across `CONTINUE`, RK/MULRK/NUMBER/MULBLANK,
  FORMULA + SHRFMLA/ARRAY/TABLE/STRING, names, SUPBOOK/EXTERNSHEET, DV,
  MERGEDCELLS, HLINK, NOTE, OBJ, chart substreams, CONDFMT; `poisonCells`),
  `biff/ptg-writer.ts`, `biff/build-fidelity.ts`, `xlsb/build-xlsb.ts` (over
  S01's `writeZip`), `xlsb/build-fidelity.ts` (incl. `FIELDWORK_JOBS`,
  converted from S01's `DEMO_WORKBOOK`). Corpus maps `biff/corpus.ts`
  (`BIFF_CORPUS`, 19 files) and `xlsb/corpus.ts` (`XLSB_CORPUS`, 14 files).
  `xlsb/fieldwork-jobs.xlsb` is the XLSB version of the demo's Jobs +
  Customers (+ Materials) sheets — its facts equal OOXML's for the equivalent
  sheets of `fieldwork-q3.xlsx`, and its per-sheet counts equal
  `DEMO_FACT_COUNTS`. Host hazard: a BIFF fixture with a picture, checkbox and
  shape `OBJ` on one sheet was quarantined by this host's endpoint security on
  write; the corpus splits them (`annotations.xls`, `controls.xls`).
- **`ods/` + `html-table/`** (SESSION-05): `ods/build-ods.ts` (deterministic
  package builder over S01's `zip-writer.ts`; `FORMAT_STYLES`),
  `ods/corpus.ts` (`ODS_CORPUS`), `ods/demo-pair.ts` (`DEMO_PAIR`,
  `buildDemoOds`, `isoDateOf`), 9 ODS fixtures. `html-table/corpus.ts`
  (`HTML_TABLE_CORPUS`, `windows1252`), 5 HTML fixtures incl.
  `fieldwork-jobs-customers.html` (MOD-004 case:
  `excel-export.xls`). Reproduction asserted by
  `tests/unit/import/{ods,html-table}/corpus.test.ts`.
- **`append/`** (SESSION-06): `over-segment.ts` (the D38 append-too-large
  fixture generator).

## F04 corpus (charts, pivots, live formulas)

- **`ooxml/` extended (SESSION-02):** `ooxml-builder.ts` gains `ChartSpec
  extends AnchorSpec {type?, barDir?, grouping?, title?, series?:
  ChartSeriesSpec[]}` with `ChartSeriesSpec {name?, nameRef?, cat?, val?, x?,
  y?}` (no `type` → the part keeps F03's empty `c:chart` bytes) and
  `PivotSpec {name, ref, cache?: {fields, source: {sheet, ref} | {name},
  rowFields?, colFields?, dataFields?: {name, fld, subtotal?}[]}}` (no
  `cache` → the parts stay F03's bare shells). New fixture `ooxml/charts.xlsx`
  (nine charts: clustered/stacked/percentStacked bars, line, pie, doughnut,
  scatter, area, and a series spanning two sheets); `ooxml/pivot-table.xlsx`
  (a real cache over `Data!A1:B4`, sum-by-default + count, at
  `Summary!A3:C5`); `ooxml/fieldwork-q3.xlsx`'s Overview chart becomes a real
  clustered column chart, "Quoted by status" (name `Jobs!$E$1`, cat
  `Jobs!$D$2:$D$61`, val `Jobs!$E$2:$E$61`). Every `DEMO_*` pin is unchanged.
- **`ooxml/formulas-live.xlsx`** (SESSION-07): the GATE-F04 demo's live-
  formula import fixture. `demo-counts.ts` exports
  `DEMO_LIVE_STRUCTURE_STATEMENTS`. `tests/browser/worker/workbook-roots.ts`
  exposes the formulas, charts and computedFields roots.

## Tests grown in F03/F04

`tests/unit/import/ods/{corpus,inventory,parse}.test.ts`,
`tests/unit/import/html-table/{corpus,inventory,parse}.test.ts`,
`tests/property/import/{ods,html-table}.test.ts` (SESSION-05);
`tests/unit/staging/{fact-codec,promotion,append}.test.ts`,
`workbook-streams.ts` (real adapter streams via the registry);
`tests/unit/workers/parse-session.test.ts`; `fakes.ts`'s `FakeCrypto` now pads
to real v1 buckets (SESSION-06, F03). Browser:
`tests/browser/worker/{workbook-staging,workbook-journey}.spec.ts`,
`workbook-runtime.ts` (`runWorkbookImport`, `installBytes`, `zipEntryLayout`,
`corruptZipEntryCrc`), `workbook-roots.ts` (`readWorkbookRoots`: every root
from raw IndexedDB, every digest recomputed) (SESSION-06, F03). `runtime.ts`'s
checkpoint digest now goes through `checkpointSemanticBody`.

F04 grew `tests/unit/import/ooxml/{charts,pivots}.test.ts` (S02),
`tests/unit/import/facts/workbook-facts.test.ts` and
`tests/unit/staging/fact-codec.test.ts` (chart/pivot definition round-trip,
S02), and the browser worker fixtures named above (S07).

## Change History

- 2026-09-08 — F02 corpus created by SESSION-03 (`ad0871e`); `.gitattributes`
  correction at `98925cc`.
- 2026-09-08 — fragment created by Roshi (F02 final pass) so the fixture-byte
  contract lives with its own module rather than inside M19's.
- 2026-09-23 — F03: `build/`, `ooxml/`, `unsafe/` grown by SESSION-01
  (`dd1ff9e`..`64bc49a`); `biff/`, `xlsb/` by SESSION-04 (`4805e2c`..`5e92124`);
  `ods/`, `html-table/` and their tests by SESSION-05 (`871924f`..`5df4b01`);
  `append/` and the browser-worker test infrastructure by SESSION-06
  (`4287569`..`677b947`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): five SESSION staples
  folded into "F03 corpus" and "Tests grown in F03"; the corpus-owner rule's
  F02 workaround note extended with F03's actual precedent (a shared,
  planned-for-reuse toolkit) as evidence the rule is being followed, not just
  cited.
- 2026-09-23 — F04: `ooxml/charts.xlsx`, `ooxml/pivot-table.xlsx` and the
  Overview chart rebuild by SESSION-02 (`1f77153`..`15b4d5b`);
  `ooxml/formulas-live.xlsx` by SESSION-07 (`978bb77`..`f9a1565`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): two SESSION deltas
  folded into a new "F04 corpus" section and "Tests grown"; the corpus-owner
  rule's evidence list extended with F04's own zero-new-instance
  confirmation (S05/S07 read S02's corpus rather than building a second one).
