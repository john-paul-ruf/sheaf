import { describe, expect, it } from "vitest";
import katFixture from "../../fixtures/vaults/local-v1/event-commit-kat.json" with { type: "json" };
import { sha256 } from "../../../src/crypto/hash.js";
import {
  CodecError,
  IntegrityError,
} from "../../../src/domain/model/errors.js";
import type {
  EventCommitV1,
  EventSegmentV1,
} from "../../../src/migrations/004_event_format_v1.js";
import {
  compareCommits,
  decodeEventCommit,
  decodeEventSegment,
  encodeCommitBody,
  encodeEventCommit,
  encodeEventSegment,
  sealEventCommit,
  sortCommitsCanonically,
  sortFrontier,
  verifyCommitChain,
} from "../../../src/persistence/codecs/event-commit.js";

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const bytes = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));

const ids = katFixture.ids;
const id = (key: keyof typeof ids): Uint8Array => bytes(ids[key]);

const appId = id("app");
const deviceId = id("device");
const tableId = id("table");
const fieldId = id("field");
const recordId = id("record");
const lineageId = id("lineage");

/**
 * The vectors' inputs. The fixture holds the bytes they must produce; a change
 * to either side is the drift alarm.
 */
const importBody = {
  eventFormatVersion: 1,
  commitId: id("commitImport"),
  appId,
  deviceId,
  deviceCommitSequence: 1n,
  previousDeviceCommitSha256: null,
  basisFrontier: [],
  hybridTime: { wallTimeMs: 1_760_000_000_000n, logicalCounter: 0 },
  eventClass: "import",
  schemaRevisionBefore: 0n,
  schemaRevisionAfter: 1n,
  events: [
    {
      eventId: id("eventAppCreated"),
      eventIndex: 0,
      kind: "app.created",
      subject: { appId },
      payload: new Map<string, unknown>([
        ["displayName", "Cedar & Finch Fieldbook"],
        ["schemaRevision", 1n],
        ["tableIds", [tableId]],
      ]),
      provenance: {
        source: "initial-import",
        sourceId: lineageId,
        sourceTimestampMs: 1_759_999_000_000n,
      },
    },
    {
      eventId: id("eventImportAccepted"),
      eventIndex: 1,
      kind: "import.accepted",
      subject: { appId },
      payload: new Map<string, unknown>([
        ["acceptedSchemaRevision", 1n],
        ["lineageId", lineageId],
      ]),
      provenance: { source: "initial-import", sourceId: lineageId },
    },
  ],
} as const satisfies Omit<EventCommitV1, "commitSha256">;

const importCommit: EventCommitV1 = {
  ...importBody,
  commitSha256: bytes(
    katFixture.cases.find((entry) => entry.deviceCommitSequence === "1" &&
      entry.eventClass === "import")?.commitSha256Hex ?? "",
  ),
};

const patchBody = {
  eventFormatVersion: 1,
  commitId: id("commitPatch"),
  appId,
  deviceId,
  deviceCommitSequence: 2n,
  previousDeviceCommitSha256: importCommit.commitSha256,
  basisFrontier: [{ deviceId, commitSequence: 1n }],
  hybridTime: { wallTimeMs: 1_760_000_060_000n, logicalCounter: 1 },
  eventClass: "authored",
  schemaRevisionBefore: 1n,
  schemaRevisionAfter: 1n,
  events: [
    {
      eventId: id("eventRecordPatched"),
      eventIndex: 0,
      kind: "record.patched",
      subject: { appId, tableId, recordId, fieldId },
      payload: new Map<string, unknown>([
        ["recordRevision", 2n],
        [
          "changes",
          [
            new Map<string, unknown>([
              [
                "after",
                new Map<string, unknown>([
                  ["decimal", "18.50"],
                  ["kind", "decimal"],
                ]),
              ],
              ["before", new Map<string, unknown>([["kind", "missing"]])],
              ["fieldId", fieldId],
            ]),
          ],
        ],
      ]),
      provenance: { source: "user", sourceTimestampMs: 1_760_000_060_000n },
    },
  ],
} as const satisfies Omit<EventCommitV1, "commitSha256">;

const soloBody = {
  eventFormatVersion: 1,
  commitId: id("commitSolo"),
  appId,
  deviceId: id("deviceSecond"),
  deviceCommitSequence: 1n,
  previousDeviceCommitSha256: null,
  basisFrontier: [{ deviceId, commitSequence: 2n }],
  hybridTime: { wallTimeMs: 1_760_000_120_000n, logicalCounter: 0 },
  eventClass: "authored",
  schemaRevisionBefore: 1n,
  schemaRevisionAfter: 1n,
  events: [
    {
      eventId: id("eventRecordCreated"),
      eventIndex: 0,
      kind: "record.created",
      subject: { appId, tableId, recordId: id("recordSecond") },
      payload: new Map<string, unknown>([
        ["importedInvalid", false],
        ["recordId", id("recordSecond")],
      ]),
      provenance: { source: "user" },
    },
  ],
} as const satisfies Omit<EventCommitV1, "commitSha256">;

const BODIES: Readonly<Record<string, Omit<EventCommitV1, "commitSha256">>> = {
  [ids.commitSolo]: soloBody,
  [ids.commitImport]: importBody,
  [ids.commitPatch]: patchBody,
};

describe("CA-08 known-answer vectors", () => {
  it("covers at least two vectors including a two-commit chain", () => {
    expect(katFixture.contract).toBe("CA-08");
    expect(katFixture.cases.length).toBeGreaterThanOrEqual(2);
    expect(katFixture.chain.resultingFrontier).toHaveLength(1);
    // The chain vector is the schema-changing import followed by its patch.
    expect(
      katFixture.cases.map((entry) => entry.schemaRevisionBefore),
    ).toContain("0");
  });

  for (const vector of katFixture.cases) {
    it(`re-derives "${vector.name}" byte for byte`, async () => {
      const body = BODIES[vector.commitId] as Omit<
        EventCommitV1,
        "commitSha256"
      >;
      expect(body, vector.commitId).toBeDefined();

      // 1. The body is the canonical commit with commitSha256 omitted.
      const encodedBody = encodeCommitBody(body);
      expect(hex(encodedBody)).toBe(vector.bodyHex);
      expect(hex(encodedBody)).not.toContain(vector.commitSha256Hex);

      // 2. commitSha256 is SHA-256 of exactly those bytes, through M08.
      const digest = await sha256(encodedBody);
      expect(hex(digest)).toBe(vector.commitSha256Hex);

      // 3. The sealed commit encodes to the recorded bytes.
      const sealed = await sealEventCommit(body, sha256);
      expect(hex(encodeEventCommit(sealed))).toBe(vector.commitHex);

      // 4. The recorded metadata describes the bytes it sits beside.
      expect(sealed.deviceCommitSequence.toString()).toBe(
        vector.deviceCommitSequence,
      );
      expect(sealed.eventClass).toBe(vector.eventClass);
      expect(sealed.events.map((event) => event.kind)).toEqual(
        vector.eventKinds,
      );
      expect(sealed.schemaRevisionBefore.toString()).toBe(
        vector.schemaRevisionBefore,
      );
      expect(sealed.schemaRevisionAfter.toString()).toBe(
        vector.schemaRevisionAfter,
      );
    });

    it(`decodes "${vector.name}" back to the same commit`, () => {
      const decoded = decodeEventCommit(bytes(vector.commitHex));

      expect(hex(encodeEventCommit(decoded))).toBe(vector.commitHex);
      expect(hex(encodeCommitBody(decoded))).toBe(vector.bodyHex);
      expect(hex(decoded.commitSha256)).toBe(vector.commitSha256Hex);
      expect(hex(decoded.commitId)).toBe(vector.commitId);
      expect(decoded.events).toHaveLength(vector.eventKinds.length);
    });
  }

  it("pins the segment carrying the two-commit chain", () => {
    const segment = decodeEventSegment(bytes(katFixture.chain.segmentHex));

    expect(hex(segment.segmentId)).toBe(katFixture.chain.segmentId);
    expect(hex(segment.appId)).toBe(katFixture.chain.appId);
    expect(hex(segment.semanticSha256)).toBe(
      katFixture.chain.semanticSha256Hex,
    );
    expect(segment.commits).toHaveLength(2);
    expect(segment.commits.map((commit) => commit.deviceCommitSequence)).toEqual(
      [1n, 2n],
    );
    expect(hex(encodeEventSegment(segment))).toBe(katFixture.chain.segmentHex);
  });
});

describe("commit chain verification", () => {
  const chainSegment = (): EventSegmentV1 =>
    decodeEventSegment(bytes(katFixture.chain.segmentHex));

  it("accepts the recorded chain", async () => {
    await expect(
      verifyCommitChain(chainSegment().commits, sha256),
    ).resolves.toBeUndefined();
  });

  it("rejects a broken commit hash", async () => {
    const [first, second] = chainSegment().commits as [
      EventCommitV1,
      EventCommitV1,
    ];
    const tampered: EventCommitV1 = {
      ...first,
      commitSha256: Uint8Array.from(first.commitSha256, (byte, index) =>
        index === 0 ? byte ^ 0x01 : byte,
      ),
    };

    await expect(
      verifyCommitChain([tampered, second], sha256),
    ).rejects.toThrow(IntegrityError);
  });

  it("rejects a gapped device sequence", async () => {
    const [first, second] = chainSegment().commits as [
      EventCommitV1,
      EventCommitV1,
    ];
    const gapped = await sealEventCommit(
      { ...second, deviceCommitSequence: 3n },
      sha256,
    );

    await expect(verifyCommitChain([first, gapped], sha256)).rejects.toThrow(
      /gap/,
    );
  });

  it("rejects a chain whose predecessor hash does not match", async () => {
    const [first, second] = chainSegment().commits as [
      EventCommitV1,
      EventCommitV1,
    ];
    const relinked = await sealEventCommit(
      { ...second, previousDeviceCommitSha256: new Uint8Array(32).fill(9) },
      sha256,
    );

    await expect(verifyCommitChain([first, relinked], sha256)).rejects.toThrow(
      /chain is broken/,
    );
  });

  it("rejects a first commit that names a predecessor", async () => {
    const [first] = chainSegment().commits as [EventCommitV1];
    const forged: EventCommitV1 = {
      ...first,
      previousDeviceCommitSha256: new Uint8Array(32).fill(7),
    };

    // The pairing rule has one owner — the body encoder every hash goes
    // through — so verification rejects it structurally, before hashing.
    await expect(verifyCommitChain([forged], sha256)).rejects.toThrow(
      /null exactly at sequence one/,
    );
  });
});

describe("frontier and commit ordering", () => {
  const entry = (fill: number, sequence: bigint) => ({
    deviceId: new Uint8Array(16).fill(fill),
    commitSequence: sequence,
  });

  it("sorts frontier entries by device and refuses duplicates", () => {
    expect(
      sortFrontier([entry(3, 1n), entry(1, 5n), entry(2, 2n)]).map(
        (frontierEntry) => frontierEntry.deviceId[0],
      ),
    ).toEqual([1, 2, 3]);

    expect(() => sortFrontier([entry(1, 1n), entry(1, 2n)])).toThrow(
      /names one device twice/,
    );
  });

  it("refuses to encode an unsorted or duplicated frontier", () => {
    const base = decodeEventCommit(
      bytes(katFixture.cases[2]?.commitHex ?? ""),
    );

    expect(() =>
      encodeEventCommit({
        ...base,
        basisFrontier: [entry(5, 1n), entry(2, 1n)],
      }),
    ).toThrow(CodecError);
    expect(() =>
      encodeEventCommit({
        ...base,
        basisFrontier: [entry(2, 1n), entry(2, 2n)],
      }),
    ).toThrow(/names one device twice/);
  });

  it("orders commits by wall time, counter, device, sequence, then id", () => {
    const chain = decodeEventSegment(
      bytes(katFixture.chain.segmentHex),
    ).commits;
    const [first, second] = chain as [EventCommitV1, EventCommitV1];

    expect(compareCommits(first, second)).toBeLessThan(0);
    expect(
      sortCommitsCanonically([second, first]).map((commit) =>
        hex(commit.commitId),
      ),
    ).toEqual([hex(first.commitId), hex(second.commitId)]);

    // Identical wall time and counter fall through to the device tiebreak.
    const sameTime: EventCommitV1 = {
      ...second,
      hybridTime: first.hybridTime,
      deviceId: new Uint8Array(16).fill(0xff),
    };
    expect(compareCommits(first, sameTime)).toBeLessThan(0);
  });
});

describe("wire validation", () => {
  const commit = (): EventCommitV1 =>
    decodeEventCommit(bytes(katFixture.cases[2]?.commitHex ?? ""));

  it("refuses an event kind outside 004's closed catalog", () => {
    const base = commit();
    const [event] = base.events as [EventCommitV1["events"][number]];

    expect(() =>
      encodeEventCommit({
        ...base,
        events: [{ ...event, kind: "record.recalculated" as never }],
      }),
    ).toThrow(/closed v1 catalog/);
  });

  it("refuses an event whose subject belongs to another app", () => {
    const base = commit();
    const [event] = base.events as [EventCommitV1["events"][number]];

    expect(() =>
      encodeEventCommit({
        ...base,
        events: [
          { ...event, subject: { ...event.subject, appId: new Uint8Array(16) } },
        ],
      }),
    ).toThrow(/another app/);
  });

  it("requires a record event to name its table and record", () => {
    const base = commit();
    const [event] = base.events as [EventCommitV1["events"][number]];

    expect(() =>
      encodeEventCommit({
        ...base,
        events: [{ ...event, subject: { appId: base.appId } }],
      }),
    ).toThrow(/must name a tableId/);
  });

  it("requires event indexes contiguous from zero", () => {
    const base = commit();
    const [event] = base.events as [EventCommitV1["events"][number]];

    expect(() =>
      encodeEventCommit({ ...base, events: [{ ...event, eventIndex: 1 }] }),
    ).toThrow(/contiguous from zero/);
    expect(() => encodeEventCommit({ ...base, events: [] })).toThrow(
      /at least one event/,
    );
  });

  it("ties previousDeviceCommitSha256 to sequence one", () => {
    const base = commit();

    expect(() =>
      encodeEventCommit({ ...base, previousDeviceCommitSha256: null }),
    ).toThrow(/null exactly at sequence one/);
    expect(() =>
      encodeEventCommit({ ...base, deviceCommitSequence: 0n }),
    ).toThrow(/starts at one/);
  });

  it("refuses an unsupported event format version on both sides", () => {
    const base = commit();

    expect(() =>
      encodeEventCommit({ ...base, eventFormatVersion: 2 as never }),
    ).toThrow(/event format version/);
    expect(() => decodeEventCommit(new Uint8Array([0xa0]))).toThrow(CodecError);
  });

  it("refuses trailing bytes and unknown fields", () => {
    const encoded = encodeEventCommit(commit());

    expect(() =>
      decodeEventCommit(Uint8Array.from([...encoded, 0x00])),
    ).toThrow(CodecError);
  });
});
