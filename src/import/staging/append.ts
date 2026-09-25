/**
 * Append-table: a delimited file becomes a new table in an app that already
 * exists (M23; D38, CA-23, FR-1).
 *
 * It is one `import`-class commit in that app — `table.created` (carrying its
 * sheet descriptor), `field.created`×n, `enum.changed`×k, `record.created` for
 * every row (imported-invalid values kept and flagged), and
 * `inference-decision.recorded` for edited or rejected statements. No
 * `import.accepted`: that event marks an app's initial import only. The commit
 * is sealed by the same builder promotion uses (`import-commit.ts`), continuing
 * the device chain the data worker's event store holds.
 *
 * **Bounded by format law.** A commit is never split across segments, and a
 * segment holds at most {@link APPEND_MAX_EVENTS} events and
 * {@link APPEND_MAX_SEGMENT_BYTES} of padded ciphertext (database.md § event
 * segments). The event count is checked before a record is built, and the
 * sealed segment's size — estimated from its uncompressed bytes, so never
 * optimistic — before anything is written; either overflow is the typed
 * rejection `append-too-large`, and the store is untouched.
 *
 * **Validated against the target app.** The schema is checked with the app's
 * own tables, options and relationships beside the new table, and every row
 * through the one validator with the resolver the caller answers from the
 * app's projection (invariant 5).
 *
 * Order, as promotion's: validate and build outside the transaction — the
 * staged source re-sealed under the **app** key, one sheet snapshot, the
 * segment, the grown head — then one transaction with a revision check, then
 * acknowledge. The staged rows sealed under the provisional key are ticketed.
 */

import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
  type StorageId16,
} from "../../domain/model/bytes.js";
import {
  createDomainId,
  type AppId,
  type DeviceId,
  type FieldId,
  type LineageId,
  type TableId,
} from "../../domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../domain/model/events.js";
import type { ValueProvenanceV1 } from "../../domain/model/provenance.js";
import type { EnumOptionDefV1, RelationshipDefV1, TableDefV1 } from "../../domain/model/schema.js";
import { validateSchema } from "../../domain/validation/schema-checks.js";
import type { ReferenceResolver } from "../../domain/validation/validate-record.js";
import type { DomainEventV1 } from "../../migrations/004_event_format_v1.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import { selectPaddedBucket } from "../../persistence/codecs/envelope-frame.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { WorkbookFactStreamItemV2 } from "../facts/index.js";
import { chunkedSourceDigest, encodeSourceManifest, type ManifestChunkRefV1 } from "../snapshots/source-chunks.js";
import type { LoadedImportStageV1, StagingPortsV1 } from "./lifecycle.js";
import { stagedChunkStorageIds } from "./lifecycle.js";
import { sealImportCommit, type ImportChainV1 } from "./import-commit.js";
import {
  allocateSchema,
  buildRecords,
  decisionEvent,
  decisionsOf,
  inertItemsOf,
  rejectedPromotion,
  rootSealer,
  tableEvents,
  writeSnapshots,
  type PromotionRejectedV1,
} from "./promotion.js";
import { encodeAppHead, encodeAppHeadBody, type AppHeadV1, type StorageRefV1 } from "./roots.js";

/** database.md § event segments: at most this many events in one segment. */
export const APPEND_MAX_EVENTS = 10_000;

/** database.md § event segments: at most 16 MiB of padded ciphertext (the last bucket). */
export const APPEND_MAX_SEGMENT_BYTES = 16_777_216;

const STORAGE_ID_BYTES = 16;

/** The app an append lands in, as the data worker read it. */
export interface AppendTargetV1 {
  readonly appId: AppId;
  /** Live for this call; the caller owns and destroys it. */
  readonly appKey: EnvelopeKeyRefV1;
  readonly head: AppHeadV1;
  readonly headStorageId: string;
  /** This device's chain in the app (the event store's), and every commit it holds. */
  readonly chain: ImportChainV1;
  /** The app's schema as its projection holds it now, tail included. */
  readonly tables: readonly TableDefV1[];
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly relationships: readonly RelationshipDefV1[];
  /** The app's sheet count: the new sheet's ordinal. */
  readonly sheetCount: number;
  /** The one resolver, answered from the app's projection (invariant 5). */
  readonly referenceExists: ReferenceResolver;
  readonly rowCountBefore: number;
}

export interface AppendReceiptV1 {
  readonly appId: AppId;
  readonly tableId: TableId;
  readonly appHeadStorageId: string;
  readonly rowCount: number;
  readonly flaggedRecordCount: number;
  readonly transactionRevision: number;
}

export type AppendResultV1 =
  | { readonly kind: "appended"; readonly receipt: AppendReceiptV1 }
  | PromotionRejectedV1;

export interface AppendDependenciesV1 {
  readonly ports: StagingPortsV1;
  readonly clock: ClockPort;
  readonly isHeadPinned?: (headStorageId: string) => Promise<boolean>;
  /**
   * The `record.created` payload for one row. The data worker's record-event
   * mapping owns that encoding (it reads it back on replay), so it is handed
   * in rather than restated here.
   */
  readonly encodeRecordCreated: (record: AuthoredRecordV1, importedInvalid: boolean) => unknown;
  /** Repoints the app entry at the new head and drops the staging workflow, in one catalog. */
  commitCatalog(input: {
    readonly appId: AppId;
    readonly appHeadStorageId: string;
    readonly rowCount: number;
    readonly tableCount: number;
    readonly removeWorkflowStorageId: string;
    readonly addCleanupTicketStorageId: string;
    readonly logicalRevision: number;
  }): Promise<{ readonly frame: EnvelopeFrameV1; readonly storageId: string }>;
  sealCleanupTicket(input: {
    readonly storageId: StorageId16;
    readonly ticketId: string;
    readonly storageIds: readonly string[];
    readonly logicalRevision: number;
  }): Promise<EnvelopeFrameV1>;
}

export interface AppendInputV1 {
  readonly loaded: LoadedImportStageV1;
  readonly facts: readonly WorkbookFactStreamItemV2[];
  readonly target: AppendTargetV1;
  readonly deviceId: DeviceId;
}

const tooLarge: AppendResultV1 = rejectedPromotion("append-too-large");

/** Whether an encoded segment would fit the last padding bucket, sealed. */
const fitsOneSegment = (segmentPayload: Uint8Array): boolean => {
  try {
    return selectPaddedBucket(segmentPayload.byteLength) <= APPEND_MAX_SEGMENT_BYTES;
  } catch {
    return false;
  }
};

export async function appendTable(deps: AppendDependenciesV1, input: AppendInputV1): Promise<AppendResultV1> {
  const { ports } = deps;
  const { loaded, target } = input;
  const proposal = loaded.stage.proposal;
  const entropy = ports.entropy;
  const sha256 = (bytes: Uint8Array): Promise<Uint8Array> => ports.crypto.sha256(bytes);

  // --- step 1: validate, then allocate -------------------------------------
  if (proposal === null) {
    return rejectedPromotion("no-proposal");
  }
  const [table] = proposal.tables;
  if (!proposal.isDelimited || table === undefined || proposal.tables.length !== 1 || table.fields.length === 0) {
    return rejectedPromotion("empty-table");
  }
  const decisionCount = proposal.statements.filter((statement) => statement.disposition !== "accepted").length;
  const enumCount = table.fields.filter((entry) => entry.type.kind === "enum").length;
  if (1 + table.fields.length + enumCount + table.rowCount + decisionCount > APPEND_MAX_EVENTS) {
    return tooLarge;
  }

  const schemaRevisionBefore = target.head.schemaRevision;
  const schemaRevisionAfter = schemaRevisionBefore + 1n;
  const allocated = allocateSchema(entropy, proposal, {
    firstTableOrdinal: target.tables.length,
    schemaRevision: schemaRevisionAfter,
  });
  const schema = {
    ...allocated,
    // The new sheet follows the app's sheets.
    sheets: allocated.sheets.map((sheet) => ({ ...sheet, ordinal: target.sheetCount + sheet.ordinal })),
  };
  const plan = schema.tables[0];
  if (plan === undefined) {
    return rejectedPromotion("empty-table");
  }
  const schemaReport = validateSchema(
    [...target.tables, plan.table],
    [...target.enumOptions, ...schema.enumOptions],
    target.relationships,
  );
  if (!schemaReport.isValid) {
    return rejectedPromotion("schema-invalid", schemaReport, schema);
  }

  const built = await buildRecords(entropy, proposal, schema, input.facts, { referenceExists: target.referenceExists });
  if (built.firstBlockingReport !== null) {
    return rejectedPromotion("record-invalid", built.firstBlockingReport, schema);
  }

  // --- step 2: build every root, outside the write transaction -------------
  const lineageId = loaded.stage.lineageId as LineageId;
  const nowMs = deps.clock.nowEpochMs();
  const expectation = ports.catalog.expectation();
  const revision = expectation.transactionRevision + 1;
  const sealer = rootSealer(ports, target.appKey, BigInt(revision));

  // The staged original, re-sealed from the provisional key to the app key.
  const sourceChunks: ManifestChunkRefV1[] = [];
  for (const chunk of loaded.stage.sourceChunks) {
    const frame = await ports.store.getEnvelope(decodeStorageId16(chunk.storageId));
    if (frame === undefined) throw new Error("a staged source chunk is not in the store");
    const { payload } = await ports.crypto.open(frame, "app.source-chunk", loaded.provisionalKey, "app.source-chunk");
    const storageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
    sealer.frames.push(
      await ports.crypto.seal({
        scope: "app.source-chunk",
        storageId,
        logicalRevision: BigInt(revision),
        payloadKind: "app.source-chunk",
        payload,
        compression: "none",
        key: target.appKey,
      }),
    );
    sourceChunks.push({
      storageId: encodeStorageId16(storageId),
      sequence: chunk.sequence,
      decodedByteLength: chunk.decodedByteLength,
      sha256: chunk.sha256,
    });
  }
  const sourceManifestRef = await sealer.seal(
    "app.source-manifest",
    "app.source-manifest",
    encodeSourceManifest({
      manifestVersion: 1,
      fileName: loaded.stage.fileName,
      byteLength: loaded.stage.sourceByteLength,
      chunkedSha256: await chunkedSourceDigest(ports.crypto, sourceChunks),
      chunks: sourceChunks,
    }),
  );

  const snapshots = await writeSnapshots({
    sealer,
    sha256,
    proposal,
    sheets: schema.sheets,
    facts: input.facts,
    inertItems: inertItemsOf(entropy, proposal, schema.sheets),
    discarded: built.discarded,
    snapshotRevision: schemaRevisionAfter,
  });
  const sheet = snapshots[0];
  if (sheet === undefined) throw new Error("an appended file has no sheet to snapshot");

  // The one commit: the table's schema events, every row, the decisions.
  const provenance = { source: "initial-import" as const, sourceId: lineageId };
  const events: DomainEventV1[] = [];
  const push = (
    kind: DomainEventV1["kind"],
    payload: unknown,
    subject: DomainEventV1["subject"],
    eventId = createDomainId("event", entropy),
  ): void => {
    events.push({ eventId, eventIndex: events.length, kind, subject, payload, provenance });
  };
  tableEvents(schema, plan, sheet.descriptor, push, target.appId);
  const valueProvenance: ValueProvenanceV1 = { source: "initial-import", sourceId: lineageId };
  for (const record of built.records) {
    const values = new Map<FieldId, (typeof record.values)[number]["value"]>(
      record.values.map((entry) => [entry.fieldId, entry.value]),
    );
    const authored: AuthoredRecordV1 = {
      recordId: record.recordId,
      tableId: record.tableId,
      values,
      provenance: new Map([...values.keys()].map((fieldId) => [fieldId, valueProvenance])),
    };
    push(
      "record.created",
      deps.encodeRecordCreated(authored, record.issues.length > 0),
      { appId: target.appId, tableId: record.tableId, recordId: record.recordId },
    );
  }
  for (const decision of await decisionsOf(entropy, proposal, sha256)) {
    const { eventId, payload } = decisionEvent(decision);
    push("inference-decision.recorded", payload, { appId: target.appId }, eventId);
  }
  if (events.length > APPEND_MAX_EVENTS) {
    return tooLarge;
  }

  const sealed = await sealImportCommit({
    entropy,
    sha256,
    appId: target.appId,
    commitId: createDomainId("commit", entropy),
    deviceId: input.deviceId,
    chain: target.chain,
    nowMs,
    schemaRevisionBefore,
    schemaRevisionAfter,
    events,
  });
  if (!fitsOneSegment(sealed.segmentPayload)) {
    return tooLarge;
  }
  const segmentRef: StorageRefV1 = await sealer.seal("app.events", "app.event-segment", sealed.segmentPayload);

  const { semanticSha256: _previousDigest, ...previous } = target.head;
  void _previousDigest;
  const headBody: Omit<AppHeadV1, "semanticSha256"> = {
    ...previous,
    headRevision: target.head.headRevision + 1n,
    schemaRevision: schemaRevisionAfter,
    eventSegments: [...target.head.eventSegments, segmentRef],
    frontier: sealed.frontier,
    // CA-23: the retained source and the new sheet's snapshot are the app's now.
    sourceManifests: [...target.head.sourceManifests, sourceManifestRef],
    snapshotManifests: [...target.head.snapshotManifests, sheet.manifest],
  };
  const headStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  sealer.frames.push(
    await ports.crypto.seal({
      scope: "app.head",
      storageId: headStorageId,
      logicalRevision: BigInt(revision),
      payloadKind: "app.head",
      payload: encodeAppHead({ ...headBody, semanticSha256: await sha256(encodeAppHeadBody(headBody)) }),
      compression: "deflate-raw-v1",
      key: target.appKey,
    }),
  );

  // --- step 3: one transaction ---------------------------------------------
  const ticketStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  const ticketId = encodeStorageId16(ticketStorageId);
  const temporaries = [...new Set([loaded.stageStorageId, ...stagedChunkStorageIds(loaded.stage)])].sort();
  sealer.frames.push(
    await deps.sealCleanupTicket({ storageId: ticketStorageId, ticketId, storageIds: temporaries, logicalRevision: revision }),
  );
  const sealedCatalog = await deps.commitCatalog({
    appId: target.appId,
    appHeadStorageId: encodeStorageId16(headStorageId),
    rowCount: target.rowCountBefore + built.records.length,
    tableCount: target.tables.length + 1,
    removeWorkflowStorageId: loaded.workflowStorageId,
    addCleanupTicketStorageId: ticketId,
    logicalRevision: revision,
  });
  sealer.frames.push(sealedCatalog.frame);

  const pinned = await deps.isHeadPinned?.(target.headStorageId) ?? false;
  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: sealer.frames,
    // The superseded head and the workflow that held the provisional key.
    deleteStorageIds: [...(pinned ? [] : [decodeStorageId16(target.headStorageId)]), decodeStorageId16(loaded.workflowStorageId)],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);

  // --- step 4: acknowledge, only now ---------------------------------------
  return {
    kind: "appended",
    receipt: {
      appId: target.appId,
      tableId: plan.table.tableId,
      appHeadStorageId: encodeStorageId16(headStorageId),
      rowCount: built.records.length,
      flaggedRecordCount: built.flaggedCount,
      transactionRevision: committed,
    },
  };
}

