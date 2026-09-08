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
  }
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
