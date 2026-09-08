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
  sweepStaleImports,
  type CleanupReceiptV1,
} from "../../import/staging/cleanup.js";
import {
  createImportStage,
  readImportStage,
  type StagingPortsV1,
} from "../../import/staging/lifecycle.js";
import type { PreflightReportV1 } from "../../import/preflight/preflight.js";
import {
  factStreamItemToCanonicalValue,
  type WorkbookFactStreamItemV1,
} from "../../import/formats/delimited/facts.js";
import { encodeCanonical } from "../../persistence/codecs/canonical-cbor.js";
import { asStorageId16, encodeStorageId16 } from "../../domain/model/bytes.js";
import {
  IMPORT_STAGE_PAYLOAD_KIND,
  IMPORT_STAGE_SCOPE,
  type ImportStageV1,
} from "../../import/staging/stage.js";
import {
  stageWithProposal,
  stageWithReviewEdit,
  writeImportStage,
} from "../../import/staging/lifecycle.js";
import { inferProposal } from "../../import/inference/infer.js";
import {
  isStageChannelInboundV1,
  stageAck,
  stageNack,
} from "../protocol/stage-channel.js";
import type {
  ApplyReviewEditRequestV1,
  BeginImportStageRequestV1,
  CancelImportStageRequestV1,
  DataWorkerResponseV1,
  GetImportStageRequestV1,
  ImportStageViewV1,
  RunInferenceRequestV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import type { LocalCatalogV1 } from "./catalog.js";

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
): PreflightReportV1 {
  const { preflight, detected } = request;
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

export interface ImportHandlerDependenciesV1 {
  readonly entropy: EntropyPort;
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
  applyReviewEdit(
    request: ApplyReviewEditRequestV1,
  ): Promise<DataWorkerResponseV1>;
  cancelImportStage(
    request: CancelImportStageRequestV1,
  ): Promise<DataWorkerResponseV1>;
  /** Runs before the library is reported, on every unlock (M23's contract). */
  sweep(context: ImportSessionContextV1): Promise<readonly CleanupReceiptV1[]>;
  /** The facts accumulated while staging, for inference (D17). */
  accumulatedFacts(stageId: string): readonly WorkbookFactStreamItemV1[];
  /** Forgets in-memory stage bookkeeping and closes ports; called on lock. */
  dispose(): void;
}

const STORAGE_ID_BYTES = 16;

/** One live channel and the facts it has delivered so far. */
interface ChannelStateV1 {
  readonly port: MessagePort;
  facts: WorkbookFactStreamItemV1[];
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
   * Commits one batch and only then acks it (CA-10, invariant 1). The chunk
   * bytes are S03's own canonical mapping — `factStreamItemToCanonicalValue`
   * then `encodeCanonical` — never re-derived here, so a staged fact and a
   * parsed fact are the same bytes.
   */
  async function commitBatch(
    stageId: string,
    seq: number,
    item: WorkbookFactStreamItemV1,
  ): Promise<void> {
    const opened = await loadStage(stageId);
    if (opened === undefined) {
      throw new DataWorkerCommandError("integrity");
    }
    const { catalogPort, context, loaded } = opened;

    const revision = catalogPort.expectation().transactionRevision + 1;
    const payload = encodeCanonical(factStreamItemToCanonicalValue(item));
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
        ackedBatchSeq: seq,
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

      const { seq, batch } = message;
      state.queue = state.queue.then(async () => {
        if (state.closed) {
          return;
        }
        try {
          await commitBatch(stageId, seq, batch);
          // Inference runs in this worker over the facts it accumulates while
          // staging (D17); the stage stays authoritative for what is durable.
          state.facts.push(batch);
          port.postMessage(stageAck(seq));
        } catch {
          // Commit-before-ack: a batch that did not land is never acked, and
          // the parser stops rather than streaming into a stage that cannot
          // hold it.
          state.closed = true;
          port.postMessage(stageNack(seq));
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

  return {
    async beginImportStage(
      request: BeginImportStageRequestV1,
      ports: readonly MessagePort[],
    ): Promise<DataWorkerResponseV1> {
      const context = deps.getContext();
      if (request.detected.kind !== "delimited") {
        // Every other format is refused before a stage exists (FR-2): there is
        // nothing to clean up because nothing was created.
        throw new DataWorkerCommandError("malformed-request");
      }
      const catalogPort = new SessionCatalogPort(context);
      const created = await createImportStage(
        portsFor(catalogPort),
        context.localRoot,
        {
          fileName: request.fileName,
          detected: {
            kind: "delimited",
            delimiter: request.detected.delimiter as "," | "\t" | ";" | "|",
            encoding: request.detected
              .encoding as PreflightReportV1["encoding"],
            bomByteLength: request.detected.bomByteLength,
            newline: request.detected.newline as PreflightReportV1["newline"],
          },
          contradiction: null,
          preflight: preflightFrom(request),
          sourceByteLength: request.preflight.sourceByteLength,
          selectedSheets: [request.fileName],
        },
      );

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
        return { kind: "runInference", proposal: loaded.stage.proposal };
      }

      const facts = channels.get(request.stageId)?.facts ?? [];
      let proposal;
      try {
        // `inferProposal` throws on a summary-less stream by design (S03): a
        // cancelled parse has nothing exact to propose from, and nothing here
        // synthesises a summary to make it answer.
        proposal = inferProposal(facts, { fileName: loaded.stage.fileName });
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

      return { kind: "runInference", proposal };
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

      const result = stageWithReviewEdit(loaded.stage, request.edit);
      if (result.kind === "rejected" || result.stage === undefined) {
        crypto.destroyKey(loaded.provisionalKey);
        return {
          kind: "applyReviewEdit",
          outcome: "rejected",
          reason:
            result.kind === "rejected" ? result.reason : "unknown-column",
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
        proposal: result.proposal,
      };
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

    accumulatedFacts(stageId: string): readonly WorkbookFactStreamItemV1[] {
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
