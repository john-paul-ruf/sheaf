/** CA-01: add-once creation and passphrase-change field discipline. */

// First import: Dexie reads its IndexedDB dependency when a database is
// constructed, so the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBootstrap,
  readBootstrap,
  updateForPassphraseChange,
} from "../../../src/persistence/envelope-store/bootstrap.js";
import { getEnvelope } from "../../../src/persistence/envelope-store/read.js";
import {
  BootstrapExistsError,
  EnvelopeExistsError,
  RevisionConflictError,
} from "../../../src/persistence/envelope-store/errors.js";
import {
  bootstrapRow,
  opaqueFrame,
  passphraseKdf,
  resetLocalDatabase,
  storageId,
  storageIdText,
  wrappedRoot,
} from "./local-store.js";

beforeEach(resetLocalDatabase);

describe("createBootstrap", () => {
  it("writes the row and the envelopes it already points at", async () => {
    const catalog = opaqueFrame(11, 1n);
    await createBootstrap(bootstrapRow({ catalogStorageId: storageIdText(11) }), [
      catalog,
    ]);

    const stored = await readBootstrap();
    expect(stored?.transactionRevision).toBe(1);
    expect(stored?.catalogStorageId).toBe(storageIdText(11));
    expect((await getEnvelope(storageId(11)))?.logicalRevision).toBe(1n);
  });

  it("refuses a second bootstrap row", async () => {
    await createBootstrap(bootstrapRow());
    await expect(createBootstrap(bootstrapRow())).rejects.toThrow(
      BootstrapExistsError,
    );
  });

  it("leaves nothing behind when one of its envelopes collides", async () => {
    const frame = opaqueFrame(11, 1n);
    await expect(
      createBootstrap(bootstrapRow(), [frame, frame]),
    ).rejects.toThrow(EnvelopeExistsError);

    expect(await readBootstrap()).toBeUndefined();
    expect(await getEnvelope(storageId(11))).toBeUndefined();
  });

  it("refuses an envelope sealed at another revision", async () => {
    await expect(
      createBootstrap(bootstrapRow({ transactionRevision: 1 }), [
        opaqueFrame(11, 2n),
      ]),
    ).rejects.toThrow(/must equal the committing transaction revision/);
  });
});

describe("readBootstrap", () => {
  it("is undefined on a store that was never set up", async () => {
    expect(await readBootstrap()).toBeUndefined();
  });
});

describe("updateForPassphraseChange (CAP-04)", () => {
  it("rewrites only the passphrase KDF, its wrapper, and the revision", async () => {
    const catalog = opaqueFrame(11, 1n);
    const before = bootstrapRow({ catalogStorageId: storageIdText(11) });
    await createBootstrap(before, [catalog]);

    const revision = await updateForPassphraseChange(
      { expectedRevision: 1, expectedWriterEpoch: 0 },
      passphraseKdf(42),
      wrappedRoot(43),
    );
    expect(revision).toBe(2);

    const after = await readBootstrap();
    expect(after).toEqual({
      ...before,
      transactionRevision: 2,
      passphraseKdf: passphraseKdf(42),
      passphraseWrappedRoot: wrappedRoot(43),
    });

    const catalogAfter = await getEnvelope(storageId(11));
    expect(catalogAfter?.logicalRevision).toBe(1n);
    expect(new Uint8Array(catalogAfter!.ciphertext)).toEqual(catalog.ciphertext);
  });

  it("rejects a stale revision or writer epoch before writing", async () => {
    await createBootstrap(bootstrapRow());

    await expect(
      updateForPassphraseChange(
        { expectedRevision: 0, expectedWriterEpoch: 0 },
        passphraseKdf(42),
        wrappedRoot(43),
      ),
    ).rejects.toThrow(RevisionConflictError);
    await expect(
      updateForPassphraseChange(
        { expectedRevision: 1, expectedWriterEpoch: 1 },
        passphraseKdf(42),
        wrappedRoot(43),
      ),
    ).rejects.toThrow(RevisionConflictError);

    const unchanged = await readBootstrap();
    expect(unchanged?.transactionRevision).toBe(1);
    expect(unchanged?.passphraseKdf).toEqual(bootstrapRow().passphraseKdf);
  });

  it("reports a missing bootstrap row as a conflict with null actuals", async () => {
    const conflict = await updateForPassphraseChange(
      { expectedRevision: 1, expectedWriterEpoch: 0 },
      passphraseKdf(42),
      wrappedRoot(43),
    ).catch((cause: unknown) => cause);

    expect(conflict).toBeInstanceOf(RevisionConflictError);
    expect((conflict as RevisionConflictError).actualRevision).toBeNull();
  });
});
