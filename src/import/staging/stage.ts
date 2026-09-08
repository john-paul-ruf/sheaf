/**
 * `ImportStageV1` — the provisional import model (M23; CA-10; database.md
 * § Import staging).
 *
 * A stage is everything Sheaf knows about an import that has not been
 * accepted: what the file is, where its bytes were put, what was proposed
 * about them, what the user changed, and which of the rows it wrote are kept
 * on promotion versus thrown away either way. It is sealed under the
 * **provisional app key** in scope `app.import-stage`, and that key is
 * reachable only through the workflow reference in the current catalog — so
 * removing the reference is what makes the whole stage unreadable, in one
 * transaction, with nothing left to display (§ Cancellation order, step 2).
 *
 * Two properties are held here rather than by the handlers that write it:
 *
 * - **Every provisional storage ID is classified.** `retainedStorageIds` and
 *   `temporaryStorageIds` partition the chunk lists exactly. A stage cannot be
 *   encoded that names a row belonging to neither, because such a row is one
 *   nothing would ever delete and nothing would ever keep.
 * - **A chunk list is a contiguous ordered sequence.** Chunks are numbered
 *   from zero with no gaps, so a missing chunk is a decode failure and never a
 *   silently shorter file.
 *
 * The stage is *authoritative* for the proposal and its edits (D17). The page
 * holds a copy for rendering; this payload is what promotion reads.
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  STORAGE_ID_TEXT_LENGTH,
  decodeStorageId16,
} from "../../domain/model/bytes.js";
import { DOMAIN_ID_BYTE_LENGTH } from "../../domain/model/ids.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";
import {
  DELIMITERS,
  NEWLINE_CONVENTIONS,
  TEXT_ENCODINGS,
  type DetectedFormatKindV1,
  type DetectedFormatV1,
  type ExtensionContradictionV1,
  type ZipContainerV1,
} from "../source/sniff.js";
import type { PreflightReportV1 } from "../preflight/preflight.js";
import type { ProposedAppV1 } from "../inference/infer.js";
import type { ReviewEditV1 } from "../inference/review-edits.js";
import {
  asMap,
  bytesOfLength,
  cborMap,
  count,
  decodeProposal,
  decodeReviewEdit,
  encodeProposal,
  encodeReviewEdit,
  exactKeys,
  field,
  integerOrNull,
  list,
  nfcText,
  oneOf,
  optionalCount,
  text,
} from "./proposal-codec.js";

/**
 * Stated here rather than imported from M08: M23 reaches crypto only through
 * an injected port, so a length constant may not be the thing that pulls
 * libsodium into the staging module graph. `stage.test.ts` pins it.
 */
const SHA256_BYTES = 32;

export const IMPORT_STAGE_VERSION = 1;

/** Scope and payload kind are fixed by migration 003; stated once, here. */
export const IMPORT_STAGE_SCOPE = "app.import-stage" as const;
export const IMPORT_STAGE_PAYLOAD_KIND = "app.import-stage" as const;

/**
 * Where the import has got to. `cancelled` and `failed` are terminal and mean
 * the same thing to storage — the cleanup order runs either way — but they
 * mean different things to a person, so they are two values (SCR-022 versus
 * SCR-045's failure copy).
 */
export const IMPORT_STAGE_STATUSES = Object.freeze([
  "staging",
  "staged",
  "reviewing",
  "promoting",
  "promoted",
  "cancelled",
  "failed",
] as const);

export type ImportStageStatusV1 = (typeof IMPORT_STAGE_STATUSES)[number];

/** Statuses at which a reviewed proposal must already exist. */
const STATUSES_REQUIRING_PROPOSAL: readonly ImportStageStatusV1[] = Object.freeze(
  ["reviewing", "promoting", "promoted"],
);

export const IMPORT_PHASES = Object.freeze([
  "preflight",
  "parsing",
  "inferring",
  "reviewing",
  "promoting",
  "done",
] as const);

export type ImportPhaseV1 = (typeof IMPORT_PHASES)[number];

/**
 * One staged opaque chunk. The digest is over the *decoded* payload, so a
 * chunk's identity does not depend on which padding bucket it landed in.
 */
export interface StagedChunkRefV1 {
  readonly storageId: string;
  /** Contiguous from zero within its own list. */
  readonly sequence: number;
  readonly decodedByteLength: number;
  readonly sha256: Uint8Array;
}

export interface ImportStageProgressV1 {
  readonly phase: ImportPhaseV1;
  /** Physical rows the parser has emitted; an estimate becomes exact at done. */
  readonly rowsSoFar: number;
  readonly batchesCommitted: number;
  /**
   * The last batch sequence the data worker committed and acked. It is the
   * parser's cursor: the import worker may not send `n + 1` until this reads
   * `n` (CA-10, commit-before-ack).
   */
  readonly ackedBatchSeq: number | null;
}

export interface ImportStageV1 {
  readonly stageVersion: typeof IMPORT_STAGE_VERSION;
  /** Canonical base64url of 16 random bytes; the workflow's public name. */
  readonly stageId: string;
  /** Advances on every rewrite of this payload; a stale writer is refused. */
  readonly stageRevision: number;
  /** Allocated at stage creation so `import.accepted` can name it (CA-11). */
  readonly lineageId: Uint8Array;
  readonly fileName: string;
  readonly detected: DetectedFormatV1;
  readonly contradiction: ExtensionContradictionV1 | null;
  readonly sourceSha256: Uint8Array;
  readonly sourceByteLength: number;
  /** The safe metadata inventory and capacity estimate (database.md). */
  readonly preflight: PreflightReportV1;
  /** One implicit sheet for delimited text; F03's adapters select many. */
  readonly selectedSheets: readonly string[];
  readonly sourceChunks: readonly StagedChunkRefV1[];
  readonly factChunks: readonly StagedChunkRefV1[];
  readonly snapshotChunks: readonly StagedChunkRefV1[];
  /** Null until the parse completes; inference has nothing exact before then. */
  readonly proposal: ProposedAppV1 | null;
  /** In application order, so promotion can replay what the user did. */
  readonly reviewEdits: readonly ReviewEditV1[];
  readonly retainedStorageIds: readonly string[];
  readonly temporaryStorageIds: readonly string[];
  readonly progress: ImportStageProgressV1;
  readonly status: ImportStageStatusV1;
}

// -------------------------------------------------------------- constraints --

const assertStorageIdText = (value: string, what: string): void => {
  if (value.length !== STORAGE_ID_TEXT_LENGTH) {
    throw new CodecError(`${what} is not a storage id`);
  }
  // Rejects a non-canonical spelling, so two texts can never name one row.
  decodeStorageId16(value);
};

const assertUnique = (values: readonly string[], what: string): void => {
  if (new Set(values).size !== values.length) {
    throw new CodecError(`a stage names a duplicate ${what}`);
  }
};

function assertChunkList(
  chunks: readonly StagedChunkRefV1[],
  what: string,
): void {
  chunks.forEach((chunk, index) => {
    if (chunk.sequence !== index) {
      throw new CodecError(`${what} are not contiguous from zero`);
    }
    assertStorageIdText(chunk.storageId, `a ${what} storage id`);
    if (!Number.isSafeInteger(chunk.decodedByteLength) || chunk.decodedByteLength < 0) {
      throw new CodecError(`a ${what} length is not a safe byte count`);
    }
    if (chunk.sha256.byteLength !== SHA256_BYTES) {
      throw new CodecError(`a ${what} digest is not 32 bytes`);
    }
  });
}

/**
 * Everything a stage must satisfy to be worth writing. Checked before
 * encryption and again after decryption, like the catalog's — a payload that
 * fails here never becomes a value a caller can act on.
 */
export function validateImportStage(stage: ImportStageV1): ImportStageV1 {
  if (stage.stageVersion !== IMPORT_STAGE_VERSION) {
    throw new CodecError("stage declares an unsupported version");
  }
  assertStorageIdText(stage.stageId, "a stage id");
  if (!Number.isSafeInteger(stage.stageRevision) || stage.stageRevision < 1) {
    throw new CodecError("stage revision must be a safe integer of at least 1");
  }
  if (stage.lineageId.byteLength !== DOMAIN_ID_BYTE_LENGTH) {
    throw new CodecError("stage lineage id must be 16 bytes");
  }
  if (stage.sourceSha256.byteLength !== SHA256_BYTES) {
    throw new CodecError("stage source digest must be 32 bytes");
  }
  if (stage.fileName.length === 0) {
    throw new CodecError("a stage has no file name");
  }
  if (!Number.isSafeInteger(stage.sourceByteLength) || stage.sourceByteLength < 0) {
    throw new CodecError("stage source length is not a safe byte count");
  }

  assertChunkList(stage.sourceChunks, "source chunks");
  assertChunkList(stage.factChunks, "fact chunks");
  assertChunkList(stage.snapshotChunks, "snapshot chunks");

  const chunkIds = [
    ...stage.sourceChunks,
    ...stage.factChunks,
    ...stage.snapshotChunks,
  ].map((chunk) => chunk.storageId);
  assertUnique(chunkIds, "chunk storage id");

  for (const storageId of [
    ...stage.retainedStorageIds,
    ...stage.temporaryStorageIds,
  ]) {
    assertStorageIdText(storageId, "a provisional storage id");
  }
  assertUnique(
    [...stage.retainedStorageIds, ...stage.temporaryStorageIds],
    "provisional storage id",
  );

  // The partition: every staged row is either kept on promotion or thrown
  // away, and the two lists together are exactly the rows that exist.
  const classified = new Set([
    ...stage.retainedStorageIds,
    ...stage.temporaryStorageIds,
  ]);
  if (classified.size !== chunkIds.length) {
    throw new CodecError("stage classification does not cover its chunks");
  }
  for (const storageId of chunkIds) {
    if (!classified.has(storageId)) {
      throw new CodecError("a staged chunk is neither retained nor temporary");
    }
  }

  if (!Number.isSafeInteger(stage.progress.rowsSoFar) || stage.progress.rowsSoFar < 0) {
    throw new CodecError("stage progress row count is not a safe count");
  }
  if (
    !Number.isSafeInteger(stage.progress.batchesCommitted) ||
    stage.progress.batchesCommitted < 0
  ) {
    throw new CodecError("stage progress batch count is not a safe count");
  }
  if (
    stage.progress.ackedBatchSeq !== null &&
    (!Number.isSafeInteger(stage.progress.ackedBatchSeq) ||
      stage.progress.ackedBatchSeq < 0)
  ) {
    throw new CodecError("stage acked batch sequence is not a safe count");
  }

  if (stage.proposal === null && stage.reviewEdits.length > 0) {
    throw new CodecError("a stage holds review edits without a proposal");
  }
  if (
    stage.proposal === null &&
    STATUSES_REQUIRING_PROPOSAL.includes(stage.status)
  ) {
    throw new CodecError("a stage reached review without a proposal");
  }

  return stage;
}

// ------------------------------------------------------------------ encoding --

const encodeDetected = (format: DetectedFormatV1): CborValue => {
  switch (format.kind) {
    case "delimited":
      return cborMap([
        ["kind", "delimited"],
        ["delimiter", format.delimiter],
        ["encoding", format.encoding],
        ["bomByteLength", format.bomByteLength],
        ["newline", format.newline],
      ]);
    case "zip-container":
      return cborMap([
        ["kind", "zip-container"],
        ["container", format.container],
      ]);
    default:
      return cborMap([["kind", format.kind]]);
  }
};

const encodeContradiction = (
  contradiction: ExtensionContradictionV1 | null,
): CborValue =>
  contradiction === null
    ? null
    : cborMap([
        ["declaredExtension", contradiction.declaredExtension],
        ["expectedKind", contradiction.expectedKind],
        ["detectedKind", contradiction.detectedKind],
      ]);

const encodePreflight = (report: PreflightReportV1): CborValue =>
  cborMap([
    ["fileName", report.fileName],
    ["sourceByteLength", report.sourceByteLength],
    ["delimiter", report.delimiter],
    ["encoding", report.encoding],
    ["newline", report.newline],
    ["columnCount", report.columnCount],
    ["estimatedRowCount", report.estimatedRowCount],
    ["estimatedCellCount", report.estimatedCellCount],
    ["sampleRows", report.sampleRows.map((row) => [...row])],
    ["bytesSampled", report.bytesSampled],
  ]);

const encodeChunk = (chunk: StagedChunkRefV1): CborValue =>
  cborMap([
    ["storageId", chunk.storageId],
    ["sequence", chunk.sequence],
    ["decodedByteLength", chunk.decodedByteLength],
    ["sha256", chunk.sha256],
  ]);

export function encodeImportStage(stage: ImportStageV1): Uint8Array {
  validateImportStage(stage);
  return encodeCanonical(
    cborMap([
      ["stageVersion", stage.stageVersion],
      ["stageId", stage.stageId],
      ["stageRevision", stage.stageRevision],
      ["lineageId", stage.lineageId],
      ["fileName", stage.fileName],
      ["detected", encodeDetected(stage.detected)],
      ["contradiction", encodeContradiction(stage.contradiction)],
      ["sourceSha256", stage.sourceSha256],
      ["sourceByteLength", stage.sourceByteLength],
      ["preflight", encodePreflight(stage.preflight)],
      ["selectedSheets", [...stage.selectedSheets]],
      ["sourceChunks", stage.sourceChunks.map(encodeChunk)],
      ["factChunks", stage.factChunks.map(encodeChunk)],
      ["snapshotChunks", stage.snapshotChunks.map(encodeChunk)],
      [
        "proposal",
        stage.proposal === null ? null : encodeProposal(stage.proposal),
      ],
      ["reviewEdits", stage.reviewEdits.map(encodeReviewEdit)],
      ["retainedStorageIds", [...stage.retainedStorageIds]],
      ["temporaryStorageIds", [...stage.temporaryStorageIds]],
      [
        "progress",
        cborMap([
          ["phase", stage.progress.phase],
          ["rowsSoFar", stage.progress.rowsSoFar],
          ["batchesCommitted", stage.progress.batchesCommitted],
          ["ackedBatchSeq", integerOrNull(stage.progress.ackedBatchSeq)],
        ]),
      ],
      ["status", stage.status],
    ]),
  );
}

// ------------------------------------------------------------------ decoding --

const DETECTED_KINDS: readonly DetectedFormatKindV1[] = Object.freeze([
  "delimited",
  "zip-container",
  "cfb",
  "pdf",
  "html-table",
  "binary",
]);

const ZIP_CONTAINERS: readonly ZipContainerV1[] = Object.freeze([
  "ooxml",
  "ods",
  "iwork",
  "unknown",
]);

const decodeDetected = (value: DecodedValue): DetectedFormatV1 => {
  const map = asMap(value, "a detected format");
  const kind = oneOf(field(map, "kind"), DETECTED_KINDS, "a detected format");

  if (kind === "delimited") {
    exactKeys(
      map,
      ["kind", "delimiter", "encoding", "bomByteLength", "newline"],
      "a delimited format",
    );
    return {
      kind,
      delimiter: oneOf(field(map, "delimiter"), DELIMITERS, "a delimiter"),
      encoding: oneOf(field(map, "encoding"), TEXT_ENCODINGS, "an encoding"),
      bomByteLength: count(field(map, "bomByteLength"), "a bom length"),
      newline: oneOf(field(map, "newline"), NEWLINE_CONVENTIONS, "a newline"),
    };
  }
  if (kind === "zip-container") {
    exactKeys(map, ["kind", "container"], "a container format");
    return {
      kind,
      container: oneOf(field(map, "container"), ZIP_CONTAINERS, "a container"),
    };
  }
  exactKeys(map, ["kind"], "a detected format");
  return { kind };
};

const decodeContradiction = (
  value: DecodedValue,
): ExtensionContradictionV1 | null => {
  if (value === null) {
    return null;
  }
  const map = exactKeys(
    asMap(value, "a contradiction"),
    ["declaredExtension", "expectedKind", "detectedKind"],
    "a contradiction",
  );
  return {
    declaredExtension: text(field(map, "declaredExtension"), "an extension"),
    expectedKind: oneOf(
      field(map, "expectedKind"),
      DETECTED_KINDS,
      "an expected format",
    ),
    detectedKind: oneOf(
      field(map, "detectedKind"),
      DETECTED_KINDS,
      "a detected format",
    ),
  };
};

const decodePreflight = (value: DecodedValue): PreflightReportV1 => {
  const map = exactKeys(
    asMap(value, "a preflight report"),
    [
      "fileName",
      "sourceByteLength",
      "delimiter",
      "encoding",
      "newline",
      "columnCount",
      "estimatedRowCount",
      "estimatedCellCount",
      "sampleRows",
      "bytesSampled",
    ],
    "a preflight report",
  );
  return {
    fileName: text(field(map, "fileName"), "a file name"),
    sourceByteLength: count(field(map, "sourceByteLength"), "a source length"),
    delimiter: oneOf(field(map, "delimiter"), DELIMITERS, "a delimiter"),
    encoding: oneOf(field(map, "encoding"), TEXT_ENCODINGS, "an encoding"),
    newline: oneOf(field(map, "newline"), NEWLINE_CONVENTIONS, "a newline"),
    columnCount: count(field(map, "columnCount"), "a column count"),
    estimatedRowCount: count(field(map, "estimatedRowCount"), "a row estimate"),
    estimatedCellCount: count(field(map, "estimatedCellCount"), "a cell estimate"),
    // D24: the literal `true` is the type, not a stored byte — nothing can
    // decode a report that claims its estimate was exact.
    isEstimate: true,
    sampleRows: list(field(map, "sampleRows"), "sample rows").map((row) =>
      list(row, "a sample row").map((cell) => text(cell, "a sample cell")),
    ),
    bytesSampled: count(field(map, "bytesSampled"), "a sampled length"),
  };
};

const decodeChunk = (value: DecodedValue): StagedChunkRefV1 => {
  const map = exactKeys(
    asMap(value, "a chunk"),
    ["storageId", "sequence", "decodedByteLength", "sha256"],
    "a chunk",
  );
  return {
    storageId: text(field(map, "storageId"), "a chunk storage id"),
    sequence: count(field(map, "sequence"), "a chunk sequence"),
    decodedByteLength: count(
      field(map, "decodedByteLength"),
      "a chunk length",
    ),
    sha256: bytesOfLength(field(map, "sha256"), SHA256_BYTES, "a chunk digest"),
  };
};

export function decodeImportStage(payload: Uint8Array): ImportStageV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a stage payload"),
    [
      "stageVersion",
      "stageId",
      "stageRevision",
      "lineageId",
      "fileName",
      "detected",
      "contradiction",
      "sourceSha256",
      "sourceByteLength",
      "preflight",
      "selectedSheets",
      "sourceChunks",
      "factChunks",
      "snapshotChunks",
      "proposal",
      "reviewEdits",
      "retainedStorageIds",
      "temporaryStorageIds",
      "progress",
      "status",
    ],
    "a stage payload",
  );

  if (count(field(map, "stageVersion"), "a stage version") !== IMPORT_STAGE_VERSION) {
    throw new CodecError("stage declares an unsupported version");
  }

  const progress = exactKeys(
    asMap(field(map, "progress"), "stage progress"),
    ["phase", "rowsSoFar", "batchesCommitted", "ackedBatchSeq"],
    "stage progress",
  );
  const proposal = field(map, "proposal");

  return validateImportStage({
    stageVersion: IMPORT_STAGE_VERSION,
    stageId: text(field(map, "stageId"), "a stage id"),
    stageRevision: count(field(map, "stageRevision"), "a stage revision"),
    lineageId: bytesOfLength(
      field(map, "lineageId"),
      DOMAIN_ID_BYTE_LENGTH,
      "a lineage id",
    ),
    fileName: text(field(map, "fileName"), "a file name"),
    detected: decodeDetected(field(map, "detected")),
    contradiction: decodeContradiction(field(map, "contradiction")),
    sourceSha256: bytesOfLength(
      field(map, "sourceSha256"),
      SHA256_BYTES,
      "a source digest",
    ),
    sourceByteLength: count(field(map, "sourceByteLength"), "a source length"),
    preflight: decodePreflight(field(map, "preflight")),
    selectedSheets: list(field(map, "selectedSheets"), "selected sheets").map(
      (sheet) => nfcText(sheet, "a sheet name"),
    ),
    sourceChunks: list(field(map, "sourceChunks"), "source chunks").map(decodeChunk),
    factChunks: list(field(map, "factChunks"), "fact chunks").map(decodeChunk),
    snapshotChunks: list(field(map, "snapshotChunks"), "snapshot chunks").map(
      decodeChunk,
    ),
    proposal: proposal === null ? null : decodeProposal(proposal),
    reviewEdits: list(field(map, "reviewEdits"), "review edits").map(
      decodeReviewEdit,
    ),
    retainedStorageIds: list(
      field(map, "retainedStorageIds"),
      "retained storage ids",
    ).map((id) => text(id, "a retained storage id")),
    temporaryStorageIds: list(
      field(map, "temporaryStorageIds"),
      "temporary storage ids",
    ).map((id) => text(id, "a temporary storage id")),
    progress: {
      phase: oneOf(field(progress, "phase"), IMPORT_PHASES, "a stage phase"),
      rowsSoFar: count(field(progress, "rowsSoFar"), "a row count"),
      batchesCommitted: count(
        field(progress, "batchesCommitted"),
        "a batch count",
      ),
      ackedBatchSeq: optionalCount(
        field(progress, "ackedBatchSeq"),
        "an acked batch",
      ),
    },
    status: oneOf(field(map, "status"), IMPORT_STAGE_STATUSES, "a stage status"),
  });
}
