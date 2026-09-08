import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  DOMAIN_ID_BYTE_LENGTH,
  DOMAIN_ID_KINDS,
  asDomainId,
  compareDomainIds,
  createDomainId,
  decodeDomainId,
  domainIdsEqual,
  encodeDomainId,
  type DomainEntropy,
} from "../../../src/domain/model/ids.js";
import { STORAGE_ID_BYTE_LENGTH } from "../../../src/domain/model/bytes.js";

const sequentialEntropy = (): DomainEntropy => {
  let next = 0;
  return {
    randomBytes: (byteLength: number) =>
      Uint8Array.from({ length: byteLength }, () => next++ & 0xff),
  };
};

describe("domain ids", () => {
  it("pins the ID width to the projection's column checks", async () => {
    const sql = await readFile("src/migrations/005_projection_v1.sql", "utf8");

    expect(DOMAIN_ID_BYTE_LENGTH).toBe(16);
    expect(sql).toContain("length(app_id) = 16");
    expect(sql).toContain("length(record_id) = 16");
    expect(sql).toContain("length(field_id) = 16");
    // A domain ID is the same width as a storage ID but never the same value.
    expect(DOMAIN_ID_BYTE_LENGTH).toBe(STORAGE_ID_BYTE_LENGTH);
  });

  it("returns injected entropy verbatim, 16 bytes per ID", () => {
    const requested: number[] = [];
    const draws = [new Uint8Array(16).fill(4), new Uint8Array(16).fill(5)];
    let draw = 0;
    const entropy: DomainEntropy = {
      randomBytes: (byteLength) => {
        requested.push(byteLength);
        return draws[draw++] as Uint8Array;
      },
    };

    const first = createDomainId("record", entropy);
    const second = createDomainId("record", entropy);

    expect(requested).toEqual([16, 16]);
    // Verbatim, not hashed or folded: the CSPRNG is the only source.
    expect([...first]).toEqual([...(draws[0] as Uint8Array)]);
    expect(domainIdsEqual(first, second)).toBe(false);
  });

  it("offers no way to derive an ID from a name", () => {
    const entropy = sequentialEntropy();

    // The creation API accepts a kind and an entropy source and nothing else,
    // so there is no parameter a name could enter through.
    expect(createDomainId.length).toBe(2);
    expect(createDomainId("table", entropy).byteLength).toBe(16);
  });

  it("refuses bytes that are not exactly 16 long", () => {
    for (const length of [0, 15, 17, 32]) {
      expect(() => asDomainId("app", new Uint8Array(length))).toThrow(
        CodecError,
      );
    }
    expect(asDomainId("app", new Uint8Array(16)).byteLength).toBe(16);
  });

  it("round-trips the non-durable text spelling and rejects other spellings", () => {
    const id = createDomainId("field", sequentialEntropy());
    const text = encodeDomainId(id);

    expect(text).toHaveLength(22);
    expect([...decodeDomainId("field", text)]).toEqual([...id]);

    expect(() => decodeDomainId("field", `${text}=`)).toThrow(CodecError);
    expect(() => decodeDomainId("field", text.slice(0, 21))).toThrow(CodecError);
    // 22 characters whose trailing bits are non-zero are not canonical.
    expect(() => decodeDomainId("field", `${text.slice(0, 21)}B`)).toThrow(
      CodecError,
    );
  });

  it("orders IDs bytewise for every canonical sort", () => {
    const low = asDomainId("commit", new Uint8Array(16).fill(0));
    const high = asDomainId("commit", new Uint8Array(16).fill(0xff));
    const middle = asDomainId("commit", (() => {
      const bytes = new Uint8Array(16);
      bytes[0] = 0x01;
      return bytes;
    })());

    expect(compareDomainIds(low, high)).toBeLessThan(0);
    expect(compareDomainIds(high, low)).toBeGreaterThan(0);
    expect(compareDomainIds(low, low)).toBe(0);
    expect([high, low, middle].sort(compareDomainIds).map(encodeDomainId)).toEqual(
      [low, middle, high].map(encodeDomainId),
    );
  });

  it("names every kind the feature can create", () => {
    expect([...DOMAIN_ID_KINDS]).toEqual([
      "app",
      "table",
      "field",
      "record",
      "event",
      "commit",
      "device",
      "segment",
      "option",
      "rule",
      "lineage",
      "sheet",
    ]);
    expect(Object.isFrozen(DOMAIN_ID_KINDS)).toBe(true);
  });
});
