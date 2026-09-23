/**
 * The data worker's import commands (M33; CA-10/CA-12).
 *
 * This file is the composition seam: it turns the worker's session — a
 * decrypted catalog, a live local root, an open database — into the four
 * narrow ports M23 depends on, and then lets M23 drive the orders. The
 * cancellation sequence, the cleanup cursor, and the reachability argument all
 * live in `src/import/staging/`; what lives here is the wiring and the
 * translation to the wire.
 *
 * Two things stay on this side of the seam on purpose:
 *
 * - **The catalog.** Its shape and its seven checks are CA-03's, so staging
 *   only ever sees the two reference lists through `StagingCatalogPort`.
 * - **Key material.** M08's internal byte accessor is not reachable from here
 *   — `tests/unit/crypto/module-boundaries.test.ts` greps for its name across
 *   the tree, comments included. The crypto port hands out opaque handles, and
 *   the provisional key is generated, sealed, and destroyed without its bytes
 *   ever being a value this module holds.
 */

import type { StorageId16 } from "../../domain/model/bytes.js";
import { decryptEnvelope, encryptEnvelope } from "../../crypto/envelope.js";
import { sha256 } from "../../crypto/hash.js";
import { createSecretKey, destroySecretKey } from "../../crypto/keys.js";
import type { SecretKeyHandle } from "../../crypto/keys.js";
import { commitEnvelopes } from "../../persistence/envelope-store/commit.js";
import { readBootstrap } from "../../persistence/envelope-store/bootstrap.js";
import {
  getEnvelope,
  getEnvelopesByRevision,
} from "../../persistence/envelope-store/read.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type {
  EnvelopeCryptoPort,
  EnvelopeKeyRefV1,
  OpenedEnvelopeV1,
  SealEnvelopeRequestV1,
} from "../../application/ports/envelope-crypto.js";
import type {
  BootstrapSnapshotV1,
  EnvelopeStorePort,
  RevisionPageV1,
  StoreCommitRequestV1,
} from "../../application/ports/envelope-store.js";
import type {
  SealedCatalogV1,
  StagingCatalogPort,
  StagingCatalogRefsV1,
} from "../../application/ports/staging-catalog.js";
import type {
  EnvelopeFrameV1,
  EnvelopePayloadKindV1,
  EnvelopeScopeV1,
} from "../../migrations/003_envelope_format_v1.js";
import {
  cancelImportStage,
  encodeCleanupTicket,
  processCleanupTickets,
  sweepStaleImports,
  type CleanupReceiptV1,
} from "../../import/staging/cleanup.js";
import {
  promoteImport as promoteStagedImport,
  type PromotionRejectedV1,
} from "../../import/staging/promotion.js";
import {
  decodeDomainId,
  encodeDomainId,
  type AppId,
  type DeviceId,
} from "../../domain/model/ids.js";
import {
  createImportStage,
  readImportStage,
  type CreateImportStageInputV1,
  type StagingPortsV1,
} from "../../import/staging/lifecycle.js";
import type { WorkbookFormatV1 } from "../../import/facts/index.js";
import { IMPORT_BUDGET_V1 } from "../../import/preflight/budgets.js";
import type { DetectedFormatV1 } from "../../import/source/sniff.js";
import type { PreflightReportV1 } from "../../import/preflight/preflight.js";
import type { WorkbookFactStreamItemV2 } from "../../import/facts/index.js";
import { asStorageId16, decodeStorageId16, encodeStorageId16 } from "../../domain/model/bytes.js";
import {
  IMPORT_STAGE_PAYLOAD_KIND,
  IMPORT_STAGE_SCOPE,
  type ImportDestinationV1,
  type ImportStageV1,
  type StagedSheetSummaryV1,
} from "../../import/staging/stage.js";
import {
  stageWithProposal,
  stageWithReviewEdit,
  writeImportStage,
} from "../../import/staging/lifecycle.js";
import { delimitedStream } from "../../import/inference/infer.js";
import { applyRejectionMemory, type RejectionMemoryV1 } from "../../import/inference/rejection-memory.js";
import { decisionKindOf, WORKBOOK_INFERENCE_SUBJECTS } from "../../import/inference/statements.js";
import { appendTable } from "../../import/staging/append.js";
import { planInferenceDecisions } from "../../application/queries/snapshots.js";
import { projectionReferenceResolver } from "../../application/commands/execute-command.js";
import type { ProjectionInferenceDecisionV1 } from "../../application/ports/projection.js";
import { asDomainId } from "../../domain/model/ids.js";
import type { DecodedValue } from "../../persistence/codecs/canonical-cbor.js";
import type { AppSessionV1 } from "./app-session.js";
import type { LoadedAppV1 } from "./event-store.js";
import { decodeTailEventPayload, encodeRecordEventPayload } from "./record-event-payloads.js";
import { inferWorkbook } from "../../import/inference/workbook.js";
import { refreshFormulas } from "../../import/inference/formulas.js";
import { reviewFormulaIdentities } from "../../import/staging/formula-identities.js";
import type { ProposedRuleConditionV1, ProposedWorkbookV1 } from "../../import/inference/workbook-proposal.js";
import { decodeFactStreamItem, encodeFactStreamItem } from "../../import/staging/fact-codec.js";
import type { LoadedImportStageV1 } from "../../import/staging/lifecycle.js";
import {
  isStageChannelInboundV1,
  stageAck,
  stageNack,
} from "../protocol/stage-channel.js";
import type {
  ApplyReviewEditRequestV1,
  BeginImportStageRequestV1,
  PromoteImportRequestV1,
  PromoteImportResponseV1,
  CancelImportStageRequestV1,
  DataWorkerResponseV1,
  DetectedDelimitedV1,
  ImportPreflightFactsV1,
  ProposedRuleConditionWireV1,
  ProposedWorkbookWireV1,
  WorkbookSheetSummaryWireV1,
  WorkbookStageFactsV1,
  GetImportStageRequestV1,
  ImportStageViewV1,
  RunInferenceRequestV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import {
  isAppAccentIdV1,
  type LocalCatalogAppEntryV1,
  type LocalCatalogV1,
} from "./catalog.js";

/** What the composer supplies: the live session, and how to reseal a catalog. */
export interface ImportSessionContextV1 {
  readonly localRoot: SecretKeyHandle;
  readonly catalog: LocalCatalogV1;
  readonly catalogStorageId: string;
  readonly transactionRevision: number;
  readonly writerEpoch: number;
  /** Applies the committed catalog to the worker session (`session.update`). */
  adopt(next: {
    readonly catalog: LocalCatalogV1;
    readonly catalogStorageId: string;
    readonly transactionRevision: number;
  }): void;
  /** Seals a catalog under the local root; the handler owns the encoding. */
  sealCatalog(
    catalog: LocalCatalogV1,
    logicalRevision: number,
  ): Promise<SealedCatalogV1>;
}

// ------------------------------------------------------------------ adapters --

/** M11's functions, narrowed to the four operations staging may perform. */
export const envelopeStoreAdapter: EnvelopeStorePort = {
  async readBootstrap(): Promise<BootstrapSnapshotV1 | undefined> {
    const row = await readBootstrap();
    return row === undefined
      ? undefined
      : {
          transactionRevision: row.transactionRevision,
          writerEpoch: row.writerEpoch,
          catalogStorageId: row.catalogStorageId,
        };
  },
  getEnvelope(storageId: StorageId16): Promise<EnvelopeFrameV1 | undefined> {
    return getEnvelope(storageId);
  },
  commit(request: StoreCommitRequestV1): Promise<number> {
    return commitEnvelopes(request);
  },
  async listByRevision(
    revision: number,
    afterStorageId?: StorageId16,
  ): Promise<RevisionPageV1> {
    const page = await getEnvelopesByRevision(
      revision,
      afterStorageId === undefined ? {} : { afterStorageId },
    );
    return {
      frames: page.frames,
      nextAfterStorageId: page.nextCursor?.afterStorageId,
    };
  },
};

/**
 * M08's envelope functions behind the port. `importKey` is the only place a
 * provisional key's bytes become a handle, and it hands ownership to M08's
 * WeakMap immediately — after which nothing, including this file, can read
 * them back.
 */
export const envelopeCryptoAdapter: EnvelopeCryptoPort = {
  seal(request: SealEnvelopeRequestV1): Promise<EnvelopeFrameV1> {
    return encryptEnvelope({
      scope: request.scope,
      storageId: request.storageId,
      logicalRevision: request.logicalRevision,
      payloadKind: request.payloadKind,
      payload: request.payload,
      compression: request.compression,
      key: request.key as SecretKeyHandle,
    });
  },
  async open(
    frame: EnvelopeFrameV1,
    scope: EnvelopeScopeV1,
    key: EnvelopeKeyRefV1,
    expectedPayloadKind: EnvelopePayloadKindV1,
  ): Promise<OpenedEnvelopeV1> {
    const opened = await decryptEnvelope(
      frame,
      scope,
      key as SecretKeyHandle,
      expectedPayloadKind,
    );
    return { payloadKind: opened.payloadKind, payload: opened.payload };
  },
  importKey(bytes: Uint8Array): EnvelopeKeyRefV1 {
    return createSecretKey(bytes, "envelope");
  },
  destroyKey(key: EnvelopeKeyRefV1): void {
    destroySecretKey(key as SecretKeyHandle);
  },
  sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return sha256(bytes);
  },
};

/**
 * The catalog port over one live session. It holds a small amount of mutable
 * state because a multi-step order — the bounded cleanup loop — commits
 * several times and each commit must expect the revision the previous one
 * created.
 */
class SessionCatalogPort implements StagingCatalogPort {
  #catalog: LocalCatalogV1;
  #storageId: string;
  #revision: number;
  #pending: { catalog: LocalCatalogV1; storageId: string } | undefined;

  constructor(private readonly context: ImportSessionContextV1) {
    this.#catalog = context.catalog;
    this.#storageId = context.catalogStorageId;
    this.#revision = context.transactionRevision;
  }

  get catalog(): LocalCatalogV1 {
    return this.#catalog;
  }

  get catalogStorageId(): string {
    return this.#storageId;
  }

  get transactionRevision(): number {
    return this.#revision;
  }

  readRefs(): StagingCatalogRefsV1 {
    return {
      activeWorkflowStorageIds: this.#catalog.activeWorkflowStorageIds,
      cleanupTicketStorageIds: this.#catalog.cleanupTicketStorageIds,
    };
  }

  expectation(): Omit<BootstrapSnapshotV1, "catalogStorageId"> {
    return {
      transactionRevision: this.#revision,
      writerEpoch: this.context.writerEpoch,
    };
  }

  async sealWithRefs(
    refs: StagingCatalogRefsV1,
    logicalRevision: bigint,
  ): Promise<SealedCatalogV1> {
    // `catalogRevision` advances because the result is a new catalog envelope;
    // `sealCatalog` re-validates it, so staging cannot land a catalog that
    // fails CA-03's checks.
    const next: LocalCatalogV1 = {
      ...this.#catalog,
      catalogRevision: this.#catalog.catalogRevision + 1,
      activeWorkflowStorageIds: [...refs.activeWorkflowStorageIds],
      cleanupTicketStorageIds: [...refs.cleanupTicketStorageIds],
    };
    const sealed = await this.context.sealCatalog(next, Number(logicalRevision));
    this.#pending = { catalog: next, storageId: sealed.storageId };
    return sealed;
  }

  /**
   * Seals the catalog promotion needs: the new app entry added, the staging
   * workflow reference dropped, and the temporaries' cleanup ticket named —
   * one catalog, so one transaction can carry all three.
   */
  async sealWithAppEntry(input: {
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
  }): Promise<SealedCatalogV1> {
    if (!isAppAccentIdV1(input.accentId)) {
      throw new DataWorkerCommandError("internal");
    }
    const entry: LocalCatalogAppEntryV1 = {
      appId: encodeDomainId(input.appId),
      // Scratch: no durable home until F05 gives the user one (D26).
      locality: "present",
      wrappedAppKey: input.wrappedAppKey,
      appHeadStorageId: input.appHeadStorageId,
      homeId: null,
      scratchReminder: null,
      displayName: input.displayName,
      identity: { accentId: input.accentId, glyph: input.glyph },
      createdAtEpochMs: input.createdAtEpochMs,
      lastOpenedAtEpochMs: null,
      rowCountCache: input.rowCount,
      tableCount: input.tableCount,
    };

    const next: LocalCatalogV1 = {
      ...this.#catalog,
      catalogRevision: this.#catalog.catalogRevision + 1,
      apps: [...this.#catalog.apps, entry],
      activeWorkflowStorageIds: this.#catalog.activeWorkflowStorageIds.filter(
        (id) => id !== input.removeWorkflowStorageId,
      ),
      cleanupTicketStorageIds: [
        ...this.#catalog.cleanupTicketStorageIds,
        input.addCleanupTicketStorageId,
      ],
    };
    const sealed = await this.context.sealCatalog(next, input.logicalRevision);
    this.#pending = { catalog: next, storageId: sealed.storageId };
    return sealed;
  }

  /**
   * Seals the catalog an append needs: the app entry repointed at its new head
   * with its counts refreshed, the staging workflow dropped, the ticket named.
   */
  async sealWithAppendedApp(input: {
    readonly appId: AppId;
    readonly appHeadStorageId: string;
    readonly rowCount: number;
    readonly tableCount: number;
    readonly removeWorkflowStorageId: string;
    readonly addCleanupTicketStorageId: string;
    readonly logicalRevision: number;
  }): Promise<SealedCatalogV1> {
    const appId = encodeDomainId(input.appId);
    if (!this.#catalog.apps.some((entry) => entry.appId === appId)) {
      throw new DataWorkerCommandError("integrity");
    }
    const next: LocalCatalogV1 = {
      ...this.#catalog,
      catalogRevision: this.#catalog.catalogRevision + 1,
      apps: this.#catalog.apps.map((entry) =>
        entry.appId === appId
          ? { ...entry, appHeadStorageId: input.appHeadStorageId, rowCountCache: input.rowCount, tableCount: input.tableCount }
          : entry,
      ),
      activeWorkflowStorageIds: this.#catalog.activeWorkflowStorageIds.filter(
        (id) => id !== input.removeWorkflowStorageId,
      ),
      cleanupTicketStorageIds: [...this.#catalog.cleanupTicketStorageIds, input.addCleanupTicketStorageId],
    };
    const sealed = await this.context.sealCatalog(next, input.logicalRevision);
    this.#pending = { catalog: next, storageId: sealed.storageId };
    return sealed;
  }

  adopt(catalogStorageId: string, transactionRevision: number): void {
    const pending = this.#pending;
    if (pending === undefined || pending.storageId !== catalogStorageId) {
      throw new DataWorkerCommandError("internal");
    }
    this.#catalog = pending.catalog;
    this.#storageId = catalogStorageId;
    this.#revision = transactionRevision;
    this.#pending = undefined;
    this.context.adopt({
      catalog: pending.catalog,
      catalogStorageId,
      transactionRevision,
    });
  }
}

// ------------------------------------------------------------------ handlers --

/**
 * Rebuilds S03's `PreflightReportV1` from the facts the page relayed. The
 * page cannot invent `isEstimate`: the wire type and this shape both pin it to
 * the literal `true` (D24).
 */
function preflightFrom(
  request: BeginImportStageRequestV1,
  detected: DetectedDelimitedV1,
  preflight: ImportPreflightFactsV1,
): PreflightReportV1 {
  if (
    !Number.isSafeInteger(preflight.columnCount) ||
    preflight.columnCount < 0 ||
    !Number.isSafeInteger(preflight.estimatedRowCount) ||
    preflight.estimatedRowCount < 0 ||
    !Number.isSafeInteger(preflight.sourceByteLength) ||
    preflight.sourceByteLength < 0 ||
    request.fileName.length === 0
  ) {
    throw new DataWorkerCommandError("malformed-request");
  }
  return {
    fileName: request.fileName,
    sourceByteLength: preflight.sourceByteLength,
    delimiter: detected.delimiter as PreflightReportV1["delimiter"],
    encoding: detected.encoding as PreflightReportV1["encoding"],
    newline: detected.newline as PreflightReportV1["newline"],
    columnCount: preflight.columnCount,
    estimatedRowCount: preflight.estimatedRowCount,
    estimatedCellCount: preflight.estimatedCellCount,
    isEstimate: true,
    sampleRows: preflight.sampleRows.map((row) => [...row]),
    bytesSampled: preflight.bytesSampled,
  };
}

const SHEET_KINDS_WIRE: readonly WorkbookSheetSummaryWireV1["sheetKind"][] = ["worksheet", "chartsheet", "dialogsheet"];
const VISIBILITIES_WIRE: readonly WorkbookSheetSummaryWireV1["visibility"][] = ["visible", "hidden", "very-hidden"];
const WORKBOOK_FORMATS_WIRE: readonly WorkbookFormatV1[] = ["xlsx", "xlsb", "xls", "ods", "html-table"];

const isEstimate = (value: number | null): boolean => value === null || (Number.isSafeInteger(value) && value >= 0);

/**
 * The workbook inventory and selection the page relayed, checked before a
 * stage exists: every sheet well-formed and named once, the selection
 * non-empty, ascending, inventoried, and within the D31 cell budget. The
 * import worker validates the same selection again at `proceed` against the
 * report it computed itself, so a page cannot widen what is parsed.
 */
function workbookFactsFrom(
  facts: WorkbookStageFactsV1,
): { readonly inventory: readonly StagedSheetSummaryV1[]; readonly selectedSheets: readonly number[] } {
  const inventory = facts.sheets.map((sheet): StagedSheetSummaryV1 => {
    if (
      !Number.isSafeInteger(sheet.sheetIndex) ||
      sheet.sheetIndex < 0 ||
      typeof sheet.name !== "string" ||
      !SHEET_KINDS_WIRE.includes(sheet.sheetKind) ||
      !VISIBILITIES_WIRE.includes(sheet.visibility) ||
      !isEstimate(sheet.estimatedRowCount) ||
      !isEstimate(sheet.estimatedCellCount)
    ) {
      throw new DataWorkerCommandError("malformed-request");
    }
    return {
      sheetIndex: sheet.sheetIndex,
      name: sheet.name,
      sheetKind: sheet.sheetKind,
      visibility: sheet.visibility,
      estimatedRowCount: sheet.estimatedRowCount,
      estimatedCellCount: sheet.estimatedCellCount,
    };
  });
  const selected = facts.selectedSheets;
  const cells = selected.reduce(
    (sum, index) => sum + (inventory.find((sheet) => sheet.sheetIndex === index)?.estimatedCellCount ?? 0),
    0,
  );
  if (
    new Set(inventory.map((sheet) => sheet.sheetIndex)).size !== inventory.length ||
    selected.length === 0 ||
    selected.some(
      (index, position) =>
        !Number.isSafeInteger(index) ||
        (position > 0 && index <= (selected[position - 1] as number)) ||
        !inventory.some((sheet) => sheet.sheetIndex === index),
    ) ||
    cells > IMPORT_BUDGET_V1.maxEstimatedCells ||
    !Number.isSafeInteger(facts.sourceByteLength) ||
    facts.sourceByteLength < 0
  ) {
    throw new DataWorkerCommandError("malformed-request");
  }
  return { inventory, selectedSheets: [...selected] };
}

/** The container family a workbook format lives in: the stage's `detected`. */
const detectedOfWorkbook = (format: WorkbookFormatV1): DetectedFormatV1 => {
  switch (format) {
    case "xlsx":
    case "xlsb":
      return { kind: "zip-container", container: "ooxml" };
    case "ods":
      return { kind: "zip-container", container: "ods" };
    case "xls":
      return { kind: "cfb" };
    case "html-table":
      return { kind: "html-table" };
    default: {
      const unreachable: never = format;
      return unreachable;
    }
  }
};

export interface ImportHandlerDependenciesV1 {
  readonly entropy: EntropyPort;
  readonly clock: ClockPort;
  /**
   * The live unlocked session, read fresh each time. The channel receiver runs
   * *between* requests — a batch arrives when the parser sends it, not when
   * the page asks — so it cannot be handed a context captured at dispatch.
   * Throws `locked` once the session is gone, which is what stops a batch
   * committing into a worker that has zeroized its key.
   */
  readonly getContext: () => ImportSessionContextV1;
  readonly store?: EnvelopeStorePort;
  readonly crypto?: EnvelopeCryptoPort;
  /** The app tier's sessions, for an append into an existing app (D38). */
  readonly apps?: ImportAppAccessV1;
}

/** How the import tier reaches an existing app: the record tier's own sessions. */
export interface ImportAppAccessV1 {
  open(appId: string): Promise<AppSessionV1 | undefined>;
  close(appId: string): void;
}

/**
 * The proposal as the wire carries it (CA-19): S02's shape unchanged, except a
 * record rule's comparison value, which the byte-free wire restates without
 * the id-bearing members no rule can hold. A rule holding one is a defect.
 */
export function proposalWire(proposal: ProposedWorkbookV1): ProposedWorkbookWireV1 {
  const condition = (value: ProposedRuleConditionV1): ProposedRuleConditionWireV1 => {
    if (value.kind === "not") return { kind: "not", condition: condition(value.condition) };
    if (value.value.kind === "enum" || value.value.kind === "reference") {
      throw new DataWorkerCommandError("internal");
    }
    return { kind: "field-equals", columnKey: value.columnKey, value: value.value };
  };
  return {
    ...proposal,
    recordRules: proposal.recordRules.map((rule) => ({ ...rule, condition: condition(rule.condition) })),
  };
}

/**
 * A refused promotion or append, as the page receives it: every issue of the
 * report, each naming the reviewed column its field was allocated for.
 */
export function rejectedPromotionResponse(result: PromotionRejectedV1): PromoteImportResponseV1 {
  return {
    kind: "promoteImport",
    outcome: "rejected",
    reason: result.reason,
    issues: (result.report?.issues ?? []).map((issue) => {
      const fieldId = issue.fieldId === null ? null : encodeDomainId(issue.fieldId);
      return {
        fieldId,
        columnKey: fieldId === null ? null : (result.columnKeys.get(fieldId) ?? null),
        kind: issue.kind,
        severity: issue.severity,
        messageKey: issue.messageKey,
      };
    }),
  };
}

/**
 * A new app has no rejection memory, so inference never digests a
 * fingerprint here; if it tried, the empty memory would be a lie.
 */
const noRejectionMemory = (): string => {
  throw new Error("a new app has no rejection memory to match");
};

const hexOf = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** An app id from the wire; a malformed one is the request's fault. */
const appIdOf = (text: string) => {
  try {
    return decodeDomainId("app", text);
  } catch {
    throw new DataWorkerCommandError("malformed-request");
  }
};

/** One recorded decision, from the checkpoint's projection or from a tail commit. */
export interface RecordedDecisionV1 {
  readonly decisionKind: string | null;
  readonly evidenceFingerprint: Uint8Array;
  readonly disposition: string;
}

/**
 * The decisions an app's tail commits recorded after its checkpoint (an
 * append's `inference-decision.recorded`, CA-23). They reach the projection's
 * history but not its `inference_decisions` rows until a later checkpoint
 * materializes them, so rejection memory reads them from the commits.
 */
export function tailDecisionsOf(app: Pick<LoadedAppV1, "checkpoint" | "commits">): readonly RecordedDecisionV1[] {
  const covered = new Map(
    app.checkpoint.frontier.map((entry) => [encodeDomainId(asDomainId("device", entry.deviceId)), entry.commitSequence]),
  );
  const decisions: RecordedDecisionV1[] = [];
  for (const commit of app.commits) {
    if (commit.deviceCommitSequence <= (covered.get(encodeDomainId(asDomainId("device", commit.deviceId))) ?? 0n)) continue;
    for (const event of commit.events) {
      if (event.kind !== "inference-decision.recorded") continue;
      const decoded = decodeTailEventPayload(event.kind, event.payload as DecodedValue);
      if (decoded.kind !== "inference-decision.recorded") continue;
      const statement = decoded.payload.statement;
      const subject: unknown = statement instanceof Map ? (statement as ReadonlyMap<unknown, unknown>).get("subject") : undefined;
      const known = WORKBOOK_INFERENCE_SUBJECTS.find((candidate) => candidate === subject);
      decisions.push({
        decisionKind: known === undefined ? null : decisionKindOf(known),
        evidenceFingerprint: decoded.payload.evidenceFingerprint,
        disposition: decoded.payload.disposition,
      });
    }
  }
  return decisions;
}

/**
 * D44's rejection memory for an app: every **rejected** decision it holds —
 * the projection's rows (the checkpoint's) and its tail's — as
 * `${decisionKind}:${hex fingerprint}`, the key M21 matches statements by.
 */
export function rejectionMemoryOf(
  projected: readonly Pick<ProjectionInferenceDecisionV1, "decisionKind" | "evidenceFingerprint" | "disposition">[],
  tail: readonly RecordedDecisionV1[],
): RejectionMemoryV1 {
  return new Set(
    [...projected, ...tail]
      .filter((decision) => decision.disposition === "rejected" && decision.decisionKind !== null)
      .map((decision) => `${String(decision.decisionKind)}:${hexOf(decision.evidenceFingerprint)}`),
  );
}

/** Where a live stage's workflow reference is remembered between requests. */
export interface ActiveStageV1 {
  readonly stageId: string;
  readonly workflowStorageId: string;
}

export interface ImportHandlersV1 {
  beginImportStage(
    request: BeginImportStageRequestV1,
    ports: readonly MessagePort[],
  ): Promise<DataWorkerResponseV1>;
  getImportStage(
    request: GetImportStageRequestV1,
  ): Promise<DataWorkerResponseV1>;
  runInference(request: RunInferenceRequestV1): Promise<DataWorkerResponseV1>;
  promoteImport(
    request: PromoteImportRequestV1,
  ): Promise<DataWorkerResponseV1>;
  listLibrary(): Promise<DataWorkerResponseV1>;
  applyReviewEdit(
    request: ApplyReviewEditRequestV1,
  ): Promise<DataWorkerResponseV1>;
  cancelImportStage(
    request: CancelImportStageRequestV1,
  ): Promise<DataWorkerResponseV1>;
  /** Runs before the library is reported, on every unlock (M23's contract). */
  sweep(context: ImportSessionContextV1): Promise<readonly CleanupReceiptV1[]>;
  /** The facts accumulated while staging, for inference (D17). */
  accumulatedFacts(stageId: string): readonly WorkbookFactStreamItemV2[];
  /** Forgets in-memory stage bookkeeping and closes ports; called on lock. */
  dispose(): void;
}

const STORAGE_ID_BYTES = 16;

/** One live channel and the facts it has delivered so far. */
interface ChannelStateV1 {
  readonly port: MessagePort;
  facts: WorkbookFactStreamItemV2[];
  /** Serialises batches: one commit at a time, in sequence order. */
  queue: Promise<void>;
  closed: boolean;
}

export function createImportHandlers(
  deps: ImportHandlerDependenciesV1,
): ImportHandlersV1 {
  const store = deps.store ?? envelopeStoreAdapter;
  const crypto = deps.crypto ?? envelopeCryptoAdapter;
  /** Stage id → workflow reference. Session memory only; never persisted. */
  const active = new Map<string, ActiveStageV1>();
  const channels = new Map<string, ChannelStateV1>();

  const portsFor = (
    catalogPort: StagingCatalogPort,
  ): StagingPortsV1 => ({ store, crypto, catalog: catalogPort, entropy: deps.entropy });

  /**
   * The device the catalog was created with. Promotion's commit is authored by
   * this device, and its frontier names it.
   */
  const deviceIdOf = (context: ImportSessionContextV1): DeviceId =>
    decodeDomainId("device", context.catalog.deviceId);

  /**
   * Every stage rewrite moves the workflow envelope, so every writer has to
   * move the memo with it. It is one call rather than three copies because
   * forgetting it once already cost a batch: the next lookup found a storage
   * id the same transaction had just deleted.
   */
  const rememberWorkflow = (stageId: string, workflowStorageId: string): void => {
    active.set(stageId, { stageId, workflowStorageId });
  };

  /**
   * Resolves a stage id to its workflow reference, or `undefined` when no
   * live stage carries it. Session memory is the fast path; after a reload the
   * catalog's workflow list is re-read and each entry opened, because the
   * stage id lives inside the encrypted payload and nothing clear may index it
   * (the cleartext budget).
   */
  async function findWorkflow(
    context: ImportSessionContextV1,
    catalogPort: SessionCatalogPort,
    stageId: string,
  ): Promise<string | undefined> {
    const remembered = active.get(stageId);
    if (
      remembered !== undefined &&
      catalogPort
        .readRefs()
        .activeWorkflowStorageIds.includes(remembered.workflowStorageId)
    ) {
      return remembered.workflowStorageId;
    }
    // The memo was stale or absent. The catalog is authoritative, so fall
    // through to it rather than trusting session memory.
    active.delete(stageId);
    for (const workflowStorageId of catalogPort.readRefs().activeWorkflowStorageIds) {
      const loaded = await readImportStage(
        portsFor(catalogPort),
        context.localRoot,
        workflowStorageId,
      );
      if (loaded === undefined) {
        continue;
      }
      crypto.destroyKey(loaded.provisionalKey);
      if (loaded.stage.stageId === stageId) {
        rememberWorkflow(stageId, workflowStorageId);
        return workflowStorageId;
      }
    }
    return undefined;
  }

  /** Opens the stage a live id names, or `undefined` if it is gone. */
  async function loadStage(stageId: string) {
    const context = deps.getContext();
    const catalogPort = new SessionCatalogPort(context);
    const workflowStorageId = await findWorkflow(context, catalogPort, stageId);
    if (workflowStorageId === undefined) {
      return undefined;
    }
    const loaded = await readImportStage(
      portsFor(catalogPort),
      context.localRoot,
      workflowStorageId,
    );
    return loaded === undefined
      ? undefined
      : { context, catalogPort, loaded };
  }

  /**
   * The stage's facts, in order. The channel's in-memory copy serves while it
   * holds the whole stream; otherwise — after a reload, say — the staged fact
   * chunks are the authority (D17), each decrypted, checked against its
   * recorded digest, and decoded exactly (CA-17).
   */
  async function stagedFacts(
    stageId: string,
    loaded: LoadedImportStageV1,
  ): Promise<readonly WorkbookFactStreamItemV2[]> {
    const inMemory = channels.get(stageId)?.facts ?? [];
    if (inMemory.length === loaded.stage.factChunks.length && inMemory.at(-1)?.kind === "summary") {
      return inMemory;
    }
    const facts: WorkbookFactStreamItemV2[] = [];
    for (const chunk of loaded.stage.factChunks) {
      const frame = await store.getEnvelope(decodeStorageId16(chunk.storageId));
      if (frame === undefined) {
        throw new DataWorkerCommandError("integrity");
      }
      const { payload } = await crypto.open(frame, IMPORT_STAGE_SCOPE, loaded.provisionalKey, IMPORT_STAGE_PAYLOAD_KIND);
      const digest = await crypto.sha256(payload);
      if (digest.byteLength !== chunk.sha256.byteLength || digest.some((byte, index) => byte !== chunk.sha256[index])) {
        throw new DataWorkerCommandError("integrity");
      }
      facts.push(decodeFactStreamItem(payload));
    }
    return facts;
  }

  /**
   * Commits one retained source slice and only then acks it. Source chunks are
   * **retained** on promotion, unlike fact chunks: they are the original file
   * the app promises to keep (D21).
   */
  async function commitSourceChunk(
    stageId: string,
    sequence: number,
    bytes: Uint8Array,
  ): Promise<void> {
    const opened = await loadStage(stageId);
    if (opened === undefined) {
      throw new DataWorkerCommandError("integrity");
    }
    const { catalogPort, context, loaded } = opened;

    const revision = catalogPort.expectation().transactionRevision + 1;
    const storageId = asStorageId16(deps.entropy.randomBytes(STORAGE_ID_BYTES));
    const frame = await crypto.seal({
      scope: "app.source-chunk",
      storageId,
      logicalRevision: BigInt(revision),
      payloadKind: "app.source-chunk",
      payload: bytes,
      // Already-compressed or high-entropy source bytes gain nothing from a
      // second pass; the padding bucket is what hides the size either way.
      compression: "none",
      key: loaded.provisionalKey,
    });
    const chunkStorageId = encodeStorageId16(storageId);

    const next: ImportStageV1 = {
      ...loaded.stage,
      stageRevision: loaded.stage.stageRevision + 1,
      sourceChunks: [
        ...loaded.stage.sourceChunks,
        {
          storageId: chunkStorageId,
          sequence,
          decodedByteLength: bytes.byteLength,
          sha256: await crypto.sha256(bytes),
        },
      ],
      retainedStorageIds: [...loaded.stage.retainedStorageIds, chunkStorageId],
    };

    const written = await writeImportStage(
      portsFor(catalogPort),
      context.localRoot,
      loaded,
      next,
      { addFrames: [frame] },
    );
    crypto.destroyKey(loaded.provisionalKey);
    rememberWorkflow(stageId, written.loaded.workflowStorageId);
  }

  /**
   * Commits one batch and only then acks it (CA-10, invariant 1). The chunk
   * bytes are S03's own canonical mapping — `factStreamItemToCanonicalValue`
   * then `encodeCanonical` — never re-derived here, so a staged fact and a
   * parsed fact are the same bytes.
   */
  async function commitBatch(
    stageId: string,
    ackedSeq: number,
    item: WorkbookFactStreamItemV2,
  ): Promise<void> {
    const opened = await loadStage(stageId);
    if (opened === undefined) {
      throw new DataWorkerCommandError("integrity");
    }
    const { catalogPort, context, loaded } = opened;

    const revision = catalogPort.expectation().transactionRevision + 1;
    const payload = encodeFactStreamItem(item);
    const storageId = asStorageId16(deps.entropy.randomBytes(STORAGE_ID_BYTES));
    const chunkFrame = await crypto.seal({
      scope: IMPORT_STAGE_SCOPE,
      storageId,
      logicalRevision: BigInt(revision),
      payloadKind: IMPORT_STAGE_PAYLOAD_KIND,
      payload,
      compression: "deflate-raw-v1",
      key: loaded.provisionalKey,
    });
    const chunkStorageId = encodeStorageId16(storageId);

    const isSummary = item.kind === "summary";
    const rowsSoFar = isSummary
      ? item.rowCount
      : loaded.stage.progress.rowsSoFar +
        item.facts.filter((fact) => fact.kind === "row").length;

    const next: ImportStageV1 = {
      ...loaded.stage,
      stageRevision: loaded.stage.stageRevision + 1,
      factChunks: [
        ...loaded.stage.factChunks,
        {
          storageId: chunkStorageId,
          sequence: loaded.stage.factChunks.length,
          decodedByteLength: payload.byteLength,
          sha256: await crypto.sha256(payload),
        },
      ],
      // Fact chunks are inference's working material, not the app's: they are
      // ticketed at promotion, never retained (database.md § Import staging).
      temporaryStorageIds: [...loaded.stage.temporaryStorageIds, chunkStorageId],
      progress: {
        phase: isSummary ? "inferring" : "parsing",
        rowsSoFar,
        batchesCommitted: loaded.stage.progress.batchesCommitted + 1,
        ackedBatchSeq: ackedSeq,
      },
      status: isSummary ? "staged" : "staging",
    };

    const written = await writeImportStage(
      portsFor(catalogPort),
      context.localRoot,
      loaded,
      next,
      { addFrames: [chunkFrame] },
    );
    crypto.destroyKey(loaded.provisionalKey);

    rememberWorkflow(stageId, written.loaded.workflowStorageId);
  }

  /**
   * Wires a channel port to a stage. Batches are handled one at a time through
   * a promise chain: two concurrent commits would race the same optimistic
   * revision, and the parser is waiting for each ack anyway.
   */
  function attachChannel(stageId: string, port: MessagePort): void {
    const state: ChannelStateV1 = {
      port,
      facts: [],
      queue: Promise.resolve(),
      closed: false,
    };
    channels.set(stageId, state);

    port.onmessage = (event: MessageEvent<unknown>): void => {
      if (!isStageChannelInboundV1(event.data)) {
        return;
      }
      const message = event.data;
      if (message.kind === "abort") {
        // The parse ended without a summary. Nothing is synthesised: the
        // stage simply stops where its last committed batch left it, and the
        // cancel command (or the unlock sweep) collects it.
        state.closed = true;
        return;
      }

      const inbound = message;
      state.queue = state.queue.then(async () => {
        if (state.closed) {
          return;
        }
        try {
          if (inbound.kind === "source") {
            await commitSourceChunk(stageId, inbound.sequence, inbound.bytes);
          } else {
            await commitBatch(stageId, inbound.seq, inbound.batch);
            // Inference runs in this worker over the facts it accumulates
            // while staging (D17); the stage stays authoritative for what is
            // durable.
            state.facts.push(inbound.batch);
          }
          port.postMessage(stageAck(inbound.seq));
        } catch {
          // Commit-before-ack: a batch that did not land is never acked, and
          // the parser stops rather than streaming into a stage that cannot
          // hold it.
          state.closed = true;
          port.postMessage(stageNack(inbound.seq));
        }
      });
    };
  }

  function closeChannel(stageId: string): void {
    const state = channels.get(stageId);
    if (state === undefined) {
      return;
    }
    state.closed = true;
    state.port.onmessage = null;
    state.port.close();
    channels.delete(stageId);
  }

  const sealTicket =
    (context: ImportSessionContextV1) =>
    (input: { readonly storageId: StorageId16; readonly ticketId: string; readonly storageIds: readonly string[]; readonly logicalRevision: number }) =>
      crypto.seal({
        scope: "local.cleanup",
        storageId: input.storageId,
        logicalRevision: BigInt(input.logicalRevision),
        payloadKind: "local.cleanup-ticket",
        payload: encodeCleanupTicket({
          ticketVersion: 1,
          ticketId: input.ticketId,
          reason: "import-promoted",
          storageIds: [...input.storageIds].sort(),
          cursor: 0,
          createdAtRevision: input.logicalRevision,
        }),
        compression: "deflate-raw-v1",
        key: context.localRoot,
      });

  /** The open app an append stage lands in, or `null` for a new-app stage. */
  async function appendTargetOf(stage: ImportStageV1): Promise<AppSessionV1 | null> {
    if (stage.destination.kind !== "existing-app") return null;
    const session = await deps.apps?.open(encodeDomainId(stage.destination.appId as AppId));
    if (session === undefined) {
      throw new DataWorkerCommandError("integrity");
    }
    return session;
  }

  /** Applies stored rejections, with each statement's fingerprint digested by M08. */
  async function withRejectionMemory(
    proposal: ProposedWorkbookV1,
    memory: RejectionMemoryV1,
  ): Promise<ProposedWorkbookV1> {
    if (memory.size === 0) return proposal;
    const digests = new Map<string, string>();
    for (const statement of proposal.statements) {
      const digest = await crypto.sha256(new TextEncoder().encode(statement.evidenceFingerprint));
      digests.set(statement.evidenceFingerprint, hexOf(digest));
    }
    // A remembered rejection (a relationship, say) changes what a formula becomes.
    return refreshFormulas(
      applyRejectionMemory(proposal, memory, (input) => digests.get(input) ?? ""),
      reviewFormulaIdentities(deps.entropy),
    );
  }

  /**
   * The append (D38, CA-23): one import-class commit into the app, through
   * M23's `appendTable`, validated against the app's projection. The app's
   * session is dropped after the commit, so the next read hydrates the new
   * table from the tail (S03's tail apply).
   */
  async function appendIntoApp(
    stageId: string,
    context: ImportSessionContextV1,
    catalogPort: SessionCatalogPort,
    loaded: LoadedImportStageV1,
    facts: readonly WorkbookFactStreamItemV2[],
  ): Promise<DataWorkerResponseV1> {
    let session: AppSessionV1 | null;
    try {
      session = await appendTargetOf(loaded.stage);
    } catch (cause) {
      crypto.destroyKey(loaded.provisionalKey);
      throw cause;
    }
    if (session === null) {
      crypto.destroyKey(loaded.provisionalKey);
      throw new DataWorkerCommandError("internal");
    }
    const { projection, repository } = session;
    const app = repository.loaded();
    const chain = repository.chainState();
    const tables = projection
      .execute({ kind: "list-tables" })
      .map((table) => ({ ...table, fields: projection.execute({ kind: "list-fields", tableId: table.tableId }) }));
    const appIdText = encodeDomainId(session.appId);
    const entry = context.catalog.apps.find((candidate) => candidate.appId === appIdText);

    const result = await appendTable(
      {
        ports: portsFor(catalogPort),
        clock: deps.clock,
        encodeRecordCreated: (record, importedInvalid) =>
          encodeRecordEventPayload({ kind: "record.created", payload: { record, importedInvalid } }),
        commitCatalog: (input) => catalogPort.sealWithAppendedApp(input),
        sealCleanupTicket: sealTicket(context),
      },
      {
        loaded,
        facts,
        deviceId: deviceIdOf(context),
        target: {
          appId: session.appId,
          appKey: session.appKey,
          head: app.head,
          headStorageId: app.headStorageId,
          chain: {
            deviceCommitSequence: chain.deviceCommitSequence,
            lastCommitSha256: chain.lastCommitSha256,
            lastHybridTime: chain.lastHybridTime,
            frontier: chain.frontier,
            commits: app.commits,
          },
          tables,
          enumOptions: tables.flatMap((table) =>
            table.fields
              .filter((field) => field.type.kind === "enum")
              .flatMap((field) => projection.execute({ kind: "list-enum-options", fieldId: field.fieldId })),
          ),
          relationships: projection.execute({ kind: "list-relationships", tableId: null }).map((row) => row.relationship),
          sheetCount: projection.execute({ kind: "list-sheet-snapshots" }).length,
          referenceExists: projectionReferenceResolver(projection),
          rowCountBefore:
            entry?.rowCountCache ??
            tables.reduce((sum, table) => sum + projection.execute({ kind: "count-records", tableId: table.tableId }), 0),
        },
      },
    );

    if (result.kind === "rejected") {
      // Nothing was written: the app and the stage are exactly as they were.
      crypto.destroyKey(loaded.provisionalKey);
      return rejectedPromotionResponse(result);
    }

    crypto.destroyKey(loaded.provisionalKey);
    // The session's head is the one this commit superseded.
    deps.apps?.close(appIdText);
    closeChannel(stageId);
    active.delete(stageId);
    await processCleanupTickets(portsFor(catalogPort), context.localRoot);
    return {
      kind: "promoteImport",
      outcome: "promoted",
      appId: appIdText,
      rowCount: result.receipt.rowCount,
      tableCount: 1,
      flaggedRecordCount: result.receipt.flaggedRecordCount,
    };
  }

  return {
    async beginImportStage(
      request: BeginImportStageRequestV1,
      ports: readonly MessagePort[],
    ): Promise<DataWorkerResponseV1> {
      const context = deps.getContext();
      if (request.fileName.length === 0) {
        throw new DataWorkerCommandError("malformed-request");
      }
      const { detected, preflight } = request;
      const requested = request.destination ?? { kind: "new-app" };
      let destination: ImportDestinationV1 = { kind: "new-app" };
      if (requested.kind === "existing-app") {
        // FR-1's into-existing path is value-only (D38): a delimited file, into
        // an app this catalog holds.
        if (detected.kind !== "delimited" || !context.catalog.apps.some((app) => app.appId === requested.appId)) {
          throw new DataWorkerCommandError("malformed-request");
        }
        destination = { kind: "existing-app", appId: appIdOf(requested.appId) };
      }
      let input: CreateImportStageInputV1;
      if (detected.kind === "workbook") {
        if (!("kind" in preflight) || !WORKBOOK_FORMATS_WIRE.includes(detected.format)) {
          throw new DataWorkerCommandError("malformed-request");
        }
        const { inventory, selectedSheets } = workbookFactsFrom(preflight);
        input = {
          fileName: request.fileName,
          format: detected.format,
          destination: { kind: "new-app" },
          detected: detectedOfWorkbook(detected.format),
          contradiction: null,
          preflight: null,
          inventory,
          sourceByteLength: preflight.sourceByteLength,
          selectedSheets,
        };
      } else {
        if ("kind" in preflight) {
          throw new DataWorkerCommandError("malformed-request");
        }
        input = {
          fileName: request.fileName,
          format: "delimited",
          destination,
          detected: {
            kind: "delimited",
            delimiter: detected.delimiter as "," | "\t" | ";" | "|",
            encoding: detected.encoding as PreflightReportV1["encoding"],
            bomByteLength: detected.bomByteLength,
            newline: detected.newline as PreflightReportV1["newline"],
          },
          contradiction: null,
          preflight: preflightFrom(request, detected, preflight),
          inventory: null,
          sourceByteLength: preflight.sourceByteLength,
          selectedSheets: [0],
        };
      }
      const catalogPort = new SessionCatalogPort(context);
      const created = await createImportStage(portsFor(catalogPort), context.localRoot, input);

      // The provisional key stays sealed in its workflow envelope between
      // requests; the handle is released here so a lock cannot leave one live.
      crypto.destroyKey(created.loaded.provisionalKey);
      const stageId = created.loaded.stage.stageId;
      rememberWorkflow(stageId, created.loaded.workflowStorageId);

      // `port2` arrived in this request's transfer list (D17). A response
      // never carries one back, so this is the only moment a port crosses.
      const [port] = ports;
      if (port !== undefined) {
        attachChannel(stageId, port);
      }

      return { kind: "beginImportStage", stageId };
    },

    async getImportStage(
      request: GetImportStageRequestV1,
    ): Promise<DataWorkerResponseV1> {
      const opened = await loadStage(request.stageId);
      if (opened === undefined) {
        // Truthfully absent rather than an error: a swept or cancelled stage
        // is gone, and "gone" is the answer the surface needs.
        return { kind: "getImportStage", stage: null };
      }
      crypto.destroyKey(opened.loaded.provisionalKey);
      const stage = opened.loaded.stage;
      const view: ImportStageViewV1 = {
        stageId: stage.stageId,
        fileName: stage.fileName,
        status: stage.status,
        phase: stage.progress.phase,
        rowsSoFar: stage.progress.rowsSoFar,
        batchesCommitted: stage.progress.batchesCommitted,
        ackedBatchSeq: stage.progress.ackedBatchSeq,
        factChunkCount: stage.factChunks.length,
        hasProposal: stage.proposal !== null,
      };
      return { kind: "getImportStage", stage: view };
    },

    /**
     * Inference runs **here**, in the data worker, over the facts accumulated
     * while staging (D17) — never in the page, which has never seen a fact.
     * The proposal is written into the stage before it is returned, so the
     * stage is authoritative from the first moment the page can render it.
     */
    async runInference(
      request: RunInferenceRequestV1,
    ): Promise<DataWorkerResponseV1> {
      const opened = await loadStage(request.stageId);
      if (opened === undefined) {
        throw new DataWorkerCommandError("integrity");
      }
      const { context, catalogPort, loaded } = opened;

      if (loaded.stage.proposal !== null) {
        // Already inferred. Re-running would discard the user's edits, so the
        // staged proposal — edits and all — is what comes back.
        crypto.destroyKey(loaded.provisionalKey);
        return { kind: "runInference", proposal: proposalWire(loaded.stage.proposal) };
      }

      let proposal: ProposedWorkbookV1;
      try {
        const facts = await stagedFacts(request.stageId, loaded);
        const stage = loaded.stage;
        // One path for every format (CA-19): a delimited stream reaches S02's
        // single-table case without its one sheet fact, so its proposal,
        // statements and fingerprints are F02's. `inferWorkbook` throws on a
        // summary-less stream by design: a cancelled parse has nothing exact
        // to propose from, and nothing here synthesises a summary.
        const target = await appendTargetOf(stage);
        proposal = inferWorkbook(stage.format === "delimited" ? delimitedStream(facts) : facts, {
          fileName: stage.fileName,
          // Every inventoried sheet, selected or not: the unselected ones are
          // listed as excluded and never read (D39).
          sheetSelection:
            stage.inventory === null
              ? null
              : stage.inventory.map((sheet) => ({
                  sheetIndex: sheet.sheetIndex,
                  name: sheet.name,
                  sheetKind: sheet.sheetKind,
                  visibility: sheet.visibility,
                  isSelected: stage.selectedSheets.includes(sheet.sheetIndex),
                })),
          // Memory is applied below, once its digests are known (M08 is async).
          rejectionMemory: new Set(),
          fingerprintOf: noRejectionMemory,
          formulaIdentities: reviewFormulaIdentities(deps.entropy),
          // An append's new table is named apart from the app's own (D38).
          existingApp:
            target === null
              ? null
              : { tableNames: target.projection.execute({ kind: "list-tables" }).map((table) => table.displayName) },
        });
        if (target !== null) {
          // D44's production consumer: the target app's own decisions.
          proposal = await withRejectionMemory(
            proposal,
            rejectionMemoryOf(
              planInferenceDecisions(target.projection, null),
              tailDecisionsOf(target.repository.loaded()),
            ),
          );
        }
      } catch {
        crypto.destroyKey(loaded.provisionalKey);
        throw new DataWorkerCommandError("integrity");
      }

      const written = await writeImportStage(
        portsFor(catalogPort),
        context.localRoot,
        loaded,
        stageWithProposal(loaded.stage, proposal),
      );
      crypto.destroyKey(loaded.provisionalKey);
      rememberWorkflow(request.stageId, written.loaded.workflowStorageId);

      return { kind: "runInference", proposal: proposalWire(proposal) };
    },

    /**
     * Applies one edit to the staged proposal. A rejection is relayed as a
     * typed result and writes nothing (CA-16, D23) — the stage never coerces
     * an impossible edit into one that applied.
     */
    async applyReviewEdit(
      request: ApplyReviewEditRequestV1,
    ): Promise<DataWorkerResponseV1> {
      const opened = await loadStage(request.stageId);
      if (opened === undefined) {
        throw new DataWorkerCommandError("integrity");
      }
      const { context, catalogPort, loaded } = opened;

      const result = stageWithReviewEdit(loaded.stage, request.edit, reviewFormulaIdentities(deps.entropy));
      if (result.kind === "rejected" || result.stage === undefined) {
        crypto.destroyKey(loaded.provisionalKey);
        return {
          kind: "applyReviewEdit",
          outcome: "rejected",
          reason:
            result.kind === "rejected" ? result.reason : "unknown-table",
        };
      }

      const written = await writeImportStage(
        portsFor(catalogPort),
        context.localRoot,
        loaded,
        result.stage,
      );
      crypto.destroyKey(loaded.provisionalKey);
      rememberWorkflow(request.stageId, written.loaded.workflowStorageId);

      return {
        kind: "applyReviewEdit",
        outcome: "applied",
        proposal: proposalWire(result.proposal),
      };
    },

    /**
     * Promotion, and the cleanup that follows it. The four-step order lives in
     * M23; what happens here is the composition — the catalog surgery, the app
     * key wrap, and the ticket drain that finishes the temporaries the same
     * cancellation would have collected.
     */
    async promoteImport(
      request: PromoteImportRequestV1,
    ): Promise<DataWorkerResponseV1> {
      const name = request.acceptedName.trim();
      if (name.length === 0) {
        throw new DataWorkerCommandError("malformed-request");
      }
      const opened = await loadStage(request.stageId);
      if (opened === undefined) {
        throw new DataWorkerCommandError("integrity");
      }
      const { context, catalogPort, loaded } = opened;
      let facts: readonly WorkbookFactStreamItemV2[];
      try {
        facts = await stagedFacts(request.stageId, loaded);
      } catch {
        crypto.destroyKey(loaded.provisionalKey);
        throw new DataWorkerCommandError("integrity");
      }
      if (loaded.stage.destination.kind === "existing-app") {
        return appendIntoApp(request.stageId, context, catalogPort, loaded, facts);
      }

      const result = await promoteStagedImport(
        {
          ports: portsFor(catalogPort),
          clock: deps.clock,
          localRoot: context.localRoot,
          commitCatalog: (input) => catalogPort.sealWithAppEntry(input),
          sealCleanupTicket: sealTicket(context),
        },
        {
          loaded,
          facts,
          sourceChunks: loaded.stage.sourceChunks.map((chunk) => ({
            storageId: chunk.storageId,
            sequence: chunk.sequence,
            decodedByteLength: chunk.decodedByteLength,
            sha256: chunk.sha256,
          })),
          acceptedName: name,
          deviceId: deviceIdOf(context),
        },
      );

      if (result.kind === "rejected") {
        // Nothing was written, so the stage is exactly as it was and the user
        // can fix the review and try again (D23).
        crypto.destroyKey(loaded.provisionalKey);
        return rejectedPromotionResponse(result);
      }

      // The provisional key *became* the app key; the handle is released here
      // because the durable copy now lives wrapped in the catalog entry.
      crypto.destroyKey(loaded.provisionalKey);
      closeChannel(request.stageId);
      active.delete(request.stageId);

      // Step 3 ticketed the temporaries; finish them before answering, so the
      // receipt the surface renders is true rather than pending.
      await processCleanupTickets(portsFor(catalogPort), context.localRoot);

      return {
        kind: "promoteImport",
        outcome: "promoted",
        appId: encodeDomainId(result.receipt.appId),
        rowCount: result.receipt.rowCount,
        tableCount: result.receipt.tableCount,
        flaggedRecordCount: result.receipt.flaggedRecordCount,
      };
    },

    listLibrary(): Promise<DataWorkerResponseV1> {
      const context = deps.getContext();
      return Promise.resolve({
        kind: "listLibrary",
        apps: context.catalog.apps.map((app) => ({
          appId: app.appId,
          displayName: app.displayName,
          accentId: app.identity.accentId,
          glyph: app.identity.glyph,
          createdAtEpochMs: app.createdAtEpochMs,
          lastOpenedAtEpochMs: app.lastOpenedAtEpochMs,
          rowCountCache: app.rowCountCache,
          tableCount: app.tableCount,
          // No home means scratch — the persistent fact the tile states
          // truthfully until F05 gives the user somewhere to put it (D26).
          isScratch: app.homeId === null,
        })),
      });
    },

    async cancelImportStage(
      request: CancelImportStageRequestV1,
    ): Promise<DataWorkerResponseV1> {
      const context = deps.getContext();
      closeChannel(request.stageId);
      const catalogPort = new SessionCatalogPort(context);
      const workflowStorageId = await findWorkflow(
        context,
        catalogPort,
        request.stageId,
      );

      if (workflowStorageId === undefined) {
        // Cancelling is **idempotent**, like every other step of the cleanup
        // order: an unlock sweep may already have abandoned this stage, and
        // the question the page is asking — "is anything left behind?" — has
        // the same true answer either way. Refusing here would make the
        // cancel control fail precisely when the cleanup had succeeded.
        active.delete(request.stageId);
        return {
          kind: "cancelImportStage",
          receipt: { reason: "import-cancelled", deletedCount: 0, completed: true },
        };
      }

      const receipt = await cancelImportStage(
        portsFor(catalogPort),
        context.localRoot,
        { workflowStorageId, reason: "import-cancelled" },
      );
      active.delete(request.stageId);

      return {
        kind: "cancelImportStage",
        receipt: {
          reason: receipt.reason,
          deletedCount: receipt.deletedCount,
          completed: true,
        },
      };
    },

    async sweep(
      context: ImportSessionContextV1,
    ): Promise<readonly CleanupReceiptV1[]> {
      const catalogPort = new SessionCatalogPort(context);
      const refs = catalogPort.readRefs();
      if (
        refs.activeWorkflowStorageIds.length === 0 &&
        refs.cleanupTicketStorageIds.length === 0
      ) {
        return [];
      }
      active.clear();
      for (const stageId of [...channels.keys()]) {
        closeChannel(stageId);
      }
      return sweepStaleImports(portsFor(catalogPort), context.localRoot);
    },

    accumulatedFacts(stageId: string): readonly WorkbookFactStreamItemV2[] {
      return channels.get(stageId)?.facts ?? [];
    },

    dispose(): void {
      for (const stageId of [...channels.keys()]) {
        closeChannel(stageId);
      }
      active.clear();
    },
  };
}
