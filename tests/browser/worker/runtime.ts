/**
 * Shared page-side plumbing for the worker browser suites.
 *
 * Every helper drives the *production* path: S01's harness page loads
 * `src/bootstrap/app-bootstrap.ts` from built output, `startApp()` constructs
 * the real `DataWorkerClient`, and that spawns the real
 * `src/workers/data.worker.ts`. Nothing here mocks a boundary; the store
 * readers below go straight to IndexedDB so assertions do not travel through
 * the code they are checking.
 */

import type { Page } from "@playwright/test";
import type {
  DataWorkerErrorV1,
  DataWorkerRequestV1,
  DataWorkerResponseV1,
} from "../../../src/workers/protocol/messages.js";
import type { AppRuntime } from "../../../src/bootstrap/app-bootstrap.js";
import type { ImportWorkerEventV1 } from "../../../src/workers/protocol/import-messages.js";

export const PASSPHRASE = "correct horse battery staple";
export const BOOTSTRAP_MODULE = "/src/bootstrap/app-bootstrap.ts";
export const RECOVERY_CODE_PATTERN =
  /^[0-9A-HJKMNP-TV-Z]{7}(-[0-9A-HJKMNP-TV-Z]{7}){7}$/;

/** Migration 001's declared clear fields — the whole cleartext budget. */
export const BOOTSTRAP_FIELDS = [
  "slot",
  "databaseFormatVersion",
  "minimumReaderVersion",
  "codecVersion",
  "envelopeFormatVersion",
  "cipherSuiteVersion",
  "paddingProfileVersion",
  "transactionRevision",
  "writerEpoch",
  "passphraseKdf",
  "recoveryKdf",
  "passphraseWrappedRoot",
  "recoveryWrappedRoot",
  "catalogStorageId",
  "migrationStorageId",
].sort();

export const ENVELOPE_FIELDS = [
  "storageId",
  "revision",
  "envelopeFormatVersion",
  "codecVersion",
  "cipherSuiteVersion",
  "paddedBytes",
  "nonce",
  "ciphertext",
].sort();

declare global {
  interface Window {
    __sheafApp?: AppRuntime;
    /** A workbook fixture, delivered node-side; see `installFixture`. */
    __sheafFixture?: File;
    /** The live import run, so a spec can drive and observe it. */
    __sheafImport?: ImportRun;
  }
}

/** What a spec can see of one import run, accumulated in the page. */
export interface ImportRun {
  readonly events: ImportWorkerEventV1[];
  /** Every `batchesAcked` value seen, in order — the backpressure trace. */
  readonly ackTrace: number[];
  stageId: string | null;
  cancel(): void;
  dispose(): void;
}

export type Outcome =
  | { readonly ok: true; readonly response: DataWorkerResponseV1 }
  | { readonly ok: false; readonly error: DataWorkerErrorV1 };

export interface EnvelopeDigest {
  readonly storageId: string;
  readonly revision: number;
  readonly ciphertextSha256: string;
}

export interface StoreState {
  readonly exists: boolean;
  readonly bootstrapFields: readonly string[];
  readonly transactionRevision: number | null;
  readonly catalogStorageId: string | null;
  readonly passphraseSaltSha256: string | null;
  readonly passphraseWrapId: string | null;
  readonly envelopeFields: readonly string[];
  readonly envelopes: readonly EnvelopeDigest[];
}

/** Starts the real page-side runtime and leaves it on `window` for later calls. */
export async function start(page: Page): Promise<readonly string[]> {
  return page.evaluate(async (specifier) => {
    const bootstrap = await window.__sheafHarness.module<
      typeof import("../../../src/bootstrap/app-bootstrap.js")
    >(specifier);

    const result = bootstrap.startApp();
    if (result.kind !== "ready") {
      throw new Error(`unsupported runtime: ${result.missing.join(", ")}`);
    }
    window.__sheafApp = result.app;
    return result.report.entries
      .filter((entry) => !entry.detected)
      .map((entry) => entry.id);
  }, BOOTSTRAP_MODULE);
}

/** One RPC round trip through the real worker; refusals come back as data. */
export async function command(
  page: Page,
  request: DataWorkerRequestV1,
): Promise<Outcome> {
  return page.evaluate(async (message): Promise<Outcome> => {
    const app = window.__sheafApp;
    if (app === undefined) {
      throw new Error("startApp() has not run in this page");
    }
    try {
      return { ok: true, response: await app.client.send(message) };
    } catch (cause) {
      const error = (cause as { error?: DataWorkerErrorV1 }).error;
      return { ok: false, error: error ?? { kind: "internal" } };
    }
  }, request);
}

/** Reads the database directly, so assertions do not go through the store. */
export async function readStore(page: Page): Promise<StoreState> {
  return page.evaluate(async (): Promise<StoreState> => {
    const databases = await indexedDB.databases();
    if (!databases.some((entry) => entry.name === "sheaf-local")) {
      return {
        exists: false,
        bootstrapFields: [],
        transactionRevision: null,
        catalogStorageId: null,
        passphraseSaltSha256: null,
        passphraseWrapId: null,
        envelopeFields: [],
        envelopes: [],
      };
    }

    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("sheaf-local");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("cannot open sheaf-local"));
      });
    const all = <T>(store: IDBObjectStore): Promise<T[]> =>
      new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(new Error("cannot read store"));
      });
    const sha256 = async (buffer: ArrayBuffer): Promise<string> =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

    const database = await open();
    const transaction = database.transaction(["bootstrap", "envelopes"], "readonly");
    const bootstrapRows = await all<Record<string, unknown>>(
      transaction.objectStore("bootstrap"),
    );
    const envelopeRows = await all<Record<string, unknown>>(
      transaction.objectStore("envelopes"),
    );
    database.close();

    const row = bootstrapRows[0];
    const kdf = row?.["passphraseKdf"] as { salt: ArrayBuffer } | undefined;
    const wrapped = row?.["passphraseWrappedRoot"] as
      | { wrapId: string }
      | undefined;

    return {
      exists: row !== undefined,
      bootstrapFields: Object.keys(row ?? {}).sort(),
      transactionRevision: (row?.["transactionRevision"] as number) ?? null,
      catalogStorageId: (row?.["catalogStorageId"] as string) ?? null,
      passphraseSaltSha256:
        kdf === undefined ? null : await sha256(kdf.salt),
      passphraseWrapId: wrapped?.wrapId ?? null,
      envelopeFields: [
        ...new Set(envelopeRows.flatMap((envelope) => Object.keys(envelope))),
      ].sort(),
      envelopes: await Promise.all(
        envelopeRows.map(async (envelope) => ({
          storageId: envelope["storageId"] as string,
          revision: envelope["revision"] as number,
          ciphertextSha256: await sha256(envelope["ciphertext"] as ArrayBuffer),
        })),
      ),
    };
  });
}

// --- fixture delivery (PC-09) -----------------------------------------------

/**
 * Workbook fixtures live on disk, and `vite preview` serves only `dist/` while
 * the harness resolves only `/src/**` — so a fixture cannot be fetched from
 * the page. It is read node-side and handed across as a plain number array;
 * Playwright's `page.evaluate` serializes that faithfully, where a `Uint8Array`
 * argument is not guaranteed to survive the round trip.
 *
 * The page turns it back into a `File`, which is what the production picker
 * would have produced — so the import worker receives exactly the type it does
 * in the real flow. S05 reuses this pair.
 */
export async function fixtureBytes(
  relativePath: string,
): Promise<readonly number[]> {
  const { readFile } = await import("node:fs/promises");
  return [...new Uint8Array(await readFile(`tests/fixtures/workbooks/${relativePath}`))];
}

/** Installs a fixture as `window.__sheafFixture`, ready to be picked. */
export async function installFixture(
  page: Page,
  relativePath: string,
  fileName: string,
): Promise<number> {
  const bytes = await fixtureBytes(relativePath);
  return page.evaluate(
    ([content, name]) => {
      const data = Uint8Array.from(content);
      window.__sheafFixture = new File([data], name, { type: "text/csv" });
      return data.byteLength;
    },
    [bytes, fileName] as [readonly number[], string],
  );
}

/**
 * Builds a delimited file in the page, for cases that need *volume* rather
 * than fidelity — many batches, so backpressure and mid-parse cancellation
 * have somewhere to happen. The corpus in `tests/fixtures/workbooks/` is S03's
 * and stays untouched; its files are small by design.
 */
export async function installSyntheticFixture(
  page: Page,
  options: { readonly rows: number; readonly fileName?: string },
): Promise<number> {
  return page.evaluate((settings) => {
    const lines = ["Site,Status,Amount,Recorded,Contact"];
    for (let row = 0; row < settings.rows; row += 1) {
      lines.push(
        `Site ${row % 7},${row % 2 === 0 ? "Open" : "Closed"},${row}.50,2026-01-0${(row % 9) + 1},row${row}@example.test`,
      );
    }
    const data = new TextEncoder().encode(`${lines.join("\n")}\n`);
    window.__sheafFixture = new File([data], settings.fileName ?? "bulk.csv", {
      type: "text/csv",
    });
    return data.byteLength;
  }, options);
}

/**
 * Drives one whole import run from the page, exactly as the M36 machine will:
 * the page creates the `MessageChannel`, hands `port1` to the real import
 * worker with `startImport` and `port2` to the real data worker with
 * `beginImportStage`, then says `proceed`. Nothing here parses, encrypts, or
 * touches a fact — that is the point of the shape.
 *
 * Returns once the run reaches a terminal event, or on timeout.
 */
export async function runImport(
  page: Page,
  options: { readonly cancelAfterBatches?: number; readonly timeoutMs?: number } = {},
): Promise<{
  readonly events: readonly ImportWorkerEventV1[];
  readonly ackTrace: readonly number[];
  readonly stageId: string | null;
}> {
  return page.evaluate(async (settings) => {
    const app = window.__sheafApp;
    const file = window.__sheafFixture;
    if (app === undefined || file === undefined) {
      throw new Error("the runtime or the fixture is missing");
    }

    const spawn = await window.__sheafHarness.module<
      typeof import("../../../src/bootstrap/import-worker.js")
    >("/src/bootstrap/import-worker.ts");
    const client = spawn.createImportWorkerClient();

    const events: ImportWorkerEventV1[] = [];
    const ackTrace: number[] = [];
    let stageId: string | null = null;

    // The page owns the channel. It never reads from either port.
    const channel = new MessageChannel();

    const terminal = new Promise<void>((resolve) => {
      client.on((event) => {
        events.push(event);
        if (event.kind === "progress") {
          ackTrace.push(event.batchesAcked);
          if (
            settings.cancelAfterBatches !== undefined &&
            event.batchesAcked >= settings.cancelAfterBatches
          ) {
            client.send({ kind: "cancelImport" });
          }
        }
        if (
          event.kind === "refused" ||
          event.kind === "completed" ||
          event.kind === "cancelled" ||
          event.kind === "failed"
        ) {
          resolve();
        }
        if (event.kind === "preflight") {
          void (async () => {
            const response = await app.client.send(
              {
                kind: "beginImportStage",
                fileName: file.name,
                detected: {
                  kind: "delimited",
                  delimiter:
                    event.detected.kind === "delimited"
                      ? event.detected.delimiter
                      : ",",
                  encoding:
                    event.detected.kind === "delimited"
                      ? event.detected.encoding
                      : "utf-8",
                  bomByteLength:
                    event.detected.kind === "delimited"
                      ? event.detected.bomByteLength
                      : 0,
                  newline:
                    event.detected.kind === "delimited"
                      ? event.detected.newline
                      : "lf",
                },
                preflight: {
                  columnCount: event.report.columnCount,
                  estimatedRowCount: event.report.estimatedRowCount,
                  estimatedCellCount: event.report.estimatedCellCount,
                  isEstimate: true,
                  sampleRows: event.report.sampleRows.map((row) => [...row]),
                  bytesSampled: event.report.bytesSampled,
                  sourceByteLength: event.report.sourceByteLength,
                },
              },
              // `port2` rides the transfer list. No response returns a port.
              [channel.port2],
            );
            if (response.kind !== "beginImportStage") {
              throw new Error("beginImportStage did not answer");
            }
            stageId = response.stageId;
            client.send({ kind: "proceed", stageId: response.stageId });
          })();
        }
      });
    });

    client.send({ kind: "startImport", file, fileName: file.name }, [
      channel.port1,
    ]);

    await Promise.race([
      terminal,
      new Promise<void>((resolve) =>
        setTimeout(resolve, settings.timeoutMs ?? 60_000),
      ),
    ]);
    client.dispose();

    return { events, ackTrace, stageId };
  }, options);
}

/** Ends the runtime and deletes the origin's database between tests. */
export async function teardown(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.__sheafApp?.dispose();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("sheaf-local");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}
