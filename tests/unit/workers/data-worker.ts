/**
 * Shared setup for the data-worker handler suites.
 *
 * `fake-indexeddb/auto` installs the shim before Dexie is evaluated (D8); the
 * real-IndexedDB authority stays `tests/browser/worker/`. Argon2id is real in
 * these tests — it is the thing under test at the unlock boundary — so
 * calibration is pinned to the v1 floor and every case that derives a key
 * carries a longer timeout.
 */

import "fake-indexeddb/auto";
import { ARGON2ID_FLOOR } from "../../../src/crypto/kdf.js";
import { deriveWrappingKeyFromPassphrase } from "../../../src/crypto/kdf.js";
import { destroySecretKey, unwrapRoot } from "../../../src/crypto/keys.js";
import { decryptEnvelope } from "../../../src/crypto/envelope.js";
import { readBootstrap } from "../../../src/persistence/envelope-store/bootstrap.js";
import { getEnvelope } from "../../../src/persistence/envelope-store/read.js";
import { decodeStorageId16 } from "../../../src/domain/model/bytes.js";
import { decodeLocalCatalog } from "../../../src/workers/data/catalog.js";
import type { ClockPort } from "../../../src/application/ports/clock.js";
import type { EntropyPort } from "../../../src/application/ports/entropy.js";
import {
  closeLocalDatabase,
  openLocalDatabase,
} from "../../../src/persistence/envelope-store/db.js";
import {
  createDataWorkerHandler,
  type DataWorkerCommandHandler,
  type DataWorkerDependencies,
} from "../../../src/workers/data/handlers.js";
import type { SchemaCommitLimitsV1 } from "../../../src/application/commands/schema-commands.js";
import { MAX_SLICE_BYTES } from "../../../src/import/source/source.js";
import type { DataWorkerRequestV1, DataWorkerResponseV1 } from "../../../src/workers/protocol/messages.js";
import {
  isStageChannelOutboundV1,
  stageBatch,
  stageSource,
  type StageChannelInboundV1,
} from "../../../src/workers/protocol/stage-channel.js";
import { DEMO_LIVE_STRUCTURE_STATEMENTS } from "../../fixtures/workbooks/ooxml/demo-counts.js";
import { fixtureBytes } from "../import/fixtures.js";
import { streamWorkbookFixture } from "../staging/workbook-streams.js";

/** A derivation plus a commit; generous, and still far under a hang. */
export const CRYPTO_TIMEOUT_MS = 60_000;

export class FakeClock implements ClockPort {
  #epochMs: number;

  constructor(epochMs = 1_700_000_000_000) {
    this.#epochMs = epochMs;
  }

  nowEpochMs(): number {
    return this.#epochMs;
  }

  advance(ms: number): void {
    this.#epochMs += ms;
  }
}

export const realEntropy: EntropyPort = {
  randomBytes: (byteLength: number) =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
};

/** Calibration that cannot climb: the floor is both the start and the ceiling. */
const PINNED_CALIBRATION = {
  probe: (): Promise<void> => Promise.resolve(),
  maxMemoryKiB: ARGON2ID_FLOOR.memoryKiB,
  maxIterations: ARGON2ID_FLOOR.iterations,
};

export interface TestHandler {
  readonly handler: DataWorkerCommandHandler;
  readonly clock: FakeClock;
}

/** A worker's worth of state. A second call models a fresh worker. */
export function createTestHandler(
  clock: FakeClock = new FakeClock(),
  schemaCommitLimits?: SchemaCommitLimitsV1,
  compaction?: DataWorkerDependencies["compaction"],
): TestHandler {
  return {
    clock,
    handler: createDataWorkerHandler({
      clock,
      entropy: realEntropy,
      calibration: PINNED_CALIBRATION,
      ...(schemaCommitLimits === undefined ? {} : { schemaCommitLimits }),
      ...(compaction === undefined ? {} : { compaction }),
    }),
  };
}

/** One request that must succeed, narrowed to the response it names. */
export async function ask<K extends DataWorkerRequestV1["kind"]>(
  handler: DataWorkerCommandHandler,
  request: Extract<DataWorkerRequestV1, { kind: K }>,
  ports?: readonly MessagePort[],
): Promise<Extract<DataWorkerResponseV1, { kind: K }>> {
  const response = await handler.handle(request, ports);
  if (response.kind !== request.kind) {
    throw new Error(`${request.kind} answered ${response.kind}`);
  }
  return response as Extract<DataWorkerResponseV1, { kind: K }>;
}

/** Posts one channel message and waits for the data worker's durable ack. */
function sendAcked(port: MessagePort, message: StageChannelInboundV1, seq: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (!isStageChannelOutboundV1(event.data)) return;
      port.removeEventListener("message", onMessage);
      if (event.data.kind === "ack" && event.data.ackSeq === seq) resolve();
      else reject(new Error(`batch ${seq} was not acked`));
    };
    port.addEventListener("message", onMessage);
    port.postMessage(message);
  });
}

/**
 * The F03 demo workbook (`ooxml/fieldwork-q3.xlsx`) imported through the
 * **real** data-worker handler, in node: the adapter's real fact stream is
 * played over a real `MessageChannel` exactly as the import worker plays it
 * (facts, then the source slices, each acked after its commit), then
 * inference, the journey's review edit (Visits → Jobs rejected), and
 * promotion. The handler must be unlocked. Returns the new app's id.
 */
export async function importDemoApp(handler: DataWorkerCommandHandler): Promise<string> {
  const selection = [0, 1, 2, 3, 4, 5];
  const stream = await streamWorkbookFixture("ooxml/fieldwork-q3.xlsx", { selection });
  if (stream === null) throw new Error("the demo workbook did not size");
  const bytes = await fixtureBytes("ooxml/fieldwork-q3.xlsx");
  const channel = new MessageChannel();
  const begun = await ask(
    handler,
    {
      kind: "beginImportStage",
      fileName: "fieldwork-q3.xlsx",
      detected: { kind: "workbook", format: stream.report.format },
      preflight: {
        kind: "workbook",
        sheets: stream.report.sheets.map((sheet) => ({
          sheetIndex: sheet.sheetIndex,
          name: sheet.name,
          sheetKind: sheet.kind,
          visibility: sheet.visibility,
          estimatedRowCount: sheet.estimatedRowCount,
          estimatedCellCount: sheet.estimatedCellCount,
        })),
        selectedSheets: selection,
        sourceByteLength: bytes.byteLength,
        isEstimate: true,
      },
    },
    [channel.port2],
  );
  const port = channel.port1;
  port.start();
  let seq = 0;
  for (const item of stream.items) {
    await sendAcked(port, stageBatch(seq, item), seq);
    seq += 1;
  }
  for (let offset = 0, sequence = 0; offset < bytes.byteLength; offset += MAX_SLICE_BYTES, sequence += 1) {
    await sendAcked(port, stageSource(seq, sequence, bytes.subarray(offset, offset + MAX_SLICE_BYTES)), seq);
    seq += 1;
  }
  port.close();

  await ask(handler, { kind: "runInference", stageId: begun.stageId });
  const edited = await ask(handler, {
    kind: "applyReviewEdit",
    stageId: begun.stageId,
    edit: { kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" },
  });
  if (edited.outcome !== "applied") throw new Error("the review edit did not apply");
  for (const statementId of DEMO_LIVE_STRUCTURE_STATEMENTS) {
    const rejected = await ask(handler, { kind: "applyReviewEdit", stageId: begun.stageId, edit: { kind: "reject-statement", statementId } });
    if (rejected.outcome !== "applied") throw new Error(`rejecting ${statementId} did not apply`);
  }
  const promoted = await ask(handler, { kind: "promoteImport", stageId: begun.stageId, acceptedName: "Fieldwork Q3" });
  if (promoted.outcome !== "promoted") throw new Error(`promotion refused: ${promoted.reason}`);
  return promoted.appId;
}

export async function resetLocalDatabase(): Promise<void> {
  const database = await openLocalDatabase();
  await database.delete({ disableAutoOpen: true });
  closeLocalDatabase();
}

/** Reads the clear bootstrap row straight from IndexedDB, bypassing the store. */
export async function readClearBootstrapRow(): Promise<
  Record<string, unknown> | undefined
> {
  const database = await openLocalDatabase();
  const row: unknown = await database.table("bootstrap").get("root");
  return row as Record<string, unknown> | undefined;
}

export async function countEnvelopeRows(): Promise<number> {
  const database = await openLocalDatabase();
  return database.table("envelopes").count();
}

/** Independent reopen of the committed catalog; no live handler state is read. */
export async function readStoredCatalog(passphrase: string) {
  const row = await readBootstrap();
  if (row === undefined) throw new Error("missing bootstrap");
  const wrappingKey = await deriveWrappingKeyFromPassphrase(passphrase, row.passphraseKdf);
  try {
    const root = await unwrapRoot(row.passphraseWrappedRoot, wrappingKey);
    try {
      const frame = await getEnvelope(decodeStorageId16(row.catalogStorageId));
      if (frame === undefined) throw new Error("missing catalog");
      return decodeLocalCatalog((await decryptEnvelope(frame, "local.catalog", root, "local.catalog")).payload);
    } finally { destroySecretKey(root); }
  } finally { destroySecretKey(wrappingKey); }
}
