# M58 — Workbook fixtures (`tests/fixtures/workbooks/`)

> Fragment created by Roshi at the F02 final pass. Reconciled against the tree
> at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** The fidelity + refusal corpus per import format.
- **Corpus owner rule:** the fixture corpus belongs to **one** session's lease
  and is unreachable to every later one. A later session either plans its
  fixtures inside its own lease or names this corpus's owner as a supplier.
  F02's S04 hit this and built synthetic in-page fixtures for its volume cases
  instead. F03 avoided a repeat: S01's `tests/fixtures/workbooks/build/`
  generator toolkit was planned into S01's own lease and reused *unmodified*
  by S02/S04/S05 through its exported helpers, rather than each format's
  session needing its own corpus lease.

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

## Tests grown in F03

`tests/unit/import/ods/{corpus,inventory,parse}.test.ts`,
`tests/unit/import/html-table/{corpus,inventory,parse}.test.ts`,
`tests/property/import/{ods,html-table}.test.ts` (SESSION-05);
`tests/unit/staging/{fact-codec,promotion,append}.test.ts`,
`workbook-streams.ts` (real adapter streams via the registry);
`tests/unit/workers/parse-session.test.ts`; `fakes.ts`'s `FakeCrypto` now pads
to real v1 buckets (SESSION-06). Browser:
`tests/browser/worker/{workbook-staging,workbook-journey}.spec.ts`,
`workbook-runtime.ts` (`runWorkbookImport`, `installBytes`, `zipEntryLayout`,
`corruptZipEntryCrc`), `workbook-roots.ts` (`readWorkbookRoots`: every root
from raw IndexedDB, every digest recomputed) (SESSION-06). `runtime.ts`'s
checkpoint digest now goes through `checkpointSemanticBody`.

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
