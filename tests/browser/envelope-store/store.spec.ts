/**
 * CA-01 / CAP-01 proof against real IndexedDB in a real browser.
 *
 * fake-indexeddb carries the unit suites (D8); this file is the authority for
 * IndexedDB semantics — transaction abort, key uniqueness, structured-clone
 * fidelity of stored bytes across a close/reopen, and BroadcastChannel between
 * two pages. Modules are loaded from built output through S01's harness
 * (D11/F-01): the production entry does not import the store yet, so
 * `/harness.html` is the only reachable entry.
 *
 * Real boundaries here: the built module graph, the browser's IndexedDB, its
 * BroadcastChannel, and libsodium's real AEAD. Nothing is mocked.
 */

import { expect, test, type Page } from "@playwright/test";

const KEY_HEX = "4349935439c4b2328581f32aab04bc304fe8c10a31d2b57bf9be51685ee51e6a";
const NONCE_HEX = "1f2e3d4c5b6a798807162534435261708f9eadbccbdaefe0";
const CATALOG_ID_HEX = "946df764e699ff8546e074b1cedb7c68";
const CATALOG_ID_BASE64URL = "lG33ZOaZ_4VG4HSxztt8aA";
const PAYLOAD_HEX = "a16474657374706c6f63616c2e636174616c6f6702";

const STORE_SPECIFIERS = [
  "/src/persistence/envelope-store/bootstrap.ts",
  "/src/persistence/envelope-store/commit.ts",
  "/src/persistence/envelope-store/db.ts",
  "/src/persistence/envelope-store/frame-row.ts",
  "/src/persistence/envelope-store/read.ts",
  "/src/persistence/envelope-store/reset.ts",
  "/src/persistence/envelope-store/revision-signal.ts",
];

declare global {
  interface Window {
    __sheafRevisionNotices?: number[];
  }
}

interface SetupInput {
  readonly keyHex: string;
  readonly nonceHex: string;
  readonly catalogIdHex: string;
  readonly payloadHex: string;
}

interface CommitInput {
  readonly keyHex: string;
  readonly expectedRevision: number;
  readonly idHexes: readonly string[];
}

type CommitOutcome =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly message: string };

interface StoreState {
  readonly revision: number | null;
  readonly catalogStorageId: string | null;
  readonly envelopeIds: readonly string[];
}

/** Runs in the page: purges, then writes a bootstrap plus one sealed catalog. */
async function setupStore(input: SetupInput): Promise<string> {
  const hex = (text: string): Uint8Array =>
    Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));
  const buffer = (length: number, fill: number): ArrayBuffer => {
    const target = new ArrayBuffer(length);
    new Uint8Array(target).fill(fill);
    return target;
  };

  const harness = window.__sheafHarness;
  const [keys, envelope, bytes, bootstrap, reset] = await Promise.all([
    harness.module<typeof import("../../../src/crypto/keys.js")>(
      "/src/crypto/keys.ts",
    ),
    harness.module<typeof import("../../../src/crypto/envelope.js")>(
      "/src/crypto/envelope.ts",
    ),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>(
      "/src/domain/model/bytes.ts",
    ),
    harness.module<typeof import("../../../src/persistence/envelope-store/bootstrap.js")>(
      "/src/persistence/envelope-store/bootstrap.ts",
    ),
    harness.module<typeof import("../../../src/persistence/envelope-store/reset.js")>(
      "/src/persistence/envelope-store/reset.ts",
    ),
  ]);

  await reset.purgeLocalStore();

  const storageId = bytes.asStorageId16(hex(input.catalogIdHex));
  const frame = await envelope.encryptEnvelope({
    scope: "local.catalog",
    storageId,
    logicalRevision: 1n,
    payloadKind: "local.catalog",
    payload: hex(input.payloadHex),
    compression: "none",
    key: keys.createSecretKey(hex(input.keyHex), "envelope"),
    nonce: hex(input.nonceHex),
  });

  const catalogStorageId = bytes.encodeStorageId16(storageId);
  await bootstrap.createBootstrap(
    {
      slot: "root",
      databaseFormatVersion: 1,
      minimumReaderVersion: 1,
      codecVersion: 1,
      envelopeFormatVersion: 1,
      cipherSuiteVersion: 1,
      paddingProfileVersion: 1,
      transactionRevision: 1,
      writerEpoch: 0,
      passphraseKdf: {
        algorithm: "argon2id",
        algorithmVersion: 0x13,
        salt: buffer(16, 1),
        memoryKiB: 65_536,
        iterations: 3,
        lanes: 1,
        outputBytes: 32,
        context: "sheaf/local/passphrase/v1",
      },
      recoveryKdf: {
        algorithm: "hkdf-sha-256",
        salt: buffer(16, 2),
        outputBytes: 32,
        context: "sheaf/local/recovery/v1",
      },
      passphraseWrappedRoot: {
        wrapId: catalogStorageId,
        nonce: buffer(24, 3),
        ciphertext: buffer(48, 4),
      },
      recoveryWrappedRoot: {
        wrapId: catalogStorageId,
        nonce: buffer(24, 5),
        ciphertext: buffer(48, 6),
      },
      catalogStorageId,
      migrationStorageId: null,
    },
    [frame],
  );

  return catalogStorageId;
}

/**
 * Runs in the page: seals one envelope per id at the revision this commit
 * lands on. Failures come back as a message rather than an exception so a
 * rejection can be asserted without a second page-side helper.
 */
async function commitFrames(input: CommitInput): Promise<CommitOutcome> {
  const hex = (text: string): Uint8Array =>
    Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

  const harness = window.__sheafHarness;
  const [keys, envelope, bytes, commit] = await Promise.all([
    harness.module<typeof import("../../../src/crypto/keys.js")>(
      "/src/crypto/keys.ts",
    ),
    harness.module<typeof import("../../../src/crypto/envelope.js")>(
      "/src/crypto/envelope.ts",
    ),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>(
      "/src/domain/model/bytes.ts",
    ),
    harness.module<typeof import("../../../src/persistence/envelope-store/commit.js")>(
      "/src/persistence/envelope-store/commit.ts",
    ),
  ]);

  const revision = input.expectedRevision + 1;
  const frames = await Promise.all(
    input.idHexes.map((idHex) =>
      envelope.encryptEnvelope({
        scope: "local.catalog",
        storageId: bytes.asStorageId16(hex(idHex)),
        logicalRevision: BigInt(revision),
        payloadKind: "local.catalog",
        payload: hex(idHex),
        compression: "none",
        key: keys.createSecretKey(hex(input.keyHex), "envelope"),
      }),
    ),
  );

  try {
    return {
      ok: true,
      revision: await commit.commitEnvelopes({
        expectedRevision: input.expectedRevision,
        expectedWriterEpoch: 0,
        addFrames: frames,
        bootstrapPatch: {
          catalogStorageId: bytes.encodeStorageId16(
            bytes.asStorageId16(hex(input.idHexes[0] ?? "")),
          ),
        },
      }),
    };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "unknown" };
  }
}

/** Runs in the page: what a fresh reader sees, after closing the connection. */
async function readState(): Promise<StoreState> {
  const harness = window.__sheafHarness;
  const [db, bootstrap, read, bytes] = await Promise.all([
    harness.module<typeof import("../../../src/persistence/envelope-store/db.js")>(
      "/src/persistence/envelope-store/db.ts",
    ),
    harness.module<typeof import("../../../src/persistence/envelope-store/bootstrap.js")>(
      "/src/persistence/envelope-store/bootstrap.ts",
    ),
    harness.module<typeof import("../../../src/persistence/envelope-store/read.js")>(
      "/src/persistence/envelope-store/read.ts",
    ),
    harness.module<typeof import("../../../src/domain/model/bytes.js")>(
      "/src/domain/model/bytes.ts",
    ),
  ]);

  db.closeLocalDatabase();
  const row = await bootstrap.readBootstrap();
  const envelopeIds: string[] = [];
  for (let revision = 1; revision <= (row?.transactionRevision ?? 0); revision += 1) {
    const page = await read.getEnvelopesByRevision(revision);
    for (const frame of page.frames) {
      envelopeIds.push(bytes.encodeStorageId16(bytes.asStorageId16(frame.storageId)));
    }
  }

  return {
    revision: row?.transactionRevision ?? null,
    catalogStorageId: row?.catalogStorageId ?? null,
    envelopeIds,
  };
}

const setup = (page: Page): Promise<string> =>
  page.evaluate(setupStore, {
    keyHex: KEY_HEX,
    nonceHex: NONCE_HEX,
    catalogIdHex: CATALOG_ID_HEX,
    payloadHex: PAYLOAD_HEX,
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const reset = await window.__sheafHarness.module<
      typeof import("../../../src/persistence/envelope-store/reset.js")
    >("/src/persistence/envelope-store/reset.ts");
    await reset.purgeLocalStore();
  });
});

test("reaches every store module from built output", async ({ page }) => {
  const modules = await page.evaluate(() => window.__sheafHarness.listModules());
  for (const specifier of STORE_SPECIFIERS) {
    expect(modules).toContain(specifier);
  }
});

test("CA-01: reopening after close reads identical bytes and decrypts", async ({
  page,
}) => {
  const catalogStorageId = await setup(page);

  const reopened = await page.evaluate(
    async (input) => {
      const hex = (text: string): Uint8Array =>
        Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));
      const toHex = (bytes: Uint8Array): string =>
        [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

      const harness = window.__sheafHarness;
      const [keys, envelope, bytes, db, read] = await Promise.all([
        harness.module<typeof import("../../../src/crypto/keys.js")>(
          "/src/crypto/keys.ts",
        ),
        harness.module<typeof import("../../../src/crypto/envelope.js")>(
          "/src/crypto/envelope.ts",
        ),
        harness.module<typeof import("../../../src/domain/model/bytes.js")>(
          "/src/domain/model/bytes.ts",
        ),
        harness.module<typeof import("../../../src/persistence/envelope-store/db.js")>(
          "/src/persistence/envelope-store/db.ts",
        ),
        harness.module<typeof import("../../../src/persistence/envelope-store/read.js")>(
          "/src/persistence/envelope-store/read.ts",
        ),
      ]);

      // Close the connection first: what comes back must come from IndexedDB,
      // not from a live handle's memory.
      db.closeLocalDatabase();
      const frame = await read.getEnvelope(bytes.decodeStorageId16(input.catalogStorageId));
      if (frame === undefined) {
        throw new Error("catalog envelope missing after reopen");
      }

      const opened = await envelope.decryptEnvelope(
        frame,
        "local.catalog",
        keys.createSecretKey(hex(input.keyHex), "envelope"),
        "local.catalog",
      );

      return {
        nonceHex: toHex(frame.nonce),
        logicalRevision: String(frame.logicalRevision),
        paddedBytes: frame.paddedBytes,
        ciphertextLength: frame.ciphertext.byteLength,
        payloadHex: toHex(opened.payload),
      };
    },
    { catalogStorageId, keyHex: KEY_HEX },
  );

  expect(reopened.nonceHex).toBe(NONCE_HEX);
  expect(reopened.logicalRevision).toBe("1");
  expect(reopened.paddedBytes).toBe(4_096);
  expect(reopened.ciphertextLength).toBe(4_096);
  expect(reopened.payloadHex).toBe(PAYLOAD_HEX);
});

test("CA-01: a colliding storage id aborts the whole transaction", async ({
  page,
}) => {
  await setup(page);

  const outcome = await page.evaluate(commitFrames, {
    keyHex: KEY_HEX,
    expectedRevision: 1,
    idHexes: ["1111111111111111111111111111111f", CATALOG_ID_HEX],
  });

  expect(outcome).toEqual({
    ok: false,
    message: "envelope storage id already exists",
  });

  // Neither the first envelope of the failed batch nor the bootstrap patch
  // survived: one transaction, all or nothing.
  const state = await page.evaluate(readState);
  expect(state.revision).toBe(1);
  expect(state.catalogStorageId).toBe(CATALOG_ID_BASE64URL);
  expect(state.envelopeIds).toEqual([CATALOG_ID_BASE64URL]);
});

test("CA-01: every commit raises the revision by exactly one", async ({ page }) => {
  await setup(page);

  const first = await page.evaluate(commitFrames, {
    keyHex: KEY_HEX,
    expectedRevision: 1,
    idHexes: ["2222222222222222222222222222222f"],
  });
  expect(first).toEqual({ ok: true, revision: 2 });

  const second = await page.evaluate(commitFrames, {
    keyHex: KEY_HEX,
    expectedRevision: 2,
    idHexes: [
      "3333333333333333333333333333333f",
      "4444444444444444444444444444444f",
    ],
  });
  expect(second).toEqual({ ok: true, revision: 3 });

  const state = await page.evaluate(readState);
  expect(state.revision).toBe(3);
  expect(state.envelopeIds).toHaveLength(4);

  const stale = await page.evaluate(commitFrames, {
    keyHex: KEY_HEX,
    expectedRevision: 1,
    idHexes: ["5555555555555555555555555555555f"],
  });
  expect(stale).toEqual({
    ok: false,
    message: "local store moved on since the caller read the bootstrap row",
  });
  expect((await page.evaluate(readState)).revision).toBe(3);
});

test("notifies a second page of a committed revision", async ({ page, context }) => {
  await setup(page);

  const listener = await context.newPage();
  await listener.goto("/harness.html");
  await listener.evaluate(async () => {
    const signal = await window.__sheafHarness.module<
      typeof import("../../../src/persistence/envelope-store/revision-signal.js")
    >("/src/persistence/envelope-store/revision-signal.ts");
    window.__sheafRevisionNotices = [];
    signal.subscribeRevision((revision) => {
      window.__sheafRevisionNotices?.push(revision);
    });
  });

  await page.evaluate(commitFrames, {
    keyHex: KEY_HEX,
    expectedRevision: 1,
    idHexes: ["6666666666666666666666666666666f"],
  });

  await expect
    .poll(() => listener.evaluate(() => window.__sheafRevisionNotices ?? []))
    .toEqual([2]);

  await listener.close();
});
