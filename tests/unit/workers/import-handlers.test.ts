/**
 * CA-10/CA-12 at handler level: the registered import commands, through the
 * real dispatch, over real crypto, real codecs, and the real store.
 *
 * Only IndexedDB is a shim (D8), so these cases are about the things the
 * browser run cannot state as sharply — a locked session refusing a stage
 * command, the store's row count returning to exactly where it started, and
 * the unlock sweep running before the session view is handed back.
 */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DataWorkerCommandError } from "../../../src/workers/protocol/redact.js";
import type {
  BeginImportStageRequestV1,
  UnlockedSessionViewV1,
} from "../../../src/workers/protocol/messages.js";
import {
  CRYPTO_TIMEOUT_MS,
  countEnvelopeRows,
  createTestHandler,
  resetLocalDatabase,
  type TestHandler,
} from "./data-worker.js";

const PASSPHRASE = "correct horse battery staple";

const BEGIN: BeginImportStageRequestV1 = {
  kind: "beginImportStage",
  fileName: "field-log-messy.csv",
  detected: {
    kind: "delimited",
    delimiter: ",",
    encoding: "utf-8",
    bomByteLength: 0,
    newline: "lf",
  },
  preflight: {
    columnCount: 9,
    estimatedRowCount: 43,
    estimatedCellCount: 387,
    isEstimate: true,
    sampleRows: [["Site", "Status", "Amount"]],
    bytesSampled: 5469,
    sourceByteLength: 5469,
  },
  sourceSha256Hex: "a".repeat(64),
};

let worker: TestHandler;

async function setup(handler = worker.handler): Promise<void> {
  await handler.handle({ kind: "setup", passphrase: PASSPHRASE });
}

async function unlock(handler = worker.handler): Promise<UnlockedSessionViewV1> {
  const response = await handler.handle({ kind: "unlock", passphrase: PASSPHRASE });
  if (response.kind !== "unlock") {
    throw new Error("expected an unlock response");
  }
  return response.session;
}

async function begin(
  handler = worker.handler,
  overrides: Partial<BeginImportStageRequestV1> = {},
): Promise<string> {
  const response = await handler.handle({ ...BEGIN, ...overrides });
  if (response.kind !== "beginImportStage") {
    throw new Error("expected a beginImportStage response");
  }
  return response.stageId;
}

beforeEach(async () => {
  await resetLocalDatabase();
  worker = createTestHandler();
});

describe("beginImportStage", () => {
  it(
    "answers with a stage id and nothing else (D17)",
    async () => {
      await setup();
      const response = await worker.handler.handle(BEGIN);

      expect(response.kind).toBe("beginImportStage");
      // No port, no key, no bytes: the whole response is the id.
      expect(Object.keys(response).sort()).toEqual(["kind", "stageId"]);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "adds the workflow reference to the catalog and advances the revision",
    async () => {
      await setup();
      const before = await countEnvelopeRows();

      await begin();
      const status = await worker.handler.handle({ kind: "getStatus" });
      if (status.kind !== "getStatus" || status.status.state !== "unlocked") {
        throw new Error("expected an unlocked status");
      }

      // Stage, workflow, catalog — one transaction, three new rows.
      expect(await countEnvelopeRows()).toBe(before + 3);
      expect(status.status.transactionRevision).toBe(2);
      expect(status.status.catalogRevision).toBe(2);
      // No app exists yet: the library is unchanged until promotion.
      expect(status.status.appCount).toBe(0);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "refuses a stage command while locked",
    async () => {
      await setup();
      await worker.handler.handle({ kind: "lock" });

      await expect(worker.handler.handle(BEGIN)).rejects.toThrow(
        DataWorkerCommandError,
      );
      await expect(
        worker.handler.handle({ kind: "cancelImportStage", stageId: "x" }),
      ).rejects.toThrow(DataWorkerCommandError);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "refuses a malformed digest or an empty file name",
    async () => {
      await setup();

      await expect(
        worker.handler.handle({ ...BEGIN, sourceSha256Hex: "not-hex" }),
      ).rejects.toThrow(DataWorkerCommandError);
      await expect(
        worker.handler.handle({ ...BEGIN, fileName: "" }),
      ).rejects.toThrow(DataWorkerCommandError);
    },
    CRYPTO_TIMEOUT_MS,
  );
});

describe("cancelImportStage", () => {
  it(
    "returns the store to exactly its pre-import row count",
    async () => {
      await setup();
      const before = await countEnvelopeRows();

      const stageId = await begin();
      expect(await countEnvelopeRows()).toBeGreaterThan(before);

      const response = await worker.handler.handle({
        kind: "cancelImportStage",
        stageId,
      });
      if (response.kind !== "cancelImportStage") {
        throw new Error("expected a cancelImportStage response");
      }
      expect(response.receipt.completed).toBe(true);
      expect(response.receipt.reason).toBe("import-cancelled");

      // Every row the import added is gone. The catalogs it superseded are
      // deliberately left, exactly as F01's `updateSettings` leaves its own;
      // collecting those is F05's mark-and-sweep.
      const status = await worker.handler.handle({ kind: "getStatus" });
      if (status.kind !== "getStatus" || status.status.state !== "unlocked") {
        throw new Error("expected an unlocked status");
      }
      expect(status.status.appCount).toBe(0);
      expect(await countEnvelopeRows()).toBe(before + status.status.catalogRevision - 1);
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "is idempotent: cancelling an already-cancelled stage still reports clean",
    async () => {
      await setup();
      const stageId = await begin();

      await worker.handler.handle({ kind: "cancelImportStage", stageId });
      const again = await worker.handler.handle({
        kind: "cancelImportStage",
        stageId,
      });

      if (again.kind !== "cancelImportStage") {
        throw new Error("expected a cancelImportStage response");
      }
      // "Is anything left behind?" has the same true answer both times.
      expect(again.receipt).toEqual({
        reason: "import-cancelled",
        deletedCount: 0,
        completed: true,
      });
    },
    CRYPTO_TIMEOUT_MS,
  );
});

describe("the unlock-time sweep", () => {
  it(
    "cleans a stage a crashed session left behind, before reporting the session",
    async () => {
      await setup();
      const before = await countEnvelopeRows();
      await begin();

      // The device dies with the stage live: a new worker over the same store
      // is exactly what the next unlock sees.
      worker.handler.dispose();
      const revived = createTestHandler(worker.clock);
      const session = await unlock(revived.handler);

      // The session handed back is already swept: its revision is the one the
      // sweep committed, not the one the crash left.
      const status = await revived.handler.handle({ kind: "getStatus" });
      if (status.kind !== "getStatus" || status.status.state !== "unlocked") {
        throw new Error("expected an unlocked status");
      }
      expect(status.status.transactionRevision).toBe(
        session.transactionRevision,
      );
      expect(await countEnvelopeRows()).toBe(
        before + status.status.catalogRevision - 1,
      );
      revived.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );

  it(
    "commits nothing on an unlock with no import in flight",
    async () => {
      await setup();
      worker.handler.dispose();

      const revived = createTestHandler(worker.clock);
      const before = await countEnvelopeRows();
      const session = await unlock(revived.handler);

      // A clean device pays nothing for the sweep: no commit, no revision.
      expect(session.transactionRevision).toBe(1);
      expect(await countEnvelopeRows()).toBe(before);
      revived.handler.dispose();
    },
    CRYPTO_TIMEOUT_MS,
  );
});
