/**
 * Creating, reading, and rewriting a staged import (M23; CA-10).
 *
 * **Reachability is the whole design.** The staged bytes are sealed under a
 * provisional app key that exists nowhere except inside one `local.workflow`
 * envelope, and that envelope is named only by the current catalog's
 * `activeWorkflowStorageIds`. So there is exactly one path to the key and one
 * transaction that can remove it — which is what makes cancellation's step 2
 * ("the now-unreachable provisional key makes the staged bytes
 * cryptographically inaccessible immediately") a fact about the data rather
 * than a promise about the code.
 *
 * That provisional key **becomes the app key on promotion**, so nothing staged
 * is ever re-encrypted at the review boundary (database.md § Import staging).
 *
 * **Every rewrite is a pointer swap.** Envelopes are immutable and add-only,
 * so advancing a stage adds a new stage envelope and a new workflow envelope,
 * repoints the catalog at them, and deletes the two they superseded — all in
 * one transaction. The superseded pair is garbage the instant the new catalog
 * lands: nothing can reach it, so it is deleted outright rather than ticketed.
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
  type StorageId16,
} from "../../domain/model/bytes.js";
import { DOMAIN_ID_BYTE_LENGTH } from "../../domain/model/ids.js";
import {
  decodeCanonical,
  encodeCanonical,
} from "../../persistence/codecs/canonical-cbor.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type {
  EnvelopeCryptoPort,
  EnvelopeKeyRefV1,
} from "../../application/ports/envelope-crypto.js";
import type { EnvelopeStorePort } from "../../application/ports/envelope-store.js";
import type { StagingCatalogPort } from "../../application/ports/staging-catalog.js";
import type { DetectedFormatV1, ExtensionContradictionV1 } from "../source/sniff.js";
import type { PreflightReportV1 } from "../preflight/preflight.js";
import {
  asMap,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
  text,
} from "./proposal-codec.js";
import {
  IMPORT_STAGE_PAYLOAD_KIND,
  IMPORT_STAGE_SCOPE,
  IMPORT_STAGE_VERSION,
  decodeImportStage,
  encodeImportStage,
  type ImportStageV1,
} from "./stage.js";

const WORKFLOW_SCOPE = "local.workflow" as const;
const WORKFLOW_PAYLOAD_KIND = "local.workflow-resume" as const;
const WORKFLOW_VERSION = 1;
const STORAGE_ID_BYTES = 16;

/** A provisional app key is a full-strength envelope key: 32 bytes. */
export const PROVISIONAL_KEY_BYTES = 32;

export interface StagingPortsV1 {
  readonly store: EnvelopeStorePort;
  readonly crypto: EnvelopeCryptoPort;
  readonly catalog: StagingCatalogPort;
  readonly entropy: EntropyPort;
}

/**
 * `WorkflowResumeV1` for an import (database.md § Encrypted Logical
 * Collections): the machine kind, the opaque reference to its input, and the
 * wrapped provisional key. It is sealed under the **local root**, which is why
 * a locked device can reach neither it nor anything it names.
 */
export interface ImportWorkflowResumeV1 {
  readonly workflowVersion: typeof WORKFLOW_VERSION;
  readonly kind: "import";
  readonly stageId: string;
  /** Where the current stage payload lives; moves on every rewrite. */
  readonly stageStorageId: string;
  readonly provisionalKey: Uint8Array;
}

/** An open stage: its payload, where it lives, and the key that opens it. */
export interface LoadedImportStageV1 {
  readonly stage: ImportStageV1;
  readonly stageStorageId: string;
  readonly workflowStorageId: string;
  readonly provisionalKey: EnvelopeKeyRefV1;
}

export interface CreateImportStageInputV1 {
  readonly fileName: string;
  readonly detected: DetectedFormatV1;
  readonly contradiction: ExtensionContradictionV1 | null;
  readonly preflight: PreflightReportV1;
  readonly sourceByteLength: number;
  readonly selectedSheets: readonly string[];
}

// ------------------------------------------------------------ workflow codec --

function encodeWorkflowResume(resume: ImportWorkflowResumeV1): Uint8Array {
  if (resume.provisionalKey.byteLength !== PROVISIONAL_KEY_BYTES) {
    throw new CodecError("a provisional key must be 32 bytes");
  }
  return encodeCanonical(
    cborMap([
      ["workflowVersion", resume.workflowVersion],
      ["kind", resume.kind],
      ["stageId", resume.stageId],
      ["stageStorageId", resume.stageStorageId],
      ["provisionalKey", resume.provisionalKey],
    ]),
  );
}

function decodeWorkflowResume(payload: Uint8Array): ImportWorkflowResumeV1 {
  const map = exactKeys(
    asMap(decodeCanonical(payload), "a workflow resume"),
    ["workflowVersion", "kind", "stageId", "stageStorageId", "provisionalKey"],
    "a workflow resume",
  );
  if (count(field(map, "workflowVersion"), "a workflow version") !== WORKFLOW_VERSION) {
    throw new CodecError("workflow resume declares an unsupported version");
  }
  if (text(field(map, "kind"), "a workflow kind") !== "import") {
    // F02 has one workflow kind. A stored value naming another has no
    // producer, so it is corruption rather than a future shape to tolerate.
    throw new CodecError("workflow resume is not an import workflow");
  }
  return {
    workflowVersion: WORKFLOW_VERSION,
    kind: "import",
    stageId: text(field(map, "stageId"), "a stage id"),
    stageStorageId: text(field(map, "stageStorageId"), "a stage storage id"),
    provisionalKey: bytesOfLength(
      field(map, "provisionalKey"),
      PROVISIONAL_KEY_BYTES,
      "a provisional key",
    ),
  };
}

// ---------------------------------------------------------------- utilities --

const freshStorageId = (entropy: EntropyPort): StorageId16 =>
  asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));

const withoutIds = (
  values: readonly string[],
  removed: readonly string[],
): readonly string[] => {
  const drop = new Set(removed);
  return values.filter((value) => !drop.has(value));
};

/** Every chunk the stage names, in one list — what a cleanup ticket collects. */
export function stagedChunkStorageIds(stage: ImportStageV1): readonly string[] {
  return [
    ...stage.sourceChunks,
    ...stage.factChunks,
    ...stage.snapshotChunks,
  ].map((chunk) => chunk.storageId);
}

// ------------------------------------------------------------------- create --

export interface CreatedImportStageV1 {
  readonly loaded: LoadedImportStageV1;
  readonly transactionRevision: number;
}

/**
 * Generates the provisional key, seals the empty stage under it, seals the
 * workflow that reaches it under the local root, and commits both with the
 * catalog that names the workflow — **one transaction**. A crash before it
 * commits leaves nothing; a crash after leaves a stage the unlock sweep can
 * find and clean.
 */
export async function createImportStage(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  input: CreateImportStageInputV1,
): Promise<CreatedImportStageV1> {
  const expectation = ports.catalog.expectation();
  const revision = expectation.transactionRevision + 1;
  const logicalRevision = BigInt(revision);

  const keyBytes = ports.entropy.randomBytes(PROVISIONAL_KEY_BYTES);
  if (keyBytes.byteLength !== PROVISIONAL_KEY_BYTES) {
    throw new CodecError("entropy port returned the wrong key length");
  }
  // The seal copies these bytes into the workflow payload before the handle
  // takes ownership of the array, so the key exists in exactly two places
  // afterwards: this worker's memory, and that one envelope.
  const keyBytesForWrap = Uint8Array.from(keyBytes);

  const stageId = encodeStorageId16(freshStorageId(ports.entropy));
  const stageStorageId = freshStorageId(ports.entropy);
  const workflowStorageId = freshStorageId(ports.entropy);

  const stage: ImportStageV1 = {
    stageVersion: IMPORT_STAGE_VERSION,
    stageId,
    stageRevision: 1,
    lineageId: ports.entropy.randomBytes(DOMAIN_ID_BYTE_LENGTH),
    fileName: input.fileName,
    detected: input.detected,
    contradiction: input.contradiction,
    // Not known yet: nothing has read the source through (see `stage.ts`).
    sourceSha256: null,
    sourceByteLength: input.sourceByteLength,
    preflight: input.preflight,
    selectedSheets: input.selectedSheets,
    sourceChunks: [],
    factChunks: [],
    snapshotChunks: [],
    proposal: null,
    reviewEdits: [],
    retainedStorageIds: [],
    temporaryStorageIds: [],
    progress: {
      phase: "parsing",
      rowsSoFar: 0,
      batchesCommitted: 0,
      ackedBatchSeq: null,
    },
    status: "staging",
  };

  const provisionalKey = ports.crypto.importKey(keyBytes);

  const stageFrame = await ports.crypto.seal({
    scope: IMPORT_STAGE_SCOPE,
    storageId: stageStorageId,
    logicalRevision,
    payloadKind: IMPORT_STAGE_PAYLOAD_KIND,
    payload: encodeImportStage(stage),
    compression: "deflate-raw-v1",
    key: provisionalKey,
  });

  const workflowFrame = await ports.crypto.seal({
    scope: WORKFLOW_SCOPE,
    storageId: workflowStorageId,
    logicalRevision,
    payloadKind: WORKFLOW_PAYLOAD_KIND,
    payload: encodeWorkflowResume({
      workflowVersion: WORKFLOW_VERSION,
      kind: "import",
      stageId,
      stageStorageId: encodeStorageId16(stageStorageId),
      provisionalKey: keyBytesForWrap,
    }),
    // The payload is a 32-byte key and two ids: compressing high-entropy
    // bytes only pads them, so this one is stored as-is.
    compression: "none",
    key: localRoot,
  });
  keyBytesForWrap.fill(0);

  const refs = ports.catalog.readRefs();
  const sealedCatalog = await ports.catalog.sealWithRefs(
    {
      activeWorkflowStorageIds: [
        ...refs.activeWorkflowStorageIds,
        encodeStorageId16(workflowStorageId),
      ],
      cleanupTicketStorageIds: refs.cleanupTicketStorageIds,
    },
    logicalRevision,
  );
  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: [stageFrame, workflowFrame, sealedCatalog.frame],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);

  return {
    loaded: {
      stage,
      stageStorageId: encodeStorageId16(stageStorageId),
      workflowStorageId: encodeStorageId16(workflowStorageId),
      provisionalKey,
    },
    transactionRevision: committed,
  };
}

// --------------------------------------------------------------------- read --

/**
 * Opens the stage a workflow reference names. Returns `undefined` when the
 * workflow envelope is gone, which is the normal state after a cancellation:
 * a stale reference is not corruption, it is work the sweep has to finish.
 */
export async function readImportStage(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  workflowStorageId: string,
): Promise<LoadedImportStageV1 | undefined> {
  const workflowFrame = await ports.store.getEnvelope(
    decodeStorageId16(workflowStorageId),
  );
  if (workflowFrame === undefined) {
    return undefined;
  }

  const opened = await ports.crypto.open(
    workflowFrame,
    WORKFLOW_SCOPE,
    localRoot,
    WORKFLOW_PAYLOAD_KIND,
  );
  const resume = decodeWorkflowResume(opened.payload);
  const provisionalKey = ports.crypto.importKey(resume.provisionalKey);

  const stageFrame = await ports.store.getEnvelope(
    decodeStorageId16(resume.stageStorageId),
  );
  if (stageFrame === undefined) {
    // The workflow survived but its stage did not. Nothing can be resumed
    // from this, and inventing an empty stage would hide the damage.
    ports.crypto.destroyKey(provisionalKey);
    return undefined;
  }

  const stagePayload = await ports.crypto.open(
    stageFrame,
    IMPORT_STAGE_SCOPE,
    provisionalKey,
    IMPORT_STAGE_PAYLOAD_KIND,
  );

  return {
    stage: decodeImportStage(stagePayload.payload),
    stageStorageId: resume.stageStorageId,
    workflowStorageId,
    provisionalKey,
  };
}

// -------------------------------------------------------------------- write --

export interface StageWriteExtrasV1 {
  /** Chunk envelopes sealed by the caller at this same revision. */
  readonly addFrames?: readonly EnvelopeFrameV1[];
  readonly deleteStorageIds?: readonly StorageId16[];
}

/**
 * Replaces the stage payload and the workflow that points at it, in one
 * transaction with whatever chunk envelopes the caller sealed for the same
 * revision. `stageRevision` advances, so a writer holding a stale copy is
 * refused by the revision gate before it can overwrite newer work.
 */
export async function writeImportStage(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  loaded: LoadedImportStageV1,
  next: ImportStageV1,
  extras: StageWriteExtrasV1 = {},
): Promise<{
  readonly loaded: LoadedImportStageV1;
  readonly transactionRevision: number;
}> {
  if (next.stageRevision !== loaded.stage.stageRevision + 1) {
    throw new CodecError("a stage rewrite must advance the stage revision by one");
  }
  if (next.stageId !== loaded.stage.stageId) {
    throw new CodecError("a stage rewrite cannot change the stage id");
  }

  const expectation = ports.catalog.expectation();
  const revision = expectation.transactionRevision + 1;
  const logicalRevision = BigInt(revision);

  const stageStorageId = freshStorageId(ports.entropy);
  const workflowStorageId = freshStorageId(ports.entropy);

  const stageFrame = await ports.crypto.seal({
    scope: IMPORT_STAGE_SCOPE,
    storageId: stageStorageId,
    logicalRevision,
    payloadKind: IMPORT_STAGE_PAYLOAD_KIND,
    payload: encodeImportStage(next),
    compression: "deflate-raw-v1",
    key: loaded.provisionalKey,
  });

  const keyBytesForWrap = await readProvisionalKeyBytes(
    ports,
    localRoot,
    loaded.workflowStorageId,
  );
  const workflowFrame = await ports.crypto.seal({
    scope: WORKFLOW_SCOPE,
    storageId: workflowStorageId,
    logicalRevision,
    payloadKind: WORKFLOW_PAYLOAD_KIND,
    payload: encodeWorkflowResume({
      workflowVersion: WORKFLOW_VERSION,
      kind: "import",
      stageId: next.stageId,
      stageStorageId: encodeStorageId16(stageStorageId),
      provisionalKey: keyBytesForWrap,
    }),
    compression: "none",
    key: localRoot,
  });
  keyBytesForWrap.fill(0);

  const refs = ports.catalog.readRefs();
  const sealedCatalog = await ports.catalog.sealWithRefs(
    {
      activeWorkflowStorageIds: [
        ...withoutIds(refs.activeWorkflowStorageIds, [loaded.workflowStorageId]),
        encodeStorageId16(workflowStorageId),
      ],
      cleanupTicketStorageIds: refs.cleanupTicketStorageIds,
    },
    logicalRevision,
  );

  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: [stageFrame, workflowFrame, sealedCatalog.frame, ...(extras.addFrames ?? [])],
    // The pair this rewrite supersedes. Both are unreachable the moment the
    // new catalog lands — the new catalog names the new workflow and nothing
    // else names the old one — so this is a pointer swap, not a collection
    // policy, and needs no ticket to protect it. Superseded *catalogs* are
    // deliberately left alone: F01's `updateSettings` leaves them too, and
    // collecting them is F05's mark-and-sweep, not staging's business.
    deleteStorageIds: [
      decodeStorageId16(loaded.stageStorageId),
      decodeStorageId16(loaded.workflowStorageId),
      ...(extras.deleteStorageIds ?? []),
    ],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);

  return {
    loaded: {
      stage: next,
      stageStorageId: encodeStorageId16(stageStorageId),
      workflowStorageId: encodeStorageId16(workflowStorageId),
      provisionalKey: loaded.provisionalKey,
    },
    transactionRevision: committed,
  };
}

/**
 * Re-reads the provisional key from the workflow envelope. M08 exposes no way
 * to read a key handle's bytes back — deliberately — so re-sealing the
 * workflow reads the durable copy rather than keeping a plaintext one alive
 * in worker memory between commits.
 */
async function readProvisionalKeyBytes(
  ports: StagingPortsV1,
  localRoot: EnvelopeKeyRefV1,
  workflowStorageId: string,
): Promise<Uint8Array> {
  const frame = await ports.store.getEnvelope(decodeStorageId16(workflowStorageId));
  if (frame === undefined) {
    throw new CodecError("the stage's workflow reference no longer resolves");
  }
  const opened = await ports.crypto.open(
    frame,
    WORKFLOW_SCOPE,
    localRoot,
    WORKFLOW_PAYLOAD_KIND,
  );
  return decodeWorkflowResume(opened.payload).provisionalKey;
}
