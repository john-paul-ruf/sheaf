/**
 * CA-11: the durable roots' page boundaries and their explicit absences.
 *
 * The browser journey proves these roots decode after a real promotion. This
 * suite proves the *refusals* — the states a page must never reach — because a
 * sorted, capped page is only a guarantee if the encoder declines to write an
 * unsorted or oversized one.
 */

import { describe, expect, it } from "vitest";
import { CodecError } from "../../../src/domain/model/errors.js";
import {
  asDomainId,
  type AppId,
  type DeviceId,
  type FieldId,
  type RecordId,
  type TableId,
} from "../../../src/domain/model/ids.js";
import {
  PAGE_MAX_DECODED_BYTES,
  RECORD_PAGE_MAX_RECORDS,
  compareRecordKeys,
  decodeAppHead,
  decodeCheckpointManifest,
  decodeRecordPage,
  encodeAppHead,
  encodeCheckpointManifest,
  encodeRecordPage,
  type AppHeadV1,
  type CheckpointManifestV1,
  type StoredRecordV1,
} from "../../../src/import/staging/roots.js";
import { DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import { textValue } from "../../../src/domain/model/values.js";

const id = <K extends Parameters<typeof asDomainId>[0]>(kind: K, seed: number) =>
  asDomainId(
    kind,
    Uint8Array.from({ length: 16 }, (_unused, index) => (seed + index) % 256),
  );

const TABLE: TableId = id("table", 1);
const FIELD: FieldId = id("field", 2);
const digest = (seed: number): Uint8Array =>
  Uint8Array.from({ length: 32 }, (_unused, index) => (seed + index) % 256);

const record = (seed: number): StoredRecordV1 => ({
  recordId: id("record", seed) satisfies RecordId,
  tableId: TABLE,
  values: [{ fieldId: FIELD, value: textValue(`row ${seed}`) }],
  issues: [],
});

describe("record pages", () => {
  it("round-trips sorted records", () => {
    const records = [record(10), record(20), record(30)].sort(compareRecordKeys);
    const encoded = encodeRecordPage({ pageVersion: 1, records });

    expect(decodeRecordPage(encoded).records).toEqual(records);
    expect(encodeRecordPage(decodeRecordPage(encoded))).toEqual(encoded);
  });

  it("refuses a page that is not sorted by (tableId, recordId)", () => {
    const records = [record(30), record(10)];
    expect(() => encodeRecordPage({ pageVersion: 1, records })).toThrow(
      /not sorted/,
    );
  });

  it("refuses a page that repeats a key", () => {
    expect(() =>
      encodeRecordPage({ pageVersion: 1, records: [record(10), record(10)] }),
    ).toThrow(/not sorted/);
  });

  it("refuses more than 1,024 records", () => {
    const records = Array.from({ length: RECORD_PAGE_MAX_RECORDS + 1 }, (_u, index) =>
      record(index),
    ).sort(compareRecordKeys);
    expect(() => encodeRecordPage({ pageVersion: 1, records })).toThrow(
      /exceeds 1,024 records/,
    );
  });

  it("refuses a page over the 512 KiB decoded cap", () => {
    // Well under the record-count cap, well over the byte cap: the two limits
    // are independent, and whichever comes first is the one that binds.
    const big = Array.from({ length: 200 }, (_u, index) => ({
      ...record(index),
      values: [
        { fieldId: FIELD, value: textValue("x".repeat(4_000)) },
      ],
    })).sort(compareRecordKeys);

    expect(() => encodeRecordPage({ pageVersion: 1, records: big })).toThrow(
      /512 KiB/,
    );
    expect(PAGE_MAX_DECODED_BYTES).toBe(524_288);
  });

  it("preserves the three absent states as three different facts", () => {
    const values = [
      { fieldId: FIELD, value: { kind: "missing" } as const },
      { fieldId: id("field", 3) satisfies FieldId, value: { kind: "blank" } as const },
      {
        fieldId: id("field", 4) satisfies FieldId,
        value: { kind: "invalid-preserved", sourceText: "TBD" } as const,
      },
    ];
    const page = { pageVersion: 1 as const, records: [{ ...record(1), values }] };
    expect(decodeRecordPage(encodeRecordPage(page)).records[0]?.values).toEqual(
      values,
    );
  });
});

describe("the app head and its checkpoint", () => {
  const checkpoint: CheckpointManifestV1 = {
    manifestVersion: 1,
    appId: id("app", 5) satisfies AppId,
    schemaRevision: 1n,
    frontier: [{ deviceId: id("device", 6) satisfies DeviceId, commitSequence: 1n }],
    appState: {
      appId: id("app", 5) satisfies AppId,
      displayName: "Field Log",
      createdAtMs: 1_757_000_000_000,
      lastOpenedAtMs: null,
      schemaRevision: 1n,
      locality: "present",
      durableHomeId: null,
      lastSuccessfulBackupMs: null,
      deviceOnlyChangeCount: 1,
      theme: DEFAULT_APP_THEME,
      stateRevision: 1n,
    },
    tables: [],
    enumOptions: [],
    sheetSnapshots: [],
    recordPages: [],
    semanticSha256: digest(7),
  };

  const head: AppHeadV1 = {
    headVersion: 1,
    appId: id("app", 5) satisfies AppId,
    headRevision: 1n,
    schemaRevision: 1n,
    checkpoint: { storageId: "AAAAAAAAAAAAAAAAAAAAAA", semanticSha256: digest(8) },
    eventSegments: [
      { storageId: "BBBBBBBBBBBBBBBBBBBBBB", semanticSha256: digest(9) },
    ],
    frontier: [{ deviceId: id("device", 6) satisfies DeviceId, commitSequence: 1n }],
    baselinePages: [
      { storageId: "CCCCCCCCCCCCCCCCCCCCCC", semanticSha256: digest(10) },
    ],
    conflictPages: [],
    auditPages: [],
    sourceManifests: [
      { storageId: "DDDDDDDDDDDDDDDDDDDDDD", semanticSha256: digest(11) },
    ],
    snapshotManifests: [
      { storageId: "EEEEEEEEEEEEEEEEEEEEEE", semanticSha256: digest(12) },
    ],
    retainedRoots: [],
    semanticSha256: digest(13),
  };

  it("round-trips the head byte-identically, empty roots included", () => {
    const encoded = encodeAppHead(head);
    expect(decodeAppHead(encoded)).toEqual(head);
    expect(encodeAppHead(decodeAppHead(encoded))).toEqual(encoded);
  });

  it("keeps the absent roots explicitly present", () => {
    // "No conflicts" and "this app has no conflict root" are different
    // claims. A decoder that tolerated the field's absence would erase the
    // difference, so it is required rather than optional.
    const decoded = decodeAppHead(encodeAppHead(head));
    expect(decoded.conflictPages).toEqual([]);
    expect(decoded.auditPages).toEqual([]);
    expect(decoded.retainedRoots).toEqual([]);
  });

  it("carries the theme root, decodable and complete (D29)", () => {
    const decoded = decodeCheckpointManifest(encodeCheckpointManifest(checkpoint));
    expect(decoded.appState.theme).toEqual(DEFAULT_APP_THEME);
  });

  it("refuses a checkpoint that is missing a field", () => {
    const encoded = encodeCheckpointManifest(checkpoint);
    const truncated = encoded.slice(0, encoded.byteLength - 1);
    expect(() => decodeCheckpointManifest(truncated)).toThrow(CodecError);
  });
});
