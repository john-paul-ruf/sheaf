# M13 — Import source (`src/import/source/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import source and pre-flight. Reconciled against the tree
> at `5ab3b07` (F02 final).

## Contract

- **Owns:** Random-access source abstraction over File/Blob (and, later,
  encrypted staged chunks); content sniffing independent of extension.
- **Exports:** `RandomAccessSource`, `blobSource`, `bytesSource`,
  `MAX_SLICE_BYTES`, `sniffContent`, `SniffResultV1`, `DetectedFormatV1`.
- **Depends on:** platform file primitives (Blob slicing/streams — a required
  runtime capability, D14). No UI, no persistence, no crypto.
- **Contract:** Format is determined by file content, never extension (FR-1).
  Bounded reads only: magic bytes and bounded leading/trailing samples. A file
  whose content contradicts its extension is reported as a detected
  contradiction, handled by content (MOD-004).

## Landed surface (F02, S03)

`source.ts`: `RandomAccessSource {byteLength, slice(offset,length)}`,
`blobSource(blob)`, `bytesSource(bytes)`, `MAX_SLICE_BYTES = 1_048_576`. A read
larger than the bound is a `RangeError` before any allocation; a short read is
end-of-file, never an error. The source deliberately does **not** carry the file
name — format is decided by content (FR-1) and the name travels beside it as the
claim sniffing may contradict.

`sniff.ts`: `sniffContent(source, declaredName) → SniffResultV1
{format, declaredName, declaredExtension, contradiction}` reading exactly one
`SNIFF_SAMPLE_BYTES = 8192` window. `DetectedFormatV1` is the closed union
`delimited{delimiter,encoding,bomByteLength,newline} | zip-container{container} |
cfb | pdf | html-table | binary`, with `DelimitedFormatV1` the narrowed alias,
`ZipContainerV1 = ooxml|ods|iwork|unknown`, and the constant lists `DELIMITERS`
(`, \t ; |`), `TEXT_ENCODINGS` (`utf-8 utf-16le utf-16be windows-1252`),
`NEWLINE_CONVENTIONS`. Zip family is read from local-file-header **names** in
the sample — no central-directory chain is walked, so detection cannot loop.
`ExtensionContradictionV1 {declaredExtension, expectedKind, detectedKind}` is
the MOD-004 fact. Property-proven: sniffing never throws on arbitrary bytes and
never consults the declared name for the verdict.

**F02 detection routing.** ZIP container (`PK\x03\x04`) and CFB (`D0CF11E0`)
are detected here and refused by M14 — OOXML/XLSB/ODS/Numbers *parsing* is F03.
`%PDF`, HTML-table text and binary-contradiction likewise detect here and refuse
there. Only `delimited` proceeds.

## Dependency must-nots (ship as tests)

- No import from `src/persistence/`, `src/crypto/`, `src/workers/`, `src/ui/`,
  or any third-party package. Swept by
  `tests/unit/import/module-boundaries.test.ts`, which names M13/M14/M19/M21's
  four directories explicitly — **not** the shared `src/import` parent, whose
  other modules (M22/M23) declare opposite dependency edges.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — implemented by SESSION-03 (`ad0871e`); the boundary sweep
  re-scoped to the four module directories by SESSION-04's lease-r2 correction
  (`978f4ff`).
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-03 staple folded
  into the contract; the seeded "F02 detection set" paragraph rewritten as the
  landed routing statement; the sweep's module-map scope recorded here.

<!-- workbook-fidelity SESSION-01 -->
### workbook-fidelity SESSION-01 (2026-09-22, commits dd1ff9e..64bc49a)

**M13 — Import source (`src/import/source/`) — extended**
- **D30 fallback taken** (CP0 probe: zip.js 2.17.0 bundles `new Worker` blob-URL creation from every exported entry, WASM from the default one). No third-party dependency; `@zip.js/zip.js` is not installed.
- `bounds.ts`: `CONTAINER_BOUNDS_V1` (spec values + **`expansionRatioGraceBytes: 102_400`** — ratio enforced once an entry has produced 100 KiB; POI precedent), `ContainerBoundsV1`, `UNREADABLE_DETAILS`/`UnreadableDetailV1` (closed, 8 tokens), `BoundExceededError {detail}` (message = the token only), `isBoundExceeded`.
- `zip.ts`: `openZipContainer(source, bounds?) → ZipContainerHandleV1 {entries: ZipEntryV1[], has, entry, readEntry(name,{maxBytes}), streamEntry(name), expandedByteCount}`; `ZIP_READ_CHUNK_BYTES = 65_536`. Opens from EOCD (one 22-byte read without a comment) + central directory only; ZIP64; names ASCII-case-insensitive (OPC); unsafe/duplicate names → `malformed-structure`; > `maxZipEntries` → `expansion-limit`; encrypted entry → `encrypted-workbook`; method ≠ 0/8 or split archive → `unrecognized-content`. Every produced byte counted against declared size (either direction → `malformed-structure`), ratio/total/caller cap (→ `expansion-limit`), CRC-32 (→ `malformed-structure`). Early exit cancels `DecompressionStream("deflate-raw")`.
- `xml.ts`: `tokenizeXml(chunks, bounds?) → AsyncGenerator<XmlEventV1>` (`start{uri,local,attributes}` / `end{uri,local}` / `text{value}`), `attributeOf`, `XML_NAMESPACE`. No DTD/entities (`entity-declaration`); only 5 predefined + numeric refs; every other violation and every bound → `malformed-structure`. Text delivered whole between markup → chunking-invariant (property-proven). UTF-16 BOM honored.
- `cfb.ts`: `openCfbContainer(source, bounds?) → CfbHandleV1 {listStreams, has, readStream, streamStream, isEncryptedPackage}`, `requireUnencrypted(handle)` (→ `encrypted-workbook`). Chain/directory loops → `directory-loop`; chain past file end or stream size > file → `truncated-container`; chain/size mismatch → `malformed-structure`.
- `opc.ts` (**new, Custom Rule 7** — OPC is package-level and S04's XLSB needs it without importing M15): `readContentTypes`, `readRelationships(zip, sourcePart|null)`, `relationshipKind`, `resolvePartName` (escaping `..` refused), `relationshipsPartOf`, `partEvents`, `OPC_PART_MAX_BYTES = 16 MiB`, `CONTENT_TYPES_PART`.
- `sniff.ts`, `source.ts`: unchanged.
- Must-not sweep: no third-party package anywhere (exception list empty on the fallback path).
