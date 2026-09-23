# M58 — Workbook fixtures (`tests/fixtures/workbooks/`)

> Fragment created by Roshi at the F02 final pass. The content below landed
> during F02 (SESSION-03, `98925cc`) and had been stapled inside
> `M19-delimited.md`, which is a different module; it is stated here instead.
> Reconciled against the tree at `5ab3b07`.

## Contract

- **Owns:** The fidelity + refusal corpus per import format.
- **Corpus owner rule:** the fixture corpus belongs to **one** session's lease
  and is unreachable to every later one. A later session either plans its
  fixtures inside its own lease or names this corpus's owner as a supplier.
  F02's S04 hit exactly this and built synthetic in-page fixtures for its volume
  cases instead (truthful, but a workaround a lease boundary forced).

## Byte fidelity (`.gitattributes`)

`tests/fixtures/workbooks/.gitattributes` sets `* -text`. **A fixture's bytes
are the test subject.** This repository's `core.autocrlf=input` had silently
rewritten the CRLF fixtures on their way into the index, so a fresh clone would
have disagreed with the tree they were authored in. Every later fixture author
inherits this attribute; adding a fixture directory outside this path re-opens
the hazard.

## F02 corpus

Delimited fidelity + refusal fixtures for M13 sniffing, M14 refusal routing,
M19 parsing and M21 inference, including the pinned demo file
`field-log-messy.csv` behind the GATE-F02 demo script, an NFD crew fixture for
D28, and ragged/quoting/encoding cases. Workbook-format fixtures exist only as
refusal subjects in F02; their fidelity corpora arrive with F03's adapters.

## Change History

- 2026-09-08 — corpus created by SESSION-03 (`ad0871e`); `.gitattributes`
  correction at `98925cc`.
- 2026-09-08 — fragment created by Roshi (F02 final pass) so the fixture-byte
  contract lives with its own module rather than inside M19's.

<!-- workbook-fidelity SESSION-01 -->
### workbook-fidelity SESSION-01 (2026-09-22, commits dd1ff9e..64bc49a)

**M58 — Workbook fixtures — extended**
- `tests/fixtures/workbooks/build/` (`zip-writer.ts` with a deterministic LZ77+fixed-Huffman deflate, `cfb-writer.ts`, `ooxml-builder.ts`, `corpus.ts` — the generator map, `oversized.ts` — test-time only), `ooxml/` (12 fidelity workbooks from `build-fidelity.ts`, the pinned demo `fieldwork-q3.xlsx` from `build-demo.ts`, `demo-counts.ts`), `unsafe/` (19 refusal fixtures). `tests/unit/import/containers/corpus.test.ts` pins every committed byte to its generator; `SHEAF_WRITE_FIXTURES=1` regenerates.

<!-- workbook-fidelity SESSION-04 -->
### workbook-fidelity SESSION-04 (2026-09-22, commits 4805e2c..5e92124)

**M58 — Workbook fixtures (`tests/fixtures/workbooks/{biff,xlsb}/`) — grown**

- Builders: `biff/build-biff.ts` (BIFF8/BIFF5 over S01's `writeCfb`: SST split across `CONTINUE`, RK/MULRK/NUMBER/MULBLANK choice, FORMULA + SHRFMLA/ARRAY/TABLE/STRING, names, SUPBOOK/EXTERNSHEET, DV, MERGEDCELLS, HLINK, NOTE, OBJ, chart substreams, CONDFMT; `poisonCells: true | number[]`), `biff/ptg-writer.ts` (token streams for both widths), `biff/build-fidelity.ts`, `xlsb/build-xlsb.ts` (BIFF12 parts over S01's `writeZip`, incl. drawings/comments/hyperlinks), `xlsb/build-fidelity.ts` (incl. `FIELDWORK_JOBS`, converted from S01's `DEMO_WORKBOOK`). Corpus maps `biff/corpus.ts` (`BIFF_CORPUS`, 19 files) and `xlsb/corpus.ts` (`XLSB_CORPUS`, 14 files), reproduced byte for byte by `tests/unit/import/{biff,xlsb}/corpus.test.ts` (`SHEAF_WRITE_FIXTURES=1` rewrites).
- `xlsb/fieldwork-jobs.xlsb` is the XLSB version of the demo's Jobs + Customers (+ Materials) — its facts equal the OOXML adapter's facts for sheets [0,1,4] of `ooxml/fieldwork-q3.xlsx` (sheet indexes and part paths aside) and its per-sheet counts equal `DEMO_FACT_COUNTS`.
- Host hazard: a BIFF fixture holding a picture, a checkbox and a shape `OBJ` on one sheet was quarantined by this host's endpoint security on write (EPERM on every later open); the corpus splits them (`annotations.xls`, `controls.xls`).

<!-- workbook-fidelity SESSION-05 -->
### workbook-fidelity SESSION-05 (2026-09-22, commits 871924f..5df4b01)

**M58 — workbook fixtures — grown**

- `tests/fixtures/workbooks/ods/`: `build-ods.ts` (deterministic ODS package builder over S01's `zip-writer.ts`; `FORMAT_STYLES`), `corpus.ts` (`ODS_CORPUS`), `demo-pair.ts` (`DEMO_PAIR`, `buildDemoOds`, `isoDateOf` — Jobs + Customers from S01's `DEMO_WORKBOOK`), 9 fixtures: `lookup-validation`, `repeats`, `hostile-repeat`, `formats`, `annotation-chart`, `encrypted`, `basic-macro`, `no-settings`, `fieldwork-jobs-customers`.
- `tests/fixtures/workbooks/html-table/`: `corpus.ts` (`HTML_TABLE_CORPUS`, `windows1252`), 5 fixtures: `merged-headers.html`, `active-content.html`, `windows-1252.html`, `excel-export.xls` (MOD-004 case), `fieldwork-jobs-customers.html`.
- Reproduction asserted by `tests/unit/import/{ods,html-table}/corpus.test.ts` (`SHEAF_WRITE_FIXTURES=1` regenerates).

<!-- workbook-fidelity SESSION-05 -->
### workbook-fidelity SESSION-05 (2026-09-22, commits 871924f..5df4b01)

**M56/M57 — tests — grown**

- `tests/unit/import/ods/{corpus,inventory,parse}.test.ts`, `tests/unit/import/html-table/{corpus,inventory,parse}.test.ts`, `tests/property/import/{ods,html-table}.test.ts`.

<!-- workbook-fidelity SESSION-06 -->
### workbook-fidelity SESSION-06 (2026-09-23, commits 4287569..677b947)

**Tests (M56/M58/M60)**
- Unit: `tests/unit/staging/{fact-codec,promotion,append}.test.ts`, `workbook-streams.ts` (real adapter streams via the registry); `tests/unit/workers/parse-session.test.ts`; `fakes.ts` FakeCrypto now pads to real v1 buckets (payload length in its authenticated header). Browser: `tests/browser/worker/{workbook-staging,workbook-journey}.spec.ts`, `workbook-runtime.ts` (`runWorkbookImport`, `installBytes`, `zipEntryLayout`, `corruptZipEntryCrc`), `workbook-roots.ts` (`readWorkbookRoots`: every root from raw IndexedDB, every digest recomputed, every segment). `runtime.ts` checkpoint digest now via `checkpointSemanticBody`. Fixture generator `tests/fixtures/workbooks/append/over-segment.ts`.
