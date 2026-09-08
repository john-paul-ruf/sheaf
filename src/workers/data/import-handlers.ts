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
import type {
  BeginImportStageRequestV1,
  CancelImportStageRequestV1,
  DataWorkerResponseV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import type { LocalCatalogV1 } from "./catalog.js";

const SHA256_HEX_LENGTH = 64;

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

const HEX = /^[0-9a-f]+$/;

function decodeSha256Hex(hex: string): Uint8Array {
  if (hex.length !== SHA256_HEX_LENGTH || !HEX.test(hex)) {
    throw new DataWorkerCommandError("malformed-request");
  }
  return Uint8Array.from(
    { length: SHA256_HEX_LENGTH / 2 },
    (_unused, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

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
    context: ImportSessionContextV1,
    request: BeginImportStageRequestV1,
  ): Promise<DataWorkerResponseV1>;
  cancelImportStage(
    context: ImportSessionContextV1,
    request: CancelImportStageRequestV1,
  ): Promise<DataWorkerResponseV1>;
  /** Runs before the library is reported, on every unlock (M23's contract). */
  sweep(context: ImportSessionContextV1): Promise<readonly CleanupReceiptV1[]>;
  /** Forgets in-memory stage bookkeeping; called on lock. */
  dispose(): void;
}

export function createImportHandlers(
  deps: ImportHandlerDependenciesV1,
): ImportHandlersV1 {
  const store = deps.store ?? envelopeStoreAdapter;
  const crypto = deps.crypto ?? envelopeCryptoAdapter;
  /** Stage id → workflow reference. Session memory only; never persisted. */
  const active = new Map<string, ActiveStageV1>();

  const portsFor = (
    catalogPort: StagingCatalogPort,
  ): StagingPortsV1 => ({ store, crypto, catalog: catalogPort, entropy: deps.entropy });

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
    if (remembered !== undefined) {
      return remembered.workflowStorageId;
    }
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
        return workflowStorageId;
      }
    }
    return undefined;
  }

  return {
    async beginImportStage(
      context: ImportSessionContextV1,
      request: BeginImportStageRequestV1,
    ): Promise<DataWorkerResponseV1> {
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
          sourceSha256: decodeSha256Hex(request.sourceSha256Hex),
          sourceByteLength: request.preflight.sourceByteLength,
          selectedSheets: [request.fileName],
        },
      );

      // The provisional key stays sealed in its workflow envelope between
      // requests; the handle is released here so a lock cannot leave one live.
      crypto.destroyKey(created.loaded.provisionalKey);
      active.set(created.loaded.stage.stageId, {
        stageId: created.loaded.stage.stageId,
        workflowStorageId: created.loaded.workflowStorageId,
      });

      return {
        kind: "beginImportStage",
        stageId: created.loaded.stage.stageId,
      };
    },

    async cancelImportStage(
      context: ImportSessionContextV1,
      request: CancelImportStageRequestV1,
    ): Promise<DataWorkerResponseV1> {
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
      return sweepStaleImports(portsFor(catalogPort), context.localRoot);
    },

    dispose(): void {
      active.clear();
    },
  };
}
