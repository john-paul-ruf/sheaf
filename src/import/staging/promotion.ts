/**
 * Promotion: a reviewed proposal becomes a durable app, or nothing (M23;
 * CA-11; database.md § Import staging promotion order).
 *
 * The four steps are the contract, in this order:
 *
 * 1. **Validate and allocate.** The reviewed proposal goes through the shared
 *    validator (invariant 5) — the same `validateRecord` a CRUD write uses —
 *    and only then do permanent domain IDs come into existence. A refusal here
 *    is a typed **result** (D23): nothing has been written, so there is
 *    nothing to undo.
 * 2. **Build outside the transaction.** Every root — record pages, checkpoint,
 *    baseline, source and snapshot manifests, the event commit — is encoded
 *    and encrypted before the write opens. Crypto never runs inside an
 *    IndexedDB transaction (database.md § Transaction rule).
 * 3. **One transaction.** The roots are added, the app key is wrapped under
 *    the local root, the catalog gains its app entry and loses the staging
 *    workflow, the temporaries are ticketed, and the bootstrap advances —
 *    together, or not at all.
 * 4. **Acknowledge after commit.** `Create app` is answered only once the
 *    transaction has completed.
 *
 * **The commit/checkpoint split (CA-11), as implemented.** The single
 * `import`-class commit carries the *schema-establishing* events —
 * `app.created`, `table.created`, one `field.created` per column, one
 * `enum.changed` per enum field, one `inference-decision.recorded` per edited
 * or rejected statement, and `import.accepted`. The **imported rows are in the
 * initial checkpoint**, not as per-row `record.created` events. That is what
 * `app.created`'s "pairs with an initial checkpoint" means, and it is
 * load-bearing: S02 proved a tail replay that meets an unknown table or field
 * disposes the whole projection, so nothing about the app may exist only in
 * tail events.
 *
 * **Imported-invalid values are kept.** A value that does not fit its field is
 * stored as `invalid-preserved` with the validator's warning beside it, never
 * coerced and never dropped (FR-4/FR-6).
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  asStorageId16,
  decodeStorageId16,
  encodeStorageId16,
  type StorageId16,
} from "../../domain/model/bytes.js";
import {
  compareDomainIds,
  createDomainId,
  type AppId,
  type DeviceId,
  type FieldId,
  type LineageId,
  type OptionId,
  type RecordId,
  type SheetId,
  type TableId,
} from "../../domain/model/ids.js";
import type { AppThemeV1 } from "../../domain/model/events.js";
import type { EnumOptionDefV1, FieldDefV1, TableDefV1 } from "../../domain/model/schema.js";
import { validateSchema } from "../../domain/validation/schema-checks.js";
import { validateRecord } from "../../domain/validation/validate-record.js";
import type { ValidationReport } from "../../domain/validation/rules.js";
import { MISSING_VALUE, type CellValueV1 } from "../../domain/model/values.js";
import type { DomainEventV1 } from "../../migrations/004_event_format_v1.js";
import {
  encodeEventSegment,
  sealEventCommit,
  verifyCommitChain,
  type EventCommitBodyV1,
} from "../../persistence/codecs/event-commit.js";
import type { EnvelopeFrameV1 } from "../../migrations/003_envelope_format_v1.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EnvelopeKeyRefV1 } from "../../application/ports/envelope-crypto.js";
import type { WorkbookFactStreamItemV1 } from "../formats/delimited/facts.js";
import type { ProposedAppV1, ProposedFieldV1 } from "../inference/infer.js";
import { sourceTextToCellValue } from "../inference/values.js";
import {
  chunkSnapshotRows,
  encodeSnapshotChunk,
  encodeSnapshotManifest,
  snapshotRowsFromFacts,
} from "../snapshots/delimited-snapshot.js";
import {
  chunkedSourceDigest,
  encodeSourceManifest,
  type ManifestChunkRefV1,
} from "../snapshots/source-chunks.js";
import { DEFAULT_APP_THEME, accentForApp, glyphForApp } from "./theme.js";
import {
  encodeAppHead,
  encodeAppHeadBody,
  encodeBaselinePage,
  encodeCheckpointBody,
  encodeCheckpointManifest,
  encodeRecordPage,
  compareRecordKeys,
  RECORD_PAGE_MAX_RECORDS,
  type AppHeadV1,
  type BaselineEntryV1,
  type CheckpointManifestV1,
  type PageRefV1,
  type StorageRefV1,
  type StoredRecordV1,
} from "./roots.js";
import { encodeImportEventPayload } from "./events.js";
import type { LoadedImportStageV1, StagingPortsV1 } from "./lifecycle.js";
import {
  readProvisionalKeyBytes,
  stagedChunkStorageIds,
} from "./lifecycle.js";
import { serializeEnvelopeTransport } from "../../persistence/codecs/envelope-frame.js";

const ID_BYTES = 16;
const STORAGE_ID_BYTES = 16;

/** Promotion refuses for reasons a person can act on; each is a closed token. */
export const PROMOTION_REJECTIONS = Object.freeze([
  "schema-invalid",
  "record-invalid",
  "no-proposal",
  "empty-table",
] as const);

export type PromotionRejectionV1 = (typeof PROMOTION_REJECTIONS)[number];

export interface PromotionReceiptV1 {
  readonly appId: AppId;
  readonly appHeadStorageId: string;
  readonly rowCount: number;
  readonly tableCount: number;
  readonly transactionRevision: number;
  /** Rows kept and flagged rather than refused (FR-4). */
  readonly flaggedRecordCount: number;
}

export type PromotionResultV1 =
  | { readonly kind: "promoted"; readonly receipt: PromotionReceiptV1 }
  | {
      readonly kind: "rejected";
      readonly reason: PromotionRejectionV1;
      readonly report: ValidationReport | null;
    };

export interface PromoteInputV1 {
  readonly loaded: LoadedImportStageV1;
  readonly facts: readonly WorkbookFactStreamItemV1[];
  /** The source bytes, already chunked and staged, in order. */
  readonly sourceChunks: readonly ManifestChunkRefV1[];
  readonly acceptedName: string;
  readonly deviceId: DeviceId;
}

// ------------------------------------------------------ schema construction --

interface AllocatedSchemaV1 {
  readonly table: TableDefV1;
  readonly enumOptions: readonly EnumOptionDefV1[];
  readonly optionIdsByColumn: ReadonlyMap<number, ReadonlyMap<string, OptionId>>;
  readonly sheetId: SheetId;
}

const SCHEMA_REVISION_AFTER = 1n;

function allocateSchema(
  entropy: EntropyPort,
  proposal: ProposedAppV1,
): AllocatedSchemaV1 {
  const tableId = createDomainId("table", entropy);
  const sheetId = createDomainId("sheet", entropy);
  const enumOptions: EnumOptionDefV1[] = [];
  const optionIdsByColumn = new Map<number, ReadonlyMap<string, OptionId>>();

  const fields: FieldDefV1[] = proposal.table.fields.map(
    (proposed: ProposedFieldV1, index: number): FieldDefV1 => {
      const fieldId = createDomainId("field", entropy);

      if (proposed.type.kind === "enum") {
        const byLabel = new Map<string, OptionId>();
        proposed.enumOptions.forEach((option, ordinal) => {
          const optionId = createDomainId("option", entropy);
          byLabel.set(option.label, optionId);
          enumOptions.push({
            optionId,
            fieldId,
            displayLabel: option.label,
            optionOrdinal: ordinal,
            isActive: true,
            schemaRevision: SCHEMA_REVISION_AFTER,
          });
        });
        optionIdsByColumn.set(proposed.columnIndex, byLabel);
      }

      return {
        fieldId,
        tableId,
        displayName: proposed.fieldName,
        fieldOrdinal: index,
        type: proposed.type,
        // F02 proposes no required field: a required column would refuse rows
        // the file actually contains, and FR-4 keeps them instead.
        isRequired: false,
        isActive: true,
        schemaRevision: SCHEMA_REVISION_AFTER,
      };
    },
  );

  return {
    table: {
      tableId,
      displayName: proposal.table.tableName,
      tableOrdinal: 0,
      fields,
      keyFieldId: null,
      labelFieldId: null,
      sourceSheetId: sheetId,
      isActive: true,
      schemaRevision: SCHEMA_REVISION_AFTER,
    },
    enumOptions,
    optionIdsByColumn,
    sheetId,
  };
}

// ------------------------------------------------------ record construction --

interface BuiltRecordsV1 {
  readonly records: readonly StoredRecordV1[];
  readonly flaggedCount: number;
  readonly firstBlockingReport: ValidationReport | null;
}

/**
 * Turns the accepted data rows into records, using **S03's own converter**:
 * `sourceTextToCellValue` is the one function that decides both what
 * inference counted as fitting and what is stored, so the review screen's
 * "two values do not match" names exactly the two values preserved here.
 */
function buildRecords(
  entropy: EntropyPort,
  proposal: ProposedAppV1,
  schema: AllocatedSchemaV1,
  facts: readonly WorkbookFactStreamItemV1[],
): BuiltRecordsV1 {
  const rows = snapshotRowsFromFacts(facts);
  const headerRowIndex = proposal.headerRowIndex;
  const discarded = new Set(proposal.discardedRows.map((row) => row.rowIndex));

  const enumOptionsByField = new Map<FieldId, readonly EnumOptionDefV1[]>();
  for (const option of schema.enumOptions) {
    enumOptionsByField.set(option.fieldId, [
      ...(enumOptionsByField.get(option.fieldId) ?? []),
      option,
    ]);
  }
  const validationContext = {
    table: schema.table,
    enumOptions: enumOptionsByField,
    rules: [],
    // F02 proposes no reference field (D25), so nothing can be referenced and
    // the resolver is never consulted for a real lookup.
    referenceExists: (): boolean => false,
  };

  const records: StoredRecordV1[] = [];
  let flaggedCount = 0;
  let firstBlockingReport: ValidationReport | null = null;

  for (const row of rows) {
    if (
      (headerRowIndex !== null && row.rowIndex <= headerRowIndex) ||
      discarded.has(row.rowIndex) ||
      row.cells.every((cell) => cell === "")
    ) {
      continue;
    }

    const recordId = createDomainId("record", entropy);
    const values = new Map<FieldId, CellValueV1>();
    const entries: { readonly fieldId: FieldId; readonly value: CellValueV1 }[] = [];

    proposal.table.fields.forEach((proposed, index) => {
      const definition = schema.table.fields[index] as FieldDefV1;
      const sourceText = row.cells[proposed.columnIndex];

      let value: CellValueV1;
      if (sourceText === undefined) {
        // At or beyond the row's width: the cell never existed (S03's
        // sparsity contract). `missing` and `blank` never collapse.
        value = MISSING_VALUE;
      } else {
        const converted = sourceTextToCellValue(sourceText, {
          type: proposed.type,
          sourceFormat: proposed.sourceFormat,
          enumOptions: proposed.enumOptions.map((option) => option.label),
        });
        if (converted.kind === "enum-option") {
          const optionId = schema.optionIdsByColumn
            .get(proposed.columnIndex)
            ?.get(converted.label);
          if (optionId === undefined) {
            throw new CodecError("an enum option has no allocated identity");
          }
          value = { kind: "enum", optionId };
        } else {
          value = converted.value;
        }
      }

      values.set(definition.fieldId, value);
      entries.push({ fieldId: definition.fieldId, value });
    });

    const report = validateRecord(validationContext, {
      recordId,
      tableId: schema.table.tableId,
      values,
    });
    if (!report.isValid && firstBlockingReport === null) {
      firstBlockingReport = report;
    }
    if (report.issues.length > 0) {
      flaggedCount += 1;
    }

    records.push({
      recordId,
      tableId: schema.table.tableId,
      values: entries,
      issues: report.issues.map((issue) => ({
        fieldId: issue.fieldId,
        kind: issue.kind,
        severity: issue.severity,
        messageKey: issue.messageKey,
      })),
    });
  }

  return {
    records: [...records].sort(compareRecordKeys),
    flaggedCount,
    firstBlockingReport,
  };
}

/** Splits sorted records into pages inside both caps. */
function paginate(records: readonly StoredRecordV1[]): readonly StoredRecordV1[][] {
  const pages: StoredRecordV1[][] = [];
  let current: StoredRecordV1[] = [];

  for (const record of records) {
    const candidate = [...current, record];
    const overCount = candidate.length > RECORD_PAGE_MAX_RECORDS;
    // The byte cap is checked by encoding the candidate: the cap is on the
    // decoded CBOR, so the encoder is the only honest measure of it.
    let overBytes = false;
    if (!overCount) {
      try {
        encodeRecordPage({ pageVersion: 1, records: candidate });
      } catch {
        overBytes = true;
      }
    }
    if ((overCount || overBytes) && current.length > 0) {
      pages.push(current);
      current = [record];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    pages.push(current);
  }
  return pages.length === 0 ? [[]] : pages;
}

const pageKey = (record: StoredRecordV1): Uint8Array => {
  const key = new Uint8Array(ID_BYTES * 2);
  key.set(record.tableId, 0);
  key.set(record.recordId, ID_BYTES);
  return key;
};

// ------------------------------------------------------------------ the run --

export interface PromotionDependenciesV1 {
  readonly ports: StagingPortsV1;
  readonly clock: ClockPort;
  readonly localRoot: EnvelopeKeyRefV1;
  /** Adds the app entry and drops the staging workflow, in one catalog. */
  commitCatalog(input: {
    readonly appId: AppId;
    readonly displayName: string;
    readonly accentId: string;
    readonly glyph: string;
    readonly createdAtEpochMs: number;
    readonly rowCount: number;
    readonly tableCount: number;
    readonly wrappedAppKey: Uint8Array;
    readonly appHeadStorageId: string;
    readonly removeWorkflowStorageId: string;
    readonly addCleanupTicketStorageId: string;
    readonly logicalRevision: number;
  }): Promise<{ readonly frame: EnvelopeFrameV1; readonly storageId: string }>;
  /** Seals a cleanup ticket for the stage's temporaries. */
  sealCleanupTicket(input: {
    readonly storageId: StorageId16;
    readonly ticketId: string;
    readonly storageIds: readonly string[];
    readonly logicalRevision: number;
  }): Promise<EnvelopeFrameV1>;
}

/**
 * Runs the whole promotion. Returns a typed rejection rather than throwing
 * when the reviewed proposal cannot become an app: the user can fix it on the
 * review screen, and a refusal that reached them as an error would say
 * nothing about what to change (D23).
 */
export async function promoteImport(
  deps: PromotionDependenciesV1,
  input: PromoteInputV1,
): Promise<PromotionResultV1> {
  const { ports } = deps;
  const { loaded, facts } = input;
  const proposal = loaded.stage.proposal;

  // --- step 1: validate, then allocate -------------------------------------
  if (proposal === null) {
    return { kind: "rejected", reason: "no-proposal", report: null };
  }
  if (proposal.table.fields.length === 0) {
    return { kind: "rejected", reason: "empty-table", report: null };
  }

  const entropy = ports.entropy;
  const schema = allocateSchema(entropy, proposal);

  const schemaReport = validateSchema([schema.table], schema.enumOptions);
  if (!schemaReport.isValid) {
    return { kind: "rejected", reason: "schema-invalid", report: schemaReport };
  }

  const built = buildRecords(entropy, proposal, schema, facts);
  if (built.firstBlockingReport !== null) {
    // A blocking issue is not an imported-invalid value: those are warnings
    // and are kept (FR-4). This is a schema the rows cannot satisfy at all.
    return {
      kind: "rejected",
      reason: "record-invalid",
      report: built.firstBlockingReport,
    };
  }

  // --- step 2: build every root, outside the write transaction -------------
  const appId = createDomainId("app", entropy);
  const lineageId = loaded.stage.lineageId as LineageId;
  const nowMs = deps.clock.nowEpochMs();

  const expectation = ports.catalog.expectation();
  const revision = expectation.transactionRevision + 1;
  const logicalRevision = BigInt(revision);
  const frames: EnvelopeFrameV1[] = [];

  const sealRoot = async (
    scope: Parameters<StagingPortsV1["crypto"]["seal"]>[0]["scope"],
    payloadKind: Parameters<StagingPortsV1["crypto"]["seal"]>[0]["payloadKind"],
    payload: Uint8Array,
  ): Promise<StorageRefV1> => {
    const storageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
    frames.push(
      await ports.crypto.seal({
        scope,
        storageId,
        logicalRevision,
        payloadKind,
        payload,
        compression: "deflate-raw-v1",
        key: loaded.provisionalKey,
      }),
    );
    return {
      storageId: encodeStorageId16(storageId),
      semanticSha256: await ports.crypto.sha256(payload),
    };
  };

  // Record pages, sorted and capped.
  const pages = paginate(built.records);
  const recordPageRefs: PageRefV1[] = [];
  for (const page of pages) {
    const payload = encodeRecordPage({ pageVersion: 1, records: page });
    const ref = await sealRoot("app.records", "app.record-page", payload);
    const first = page[0];
    const last = page.at(-1);
    recordPageRefs.push({
      storageId: ref.storageId,
      firstKey: first === undefined ? null : pageKey(first),
      lastKey: last === undefined ? null : pageKey(last),
      decodedCount: page.length,
      decodedByteLength: payload.byteLength,
      semanticSha256: ref.semanticSha256,
    });
  }

  // The original-import baseline: every accepted row exactly as accepted.
  const baselineEntries: BaselineEntryV1[] = built.records.map((record) => ({
    tableId: record.tableId,
    recordId: record.recordId,
    state: "present",
    values: record.values,
  }));
  const baselineRef = await sealRoot(
    "app.baselines",
    "app.baseline-page",
    encodeBaselinePage({
      pageVersion: 1,
      scopeId: lineageId,
      entries: baselineEntries,
    }),
  );

  // The retained source, and the normalized snapshot of the sheet.
  const sourceManifestRef = await sealRoot(
    "app.source-manifest",
    "app.source-manifest",
    encodeSourceManifest({
      manifestVersion: 1,
      fileName: loaded.stage.fileName,
      byteLength: loaded.stage.sourceByteLength,
      chunkedSha256: await chunkedSourceDigest(ports.crypto, input.sourceChunks),
      chunks: input.sourceChunks,
    }),
  );

  const snapshotRows = snapshotRowsFromFacts(facts);
  const snapshotChunkRefs: ManifestChunkRefV1[] = [];
  for (const chunk of chunkSnapshotRows(snapshotRows)) {
    const payload = encodeSnapshotChunk(chunk);
    const ref = await sealRoot("app.snapshot-chunk", "app.snapshot-chunk", payload);
    snapshotChunkRefs.push({
      storageId: ref.storageId,
      sequence: chunk.sequence,
      decodedByteLength: payload.byteLength,
      sha256: ref.semanticSha256,
    });
  }
  const snapshotManifestRef = await sealRoot(
    "app.snapshot-manifest",
    "app.snapshot-manifest",
    encodeSnapshotManifest({
      manifestVersion: 1,
      sheetName: proposal.table.tableName,
      rowCount: snapshotRows.length,
      columnCount: proposal.table.fields.length,
      chunks: snapshotChunkRefs,
    }),
  );

  // The initial checkpoint. The imported rows live here, not in the tail.
  const theme: AppThemeV1 = DEFAULT_APP_THEME;
  const checkpointBody: Omit<CheckpointManifestV1, "semanticSha256"> = {
    manifestVersion: 1,
    appId,
    schemaRevision: SCHEMA_REVISION_AFTER,
    frontier: [{ deviceId: input.deviceId, commitSequence: 1n }],
    appState: {
      appId,
      displayName: input.acceptedName,
      createdAtMs: nowMs,
      lastOpenedAtMs: null,
      schemaRevision: SCHEMA_REVISION_AFTER,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme,
      stateRevision: 1n,
    },
    tables: [schema.table],
    enumOptions: schema.enumOptions,
    sheetSnapshots: [
      {
        sheetId: schema.sheetId,
        displayName: proposal.table.tableName,
        sheetOrdinal: 0,
        snapshotManifestStorageId: snapshotManifestRef.storageId,
        declaredRowCount: null,
        declaredColumnCount: null,
      },
    ],
    recordPages: recordPageRefs,
  };
  const checkpointSemantic = await ports.crypto.sha256(
    encodeCheckpointBody(checkpointBody),
  );
  const checkpointRef = await sealRoot(
    "app.checkpoint",
    "app.checkpoint-manifest",
    encodeCheckpointManifest({ ...checkpointBody, semanticSha256: checkpointSemantic }),
  );

  // The one import-class commit: schema-establishing events only.
  const events = await buildImportEvents({
    entropy,
    appId,
    lineageId,
    proposal,
    schema,
    theme,
    displayName: input.acceptedName,
    refs: {
      sourceManifestStorageId: decodeStorageId16(sourceManifestRef.storageId),
      snapshotManifestStorageId: decodeStorageId16(snapshotManifestRef.storageId),
      checkpointManifestStorageId: decodeStorageId16(checkpointRef.storageId),
      originalBaselineStorageId: decodeStorageId16(baselineRef.storageId),
    },
    sha256: (bytes) => ports.crypto.sha256(bytes),
  });

  const commitBody: EventCommitBodyV1 = {
    eventFormatVersion: 1,
    commitId: createDomainId("commit", entropy),
    appId,
    deviceId: input.deviceId,
    deviceCommitSequence: 1n,
    previousDeviceCommitSha256: null,
    basisFrontier: [],
    hybridTime: { wallTimeMs: BigInt(nowMs), logicalCounter: 0 },
    eventClass: "import",
    schemaRevisionBefore: 0n,
    schemaRevisionAfter: SCHEMA_REVISION_AFTER,
    events,
  };
  const commit = await sealEventCommit(commitBody, (bytes) =>
    ports.crypto.sha256(bytes),
  );
  // D27: one segment per commit at F02 scale.
  const segmentSemantic = await ports.crypto.sha256(commit.commitSha256);
  const segmentPayload = encodeEventSegment({
    eventFormatVersion: 1,
    segmentId: createDomainId("segment", entropy),
    appId,
    commits: [commit],
    resultingFrontier: [{ deviceId: input.deviceId, commitSequence: 1n }],
    semanticSha256: segmentSemantic,
  });
  // D27's accumulated-set rule: the chain is verified over every commit this
  // app has, which at promotion is exactly one.
  await verifyCommitChain([commit], (bytes) => ports.crypto.sha256(bytes));
  const segmentRef = await sealRoot("app.events", "app.event-segment", segmentPayload);

  const headBody: Omit<AppHeadV1, "semanticSha256"> = {
    headVersion: 1,
    appId,
    headRevision: 1n,
    schemaRevision: SCHEMA_REVISION_AFTER,
    checkpoint: checkpointRef,
    eventSegments: [segmentRef],
    frontier: [{ deviceId: input.deviceId, commitSequence: 1n }],
    baselinePages: [baselineRef],
    // Explicitly empty, not omitted: this app has these roots and they hold
    // nothing (database.md § `AppHeadV1`).
    conflictPages: [],
    auditPages: [],
    sourceManifests: [sourceManifestRef],
    snapshotManifests: [snapshotManifestRef],
    retainedRoots: [],
  };
  const headSemantic = await ports.crypto.sha256(encodeAppHeadBody(headBody));
  const headStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  frames.push(
    await ports.crypto.seal({
      scope: "app.head",
      storageId: headStorageId,
      logicalRevision,
      payloadKind: "app.head",
      payload: encodeAppHead({ ...headBody, semanticSha256: headSemantic }),
      compression: "deflate-raw-v1",
      key: loaded.provisionalKey,
    }),
  );

  // --- step 3: one transaction ---------------------------------------------
  // The provisional key **becomes** the app key: nothing staged is re-encrypted
  // at the review boundary (database.md § Import staging). It moves from the
  // workflow envelope, which this transaction destroys, into the catalog
  // entry — sealed under the local root and carried as transport bytes, the
  // same shape D10 established for the recovery-code view, because M08 exposes
  // no way to read a key handle's bytes back.
  const appKeyBytes = await readProvisionalKeyBytes(
    ports,
    deps.localRoot,
    loaded.workflowStorageId,
  );
  const appKeyStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  const wrappedAppKey = serializeEnvelopeTransport(
    await ports.crypto.seal({
      scope: "local.catalog",
      storageId: appKeyStorageId,
      logicalRevision,
      payloadKind: "local.catalog",
      payload: appKeyBytes,
      compression: "none",
      key: deps.localRoot,
    }),
  );
  appKeyBytes.fill(0);

  // The fact chunks were inference's working material; they are not the app's
  // and are ticketed rather than retained. The stage payload and its workflow
  // go with them.
  const ticketStorageId = asStorageId16(entropy.randomBytes(STORAGE_ID_BYTES));
  const ticketId = encodeStorageId16(ticketStorageId);
  const temporaries = [
    ...new Set([
      loaded.stageStorageId,
      ...loaded.stage.factChunks.map((chunk) => chunk.storageId),
      ...stagedChunkStorageIds(loaded.stage).filter(
        (id) => !input.sourceChunks.some((chunk) => chunk.storageId === id),
      ),
    ]),
  ]
    .filter(
      (id) =>
        !input.sourceChunks.some((chunk) => chunk.storageId === id) &&
        !snapshotChunkRefs.some((chunk) => chunk.storageId === id),
    )
    .sort();

  frames.push(
    await deps.sealCleanupTicket({
      storageId: ticketStorageId,
      ticketId,
      storageIds: temporaries,
      logicalRevision: revision,
    }),
  );

  const sealedCatalog = await deps.commitCatalog({
    appId,
    displayName: input.acceptedName,
    accentId: accentForApp(appId),
    glyph: glyphForApp(input.acceptedName),
    createdAtEpochMs: nowMs,
    rowCount: built.records.length,
    tableCount: 1,
    wrappedAppKey,
    appHeadStorageId: encodeStorageId16(headStorageId),
    removeWorkflowStorageId: loaded.workflowStorageId,
    addCleanupTicketStorageId: ticketId,
    logicalRevision: revision,
  });
  frames.push(sealedCatalog.frame);

  const committed = await ports.store.commit({
    expectedRevision: expectation.transactionRevision,
    expectedWriterEpoch: expectation.writerEpoch,
    addFrames: frames,
    // The workflow envelope is destroyed here, exactly as cancellation does:
    // the provisional key has become the app key and is now reachable only
    // through the catalog's app entry.
    deleteStorageIds: [decodeStorageId16(loaded.workflowStorageId)],
    bootstrapPatch: { catalogStorageId: sealedCatalog.storageId },
  });
  ports.catalog.adopt(sealedCatalog.storageId, committed);

  // --- step 4: acknowledge, only now ---------------------------------------
  return {
    kind: "promoted",
    receipt: {
      appId,
      appHeadStorageId: encodeStorageId16(headStorageId),
      rowCount: built.records.length,
      tableCount: 1,
      transactionRevision: committed,
      flaggedRecordCount: built.flaggedCount,
    },
  };
}

// -------------------------------------------------------------- the events --

interface BuildEventsInputV1 {
  readonly entropy: EntropyPort;
  readonly appId: AppId;
  readonly lineageId: LineageId;
  readonly proposal: ProposedAppV1;
  readonly schema: AllocatedSchemaV1;
  readonly theme: AppThemeV1;
  readonly displayName: string;
  readonly refs: {
    readonly sourceManifestStorageId: StorageId16;
    readonly snapshotManifestStorageId: StorageId16;
    readonly checkpointManifestStorageId: StorageId16;
    readonly originalBaselineStorageId: StorageId16;
  };
  readonly sha256: (bytes: Uint8Array) => Promise<Uint8Array>;
}

async function buildImportEvents(
  input: BuildEventsInputV1,
): Promise<readonly DomainEventV1[]> {
  const { entropy, appId, schema, proposal } = input;
  const events: DomainEventV1[] = [];
  const provenance = {
    source: "initial-import" as const,
    sourceId: input.lineageId,
  };

  const push = (
    kind: DomainEventV1["kind"],
    payload: unknown,
    subject: DomainEventV1["subject"],
  ): void => {
    events.push({
      eventId: createDomainId("event", entropy),
      eventIndex: events.length,
      kind,
      subject,
      payload,
      provenance,
    });
  };

  push(
    "app.created",
    encodeImportEventPayload.appCreated({
      displayName: input.displayName,
      tables: [schema.table],
      enumOptions: schema.enumOptions,
      theme: input.theme,
      importLineageId: input.lineageId,
      schemaRevision: SCHEMA_REVISION_AFTER,
    }),
    { appId },
  );

  push(
    "table.created",
    encodeImportEventPayload.tableCreated({
      table: schema.table,
      sourceSheetId: schema.sheetId,
    }),
    { appId, tableId: schema.table.tableId },
  );

  for (const definition of schema.table.fields) {
    const proposed = proposal.table.fields.find(
      (candidate) => candidate.fieldName === definition.displayName,
    );
    push(
      "field.created",
      encodeImportEventPayload.fieldCreated({
        field: definition,
        statementId:
          proposed === undefined ? null : `field-type:${proposed.columnIndex}`,
      }),
      { appId, tableId: schema.table.tableId, fieldId: definition.fieldId },
    );
  }

  const enumFields = new Set(schema.enumOptions.map((option) => option.fieldId));
  for (const fieldId of enumFields) {
    push(
      "enum.changed",
      encodeImportEventPayload.enumChanged({
        fieldId,
        priorOptionSetSha256: null,
        options: schema.enumOptions.filter((option) =>
          compareDomainIds(option.fieldId, fieldId) === 0,
        ),
      }),
      { appId, fieldId },
    );
  }

  // Only the statements the user actually touched become decisions: an
  // accepted proposal is the default, and recording it would be noise the
  // re-import path would then have to ignore (FR-7).
  for (const statement of proposal.statements) {
    if (statement.disposition === "accepted") {
      continue;
    }
    push(
      "inference-decision.recorded",
      encodeImportEventPayload.inferenceDecision({
        // S03 owns the fingerprint *input*; M08 owns the digest. The hash is
        // taken here because this is where the two meet.
        evidenceFingerprint: await input.sha256(
          new TextEncoder().encode(statement.evidenceFingerprint),
        ),
        statement,
        disposition: statement.disposition,
      }),
      { appId },
    );
  }

  push(
    "import.accepted",
    encodeImportEventPayload.importAccepted({
      lineageId: input.lineageId,
      ...input.refs,
      proposal,
      acceptedSchemaRevision: SCHEMA_REVISION_AFTER,
    }),
    { appId },
  );

  return events;
}

/** Exported for the promotion unit suite. */
export { allocateSchema, buildRecords, paginate };
export type { AllocatedSchemaV1 };
export type { TableId, RecordId, SheetId };
