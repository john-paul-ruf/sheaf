/**
 * Cleartext budget (database.md § Cleartext Budget) and the CA-05 negative leg.
 *
 * What is stored in the clear is exactly migration 001's declared field set —
 * no kind, no owner, no name, no count, no timestamp, and above all no
 * failed-attempt counter (D4/CA-05: the unlock delay is session memory only,
 * and no API of this module can persist one).
 *
 * The expected field lists are `Record<keyof …, true>` maps, so a schema field
 * that appears without this test being updated fails to compile rather than
 * silently widening the budget.
 */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  Argon2idDescriptorV1,
  LocalBootstrapRowV1,
  LocalEnvelopeRowV1,
  RecoveryKdfDescriptorV1,
  WrappedLocalRootV1,
} from "../../../src/migrations/001_local_store_v1.js";
import { createBootstrap } from "../../../src/persistence/envelope-store/bootstrap.js";
import { commitEnvelopes } from "../../../src/persistence/envelope-store/commit.js";
import { openLocalDatabase } from "../../../src/persistence/envelope-store/db.js";
import {
  bootstrapRow,
  opaqueFrame,
  resetLocalDatabase,
  storageIdText,
} from "./local-store.js";

const fields = <T,>(declared: Record<keyof T, true>): string[] =>
  Object.keys(declared).sort();

const BOOTSTRAP_FIELDS = fields<LocalBootstrapRowV1>({
  slot: true,
  databaseFormatVersion: true,
  minimumReaderVersion: true,
  codecVersion: true,
  envelopeFormatVersion: true,
  cipherSuiteVersion: true,
  paddingProfileVersion: true,
  transactionRevision: true,
  writerEpoch: true,
  passphraseKdf: true,
  recoveryKdf: true,
  passphraseWrappedRoot: true,
  recoveryWrappedRoot: true,
  catalogStorageId: true,
  migrationStorageId: true,
});

const ENVELOPE_FIELDS = fields<LocalEnvelopeRowV1>({
  storageId: true,
  revision: true,
  envelopeFormatVersion: true,
  codecVersion: true,
  cipherSuiteVersion: true,
  paddedBytes: true,
  nonce: true,
  ciphertext: true,
});

const ARGON2ID_FIELDS = fields<Argon2idDescriptorV1>({
  algorithm: true,
  algorithmVersion: true,
  salt: true,
  memoryKiB: true,
  iterations: true,
  lanes: true,
  outputBytes: true,
  context: true,
});

const RECOVERY_KDF_FIELDS = fields<RecoveryKdfDescriptorV1>({
  algorithm: true,
  salt: true,
  outputBytes: true,
  context: true,
});

const WRAPPER_FIELDS = fields<WrappedLocalRootV1>({
  wrapId: true,
  nonce: true,
  ciphertext: true,
});

const readStoredRows = async () => {
  const database = await openLocalDatabase();
  return {
    bootstrap: await database.bootstrap.toArray(),
    envelopes: await database.envelopes.toArray(),
  };
};

beforeEach(async () => {
  await resetLocalDatabase();
  await createBootstrap(bootstrapRow(), [opaqueFrame(11, 1n)]);
  await commitEnvelopes({
    expectedRevision: 1,
    expectedWriterEpoch: 0,
    addFrames: [opaqueFrame(12, 2n)],
    bootstrapPatch: { catalogStorageId: storageIdText(12) },
  });
});

describe("cleartext budget", () => {
  it("stores exactly migration 001's declared fields and nothing else", async () => {
    const { bootstrap, envelopes } = await readStoredRows();

    expect(bootstrap).toHaveLength(1);
    expect(Object.keys(bootstrap[0]!).sort()).toEqual(BOOTSTRAP_FIELDS);
    expect(Object.keys(bootstrap[0]!.passphraseKdf).sort()).toEqual(ARGON2ID_FIELDS);
    expect(Object.keys(bootstrap[0]!.recoveryKdf).sort()).toEqual(RECOVERY_KDF_FIELDS);
    expect(Object.keys(bootstrap[0]!.passphraseWrappedRoot).sort()).toEqual(
      WRAPPER_FIELDS,
    );
    expect(Object.keys(bootstrap[0]!.recoveryWrappedRoot).sort()).toEqual(
      WRAPPER_FIELDS,
    );

    expect(envelopes).toHaveLength(2);
    for (const row of envelopes) {
      expect(Object.keys(row).sort()).toEqual(ENVELOPE_FIELDS);
    }
  });

  it("names nothing semantic and stores no free-form text", async () => {
    const stored = await readStoredRows();

    const keys: string[] = [];
    const texts: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") {
        texts.push(value);
      } else if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value !== null && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.push(key);
          walk(nested);
        }
      }
    };
    walk(stored);

    const forbidden =
      /attempt|counter|failed|lockout|delay|kind|owner|name|title|count|time|opened|provider|scope/i;
    for (const key of keys) {
      expect(key, `store declares "${key}"`).not.toMatch(forbidden);
    }

    // Every clear string is a declared constant or a canonical 22-character
    // storage ID: no label, filename, or free-form value survives here.
    const declared =
      /^(root|argon2id|hkdf-sha-256|sheaf\/local\/(passphrase|recovery)\/v1|[A-Za-z0-9_-]{22})$/;
    expect(texts.length).toBeGreaterThan(8);
    for (const text of texts) {
      expect(text).toMatch(declared);
    }
  });

  it("persists no attempt counter after rejected writes (CA-05)", async () => {
    const before = await readStoredRows();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await expect(
        commitEnvelopes({
          expectedRevision: 1,
          expectedWriterEpoch: 0,
          addFrames: [opaqueFrame(50 + attempt, 2n)],
        }),
      ).rejects.toThrow();
    }

    expect(await readStoredRows()).toEqual(before);
  });
});
