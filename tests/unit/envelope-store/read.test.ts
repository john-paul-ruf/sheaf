/** Pointer lookup and `[revision+storageId]` paging (database.md § Query Patterns). */

// First import: the shim must be installed before `dexie` is evaluated (D8).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createBootstrap } from "../../../src/persistence/envelope-store/bootstrap.js";
import {
  getEnvelope,
  getEnvelopesByRevision,
  type RevisionCursor,
} from "../../../src/persistence/envelope-store/read.js";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  asStorageId16,
  encodeStorageId16,
} from "../../../src/domain/model/bytes.js";
import type { EnvelopeFrameV1 } from "../../../src/migrations/003_envelope_format_v1.js";
import {
  bootstrapRow,
  opaqueFrame,
  resetLocalDatabase,
  storageId,
} from "./local-store.js";

const SEEDS = [3, 1, 4, 15, 9, 2, 6];

const idText = (frame: EnvelopeFrameV1): string =>
  encodeStorageId16(asStorageId16(frame.storageId));

beforeEach(async () => {
  await resetLocalDatabase();
  await createBootstrap(
    bootstrapRow(),
    SEEDS.map((seed) => opaqueFrame(seed, 1n)),
  );
});

describe("getEnvelope", () => {
  it("returns the frame stored under that pointer", async () => {
    const frame = await getEnvelope(storageId(9));
    expect(frame?.logicalRevision).toBe(1n);
    expect(new Uint8Array(frame!.ciphertext)).toEqual(opaqueFrame(9, 1n).ciphertext);
  });

  it("returns undefined for an unknown pointer", async () => {
    expect(await getEnvelope(storageId(99))).toBeUndefined();
  });
});

describe("getEnvelopesByRevision", () => {
  it("returns every row a transaction introduced, ordered by storage id", async () => {
    const page = await getEnvelopesByRevision(1);

    expect(page.frames).toHaveLength(SEEDS.length);
    expect(page.nextCursor).toBeUndefined();
    const ids = page.frames.map(idText);
    expect(ids).toEqual([...ids].sort());
  });

  it("pages through one revision without repeating or skipping a row", async () => {
    const seen: string[] = [];
    let cursor: RevisionCursor = { limit: 3 };

    for (;;) {
      const page = await getEnvelopesByRevision(1, cursor);
      seen.push(...page.frames.map(idText));
      if (page.nextCursor === undefined) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(SEEDS.length);
    expect(new Set(seen).size).toBe(SEEDS.length);
  });

  it("is empty for a revision that committed nothing", async () => {
    const page = await getEnvelopesByRevision(2);
    expect(page.frames).toHaveLength(0);
    expect(page.nextCursor).toBeUndefined();
  });

  it("refuses a revision or limit outside its contract", async () => {
    await expect(getEnvelopesByRevision(0)).rejects.toThrow(CodecError);
    await expect(getEnvelopesByRevision(1, { limit: 0 })).rejects.toThrow(CodecError);
  });
});
