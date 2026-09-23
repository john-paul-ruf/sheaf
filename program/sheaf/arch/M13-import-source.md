# M13 — Import source (`src/import/source/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / Import source and pre-flight. Reconciled against the
> tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns:** Random-access source abstraction over File/Blob and staged
  chunks; container readers (zip, XML, CFB, OPC); content sniffing
  independent of extension.
- **Exports:** `RandomAccessSource`, `blobSource`, `bytesSource`,
  `MAX_SLICE_BYTES`, `sniffContent`, `SniffResultV1`, `DetectedFormatV1`, and
  (F03) `openZipContainer`, `tokenizeXml`, `openCfbContainer`,
  `requireUnencrypted`, `readContentTypes`, `readRelationships`, `partEvents`.
- **Depends on:** platform file primitives (Blob slicing/streams — a required
  runtime capability, D14). No UI, no persistence, no crypto, **no third-party
  package** (D30 fallback — see below).
- **Contract:** Format is determined by file content, never extension (FR-1).
  Bounded reads only: magic bytes and bounded leading/trailing samples. A file
  whose content contradicts its extension is reported as a detected
  contradiction, handled by content (MOD-004).

## Landed surface

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
are detected here; F02 refused them at M14, F03's `preflightWorkbook` takes
over that routing (below). `%PDF`, HTML-table text and binary-contradiction
still detect here and refuse at M14.

### F03: container readers (SESSION-01)

**D30 fallback taken.** S01's CP0 probe found `@zip.js/zip.js` 2.17.0 bundles
`new Worker` blob-URL creation from every exported entry and WASM from the
default one, both forbidden by the pipeline sweep. No third-party dependency
was installed; the fallback path below is the **shipped** implementation, not
a contingency.

- `bounds.ts`: `CONTAINER_BOUNDS_V1` (spec values + `expansionRatioGraceBytes:
  102_400` — ratio enforced once an entry has produced 100 KiB), `ContainerBoundsV1`,
  `UNREADABLE_DETAILS`/`UnreadableDetailV1` (closed, 8 tokens),
  `BoundExceededError {detail}` (message = the token only), `isBoundExceeded`.
- `zip.ts`: `openZipContainer(source, bounds?) → ZipContainerHandleV1
  {entries, has, entry, readEntry(name,{maxBytes}), streamEntry(name),
  expandedByteCount}`; `ZIP_READ_CHUNK_BYTES = 65_536`. Opens from EOCD (one
  22-byte read without a comment) + central directory only; ZIP64; names
  ASCII-case-insensitive (OPC); unsafe/duplicate names → `malformed-structure`;
  too many entries → `expansion-limit`; encrypted entry → `encrypted-workbook`;
  unsupported method or split archive → `unrecognized-content`. Every produced
  byte counted against declared size, ratio/total/caller cap, and CRC-32.
  Early exit cancels `DecompressionStream("deflate-raw")`.
- `xml.ts`: `tokenizeXml(chunks, bounds?) → AsyncGenerator<XmlEventV1>`
  (`start{uri,local,attributes}` / `end{uri,local}` / `text{value}`),
  `attributeOf`, `XML_NAMESPACE`. No DTD/entities; only 5 predefined + numeric
  refs; every other violation and every bound → `malformed-structure`. Text
  delivered whole between markup (property-proven). UTF-16 BOM honored.
- `cfb.ts`: `openCfbContainer(source, bounds?) → CfbHandleV1 {listStreams,
  has, readStream, streamStream, isEncryptedPackage}`,
  `requireUnencrypted(handle)`. Chain/directory loops → `directory-loop`;
  chain past file end or stream size > file → `truncated-container`;
  chain/size mismatch → `malformed-structure`. **Known limit:** no ranged
  read (`streamStream` fetches a whole stream) — M17's BIFF inventory reads
  earlier sheets' sectors without parsing them as a result; a `streamStream(path,
  {offset})` addition is carried debt, owner: next session leasing this file.
- `opc.ts` (Custom Rule 7 — OPC is package-level and M16's XLSB needs it
  without importing M15): `readContentTypes`, `readRelationships(zip,
  sourcePart|null)`, `relationshipKind`, `resolvePartName` (escaping `..`
  refused), `relationshipsPartOf`, `partEvents`, `OPC_PART_MAX_BYTES = 16 MiB`,
  `CONTENT_TYPES_PART`.

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
- 2026-09-23 — F03: `bounds.ts`/`zip.ts`/`xml.ts`/`cfb.ts`/`opc.ts` landed by
  SESSION-01 (`dd1ff9e`..`64bc49a`), taking the D30 fallback at CP0.
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-01 staple
  folded into a new "F03: container readers" section; the CFB no-ranged-read
  limit cross-referenced from M17.
