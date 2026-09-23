# M22 — Snapshots (`src/import/snapshots/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Snapshots and staging. Reconciled against the tree at
> `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Complete preservation: normalized read-only sheet snapshots,
  encrypted original-source chunks, inert-content inventory.
- **Exports:** `SOURCE_CHUNK_BYTES`, `SourceManifestV1` + codec,
  `ManifestChunkRefV1`, `chunkedSourceDigest`, `snapshotRowsFromFacts`,
  `chunkSnapshotRows`, `SnapshotChunkV1`/`SnapshotManifestV1` + codecs,
  `SNAPSHOT_ROWS_PER_CHUNK`, and (F03) `SheetSnapshotManifestV2`,
  `SheetSnapshotChunkRefV2`, `SheetSnapshotChunkV2`, `readSnapshotPage`,
  `findInSnapshot`, `formatForSnapshot`, `SheetSnapshotWriter`.
- **Depends on:** crypto and encrypted envelope-store **via injected ports**;
  M09 codecs for canonical payloads.
- **Contract:** Snapshot rendering uses normalized text only — never injects
  workbook HTML/XML/SVG/scripts/links. Source chunks carry at most 1 MiB
  decoded bytes each (database.md § Checkpoint and page boundaries).

## Landed surface (delimited, F02)

- `source-chunks.ts` → `SOURCE_CHUNK_BYTES = 1 MiB`, `SourceManifestV1` +
  codec, `ManifestChunkRefV1`, `chunkedSourceDigest`.
- `delimited-snapshot.ts` → `snapshotRowsFromFacts`, `chunkSnapshotRows`,
  `SnapshotChunkV1`/`SnapshotManifestV1` + codecs,
  `SNAPSHOT_ROWS_PER_CHUNK = 512`.

**The source digest is a digest of digests.** The whole file is never in
memory (FR-3), so the source's identity is the hash of its ordered chunk
hashes — named `chunkedSha256` so nothing mistakes it for a plain file hash
(D46; F06 re-upload identity must compute the same function).
`ImportStageV1.sourceSha256` is `Uint8Array | null` — null until the source
has been read through.

## F03: per-sheet snapshots (v2, CA-22)

`sheet-snapshot.ts` — `SheetSnapshotManifestV2 {manifestVersion: 2, sheetId,
sheetOrdinal, displayName, classification, rowCount, columnCount, chunks:
SheetSnapshotChunkRefV2[], merges, inertAnchors, discardedRows}`;
**`SheetSnapshotChunkRefV2 = ManifestChunkRefV1 & {firstRow, lastRow}`**
(encoded `{ref, firstRow, lastRow}`) so a page opens only the chunks it needs;
`SheetSnapshotChunkV2 {chunkVersion: 2, firstRow, rows[{rowIndex, cells[
{columnIndex, text, kind}]}]}` sorted, sparse, ≤ 1 MiB
(`SNAPSHOT_CHUNK_MAX_DECODED_BYTES`). `SNAPSHOT_CELL_KINDS`,
`SNAPSHOT_DISCARD_REASONS` (= M21 `DISCARD_REASONS`; totals rows carry no
discard marker). `readSnapshotPage(manifestBytes, loadChunk, {firstRow,
rowCount≤1000})` and `findInSnapshot(manifestBytes, loadChunk, {text,
afterRow})` accept **both** v2 and the F02 delimited v1 shape — the first
consumer of `decodeSnapshotManifest`/`decodeSnapshotChunk` (closing the
recoverability gap recorded below). `formatForSnapshot(value, numberFormat,
dateSystem="1900")` — D41 subset; anything else renders canonical text.

`sheet-writer.ts` (F03 S06, Custom Rule 7) — `SheetSnapshotWriter(plan,
seal)` → `row(rowIndex, cellCount, cells)`, `merge(range)`, `discard(rowIndex,
reason)`, `finish() → SheetSnapshotManifestV2`; renders through
`formatForSnapshot`, marks formula cells `formula-result`, NFC-normalises
text, cuts chunks at `SNAPSHOT_CHUNK_TARGET_BYTES` (¼ of the 1 MiB cap), chunk
refs carry `firstRow`/`lastRow`. **Delimited imports now write v2 sheet
snapshots too** — v1 is still read (by `readSnapshotPage`/`findInSnapshot`,
above), but no live producer of v1 remains after F03.

## Dependency must-nots (ship as tests)

- No import from `src/ui/`, `src/workers/`, `dexie`; store/crypto access only
  through the injected port types from `src/application/ports/`. Asserted in
  `tests/unit/staging/module-boundaries.test.ts`.

## Closed in F03 (was open at `5ab3b07`, resolved here — not re-carried)

- **The source and snapshot manifest decoders had no consumer at all**
  (Roshi's standing CL-04 finding, source half). Closed: F03's S06
  worker-tier journey decodes every root from raw IndexedDB, **including the
  source manifest**, and `readSnapshotPage`/`findInSnapshot` are the real
  consumers of `decodeSnapshotManifest`/`decodeSnapshotChunk` reading both v1
  and v2. The snapshot-decoder half of CL-04 is closed by the same evidence.
- **Record pages carried no per-field provenance in F02** — still true; F03
  records formula provenance at the **field** level via M21's evidence, not
  per authored cell. Not the same gap, so not closed — restated correctly
  rather than silently dropped: whoever adds per-field provenance to an
  authored cell still owns that lift.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-04 (`cd74e6d`); manifests and chunks
  decoded from raw IndexedDB in `tests/browser/worker/import-journey.spec.ts`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-04 staple folded
  in; the exports list corrected from the seeded placeholder names to what ships;
  the sweep-ownership note recorded so the module-map rule is visible here too.
- 2026-09-23 — F03: `sheet-snapshot.ts` (v2 format + page/find RPCs) landed by
  SESSION-03 (`f29ac33`..`a2c4cf0`); `sheet-writer.ts` landed by SESSION-06
  (`4287569`..`677b947`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): two SESSION staples
  folded into one "F03: per-sheet snapshots" section; the standing CL-04
  cleanup-ledger finding (source/snapshot decoders unconsumed) marked closed
  here with its closing evidence, and cross-referenced in the cleanup ledger
  entry below.
