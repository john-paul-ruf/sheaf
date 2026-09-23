# M22 — Snapshots (`src/import/snapshots/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Snapshots and staging. Reconciled against the tree at
> `5ab3b07` (F02 final).

## Contract

- **Owns:** Complete preservation: normalized read-only sheet snapshots,
  encrypted original-source chunks, inert-content inventory.
- **Exports:** `SOURCE_CHUNK_BYTES`, `SourceManifestV1` + codec,
  `ManifestChunkRefV1`, `chunkedSourceDigest`, `snapshotRowsFromFacts`,
  `chunkSnapshotRows`, `SnapshotChunkV1`/`SnapshotManifestV1` + codecs,
  `SNAPSHOT_ROWS_PER_CHUNK` (F03 grows the render data surface).
- **Depends on:** crypto and encrypted envelope-store **via injected ports**;
  M09 codecs for canonical payloads.
- **Contract:** Snapshot rendering uses normalized text only — never injects
  workbook HTML/XML/SVG/scripts/links. Source chunks carry at most 1 MiB
  decoded bytes each (database.md § Checkpoint and page boundaries).

## F02 scope (delimited subset, D21)

- Original source bytes chunked and encrypted under the provisional/app key
  (`app.source-chunk` scope + `app.source-manifest`).
- One value-grid normalized snapshot per delimited import (`app.snapshot-chunk`
  + `app.snapshot-manifest`) so discarded pre-header rows remain recoverable
  (FR-4) and `AppHeadV1.snapshotManifests`/`sourceManifests` are satisfiable.
- The snapshot **viewer** (SCR-030/031) is F03; F02 stores, F03 renders.

## Landed surface (F02, S04)

- `source-chunks.ts` → `SOURCE_CHUNK_BYTES = 1 MiB`, `SourceManifestV1` +
  codec, `ManifestChunkRefV1`, `chunkedSourceDigest`.
- `delimited-snapshot.ts` → `snapshotRowsFromFacts`, `chunkSnapshotRows`,
  `SnapshotChunkV1`/`SnapshotManifestV1` + codecs,
  `SNAPSHOT_ROWS_PER_CHUNK = 512`.

**The source digest is a digest of digests.** The whole file is never in memory
(FR-3) and the platform has no incremental SHA-256, so the source's identity is
the hash of its ordered chunk hashes. It is named `chunkedSha256` so nothing
mistakes it for a plain file hash. `ImportStageV1.sourceSha256` is therefore
`Uint8Array | null` — null until the source has been read through, which is a
different fact from a zeroed placeholder.

**Known absence with an owner:** record pages carry no per-field provenance in
F02; the snapshot manifests are the recoverable original. Whoever adds
per-field provenance (M22/M23 or F03) owns that lift, and
`AppHeadV1.snapshotChunks` stays empty for non-delimited sources until F03's
adapters land.

## Dependency must-nots (ship as tests)

- No import from `src/ui/`, `src/workers/`, `dexie`; store/crypto access only
  through the injected port types from `src/application/ports/`. Asserted in
  `tests/unit/staging/module-boundaries.test.ts` — **not** by the pipeline sweep
  in `tests/unit/import/`, whose forbidden list is the opposite of this module's
  contract.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — first landing by SESSION-04 (`cd74e6d`); manifests and chunks
  decoded from raw IndexedDB in `tests/browser/worker/import-journey.spec.ts`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-04 staple folded
  in; the exports list corrected from the seeded placeholder names to what ships;
  the sweep-ownership note recorded so the module-map rule is visible here too.

<!-- workbook-fidelity SESSION-03 -->
### workbook-fidelity SESSION-03 (2026-09-22, commits f29ac33..a2c4cf0)

**M22 — Snapshots**
- NEW `sheet-snapshot.ts` (format v2, CA-22): `SheetSnapshotManifestV2 {manifestVersion: 2, sheetId, sheetOrdinal, displayName, classification, rowCount, columnCount, chunks: SheetSnapshotChunkRefV2[], merges, inertAnchors, discardedRows}`; **`SheetSnapshotChunkRefV2 = ManifestChunkRefV1 & {firstRow, lastRow}`** (encoded `{ref, firstRow, lastRow}`) so a page opens only the chunks it needs; `SheetSnapshotChunkV2 {chunkVersion: 2, firstRow, rows[{rowIndex, cells[{columnIndex, text, kind}]}]}` sorted, sparse, ≤ 1 MiB (`SNAPSHOT_CHUNK_MAX_DECODED_BYTES`). `SNAPSHOT_CELL_KINDS`, `SNAPSHOT_DISCARD_REASONS` (= M21 `DISCARD_REASONS`). `readSnapshotPage(manifestBytes, loadChunk, {firstRow, rowCount≤1000})` and `findInSnapshot(manifestBytes, loadChunk, {text, afterRow})` accept v2 **and** F02 delimited v1 (first consumer of `decodeSnapshotManifest/Chunk`, CL-04; v1 carries no discard markers). `formatForSnapshot(value, numberFormat, dateSystem="1900")` — D41 subset; anything else renders canonical text.
