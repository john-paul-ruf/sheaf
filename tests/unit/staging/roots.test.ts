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
import { sha256 } from "../../../src/crypto/hash.js";
import { decodeCanonical, encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import {
  checkpointSemanticBody,
  encodeCheckpointBody,
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
  type ResolvedCheckpointManifestV1,
  type StoredRecordV1,
} from "../../../src/import/staging/roots.js";
import { DEFAULT_APP_THEME } from "../../../src/import/staging/theme.js";
import {
  MIN_EPOCH_DAY,
  dateValue,
  textValue,
} from "../../../src/domain/model/values.js";

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

  it("round-trips a date before 1970 — epoch days are signed", () => {
    // The encoder writes the negative integer faithfully; a nonnegative-only
    // reader would make this page one the app wrote and cannot open again.
    const older = {
      ...record(10),
      values: [{ fieldId: FIELD, value: dateValue(-1_826) }],
    };
    const encoded = encodeRecordPage({ pageVersion: 1, records: [older] });

    expect(decodeRecordPage(encoded).records[0]?.values[0]?.value).toEqual({
      kind: "date",
      epochDay: -1_826,
    });
    expect(encodeRecordPage(decodeRecordPage(encoded))).toEqual(encoded);
  });

  it("refuses an epoch day below the representable range", () => {
    // Signed does not mean unbounded: the decoder holds the same range
    // `dateValue()` enforces, so a page cannot smuggle in a date the domain
    // would refuse to author.
    const beyond = {
      ...record(10),
      values: [
        {
          fieldId: FIELD,
          value: { kind: "date", epochDay: MIN_EPOCH_DAY - 1 } as const,
        },
      ],
    };
    expect(() =>
      decodeRecordPage(encodeRecordPage({ pageVersion: 1, records: [beyond] })),
    ).toThrow(CodecError);
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

/**
 * A checkpoint manifest exactly as F02's encoder wrote it, generated at
 * `2b16638` (before D37) and committed as bytes: one delimited table with a
 * text and an enum field, one option, one sheet, one record page. Every
 * GATE-F02 app's checkpoint has this key set.
 */
const F02_CHECKPOINT_HEX = [
  "aa656170704964502c2d2e2f303132333435363738393a3b667461626c657381a9666669656c647382a86474797065a1",
  "646b696e646474657874676669656c64496450292a2b2c2d2e2f303132333435363738677461626c6549645028292a2b",
  "2c2d2e2f3031323334353637686973416374697665f56a69735265717569726564f46b646973706c61794e616d65644e",
  "616d656c6669656c644f7264696e616c006e736368656d615265766973696f6e01a86474797065a1646b696e6464656e",
  "756d676669656c644964502a2b2c2d2e2f30313233343536373839677461626c6549645028292a2b2c2d2e2f30313233",
  "34353637686973416374697665f56a69735265717569726564f46b646973706c61794e616d65665374617475736c6669",
  "656c644f7264696e616c016e736368656d615265766973696f6e01677461626c6549645028292a2b2c2d2e2f30313233",
  "34353637686973416374697665f56a6b65794669656c644964f66b646973706c61794e616d65694669656c64204c6f67",
  "6c6c6162656c4669656c644964f66c7461626c654f7264696e616c006d736f7572636553686565744964502b2c2d2e2f",
  "303132333435363738393a6e736368656d615265766973696f6e01686170705374617465ab656170704964502c2d2e2f",
  "303132333435363738393a3b657468656d65a266746f6b656e73a6676170702d696e6b6723313732313163696170702d",
  "6d7574656467236532646564326a6170702d616363656e7467233466376436636a6170702d63616e7661736723663766",
  "3565656b6170702d7072696d61727967233264356134626b6170702d737572666163656723666666646638687468656d",
  "654b65797173686561662e6275696c742d696e2e7631686c6f63616c6974796770726573656e746b6372656174656441",
  "744d731b00000199155c62006b646973706c61794e616d65694669656c64204c6f676d64757261626c65486f6d654964",
  "f66d73746174655265766973696f6e016e6c6173744f70656e656441744d73f66e736368656d615265766973696f6e01",
  "756465766963654f6e6c794368616e6765436f756e7401766c6173745375636365737366756c4261636b75704d73f668",
  "66726f6e7469657281a2686465766963654964502d2e2f303132333435363738393a3b3c6e636f6d6d69745365717565",
  "6e6365016b656e756d4f7074696f6e7381a6676669656c644964502a2b2c2d2e2f303132333435363738396869734163",
  "74697665f5686f7074696f6e4964502e2f303132333435363738393a3b3c3d6c646973706c61794c6162656c644f7065",
  "6e6d6f7074696f6e4f7264696e616c006e736368656d615265766973696f6e016b7265636f7264506167657381a6676c",
  "6173744b6579582002020202020202020202020202020202020202020202020202020202020202026866697273744b65",
  "79582001010101010101010101010101010101010101010101010101010101010101016973746f726167654964764747",
  "47474747474747474747474747474747474747416c6465636f646564436f756e74026e73656d616e7469635368613235",
  "3658202f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e716465636f646564427974654c",
  "656e67746819012c6e736368656d615265766973696f6e016e73656d616e74696353686132353658202d483e1d639954",
  "2b917ffccc3ee549936cc05e7a38672fbe4eb6f0036ed184606e7368656574536e617073686f747381a6677368656574",
  "4964502b2c2d2e2f303132333435363738393a6b646973706c61794e616d65694669656c64204c6f676c73686565744f",
  "7264696e616c00706465636c61726564526f77436f756e74f6736465636c61726564436f6c756d6e436f756e74f67819",
  "736e617073686f744d616e696665737453746f7261676549647646464646464646464646464646464646464646464641",
  "6f6d616e696665737456657273696f6e01",
].join("");

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));

describe("checkpoint manifest evolution (D37, CA-20)", () => {
  const f02 = fromHex(F02_CHECKPOINT_HEX);

  it("decodes an F02 manifest to the F02-true defaults", () => {
    const decoded = decodeCheckpointManifest(f02);

    expect(decoded.tables.map((table) => table.displayName)).toEqual(["Field Log"]);
    expect(decoded.relationships).toEqual([]);
    expect(decoded.validationRules).toEqual([]);
    expect(decoded.inertItems).toEqual([]);
    expect(decoded.inferenceDecisions).toEqual([]);
    expect(decoded.importLineages).toEqual([]);
    expect(decoded.sheetSnapshots).toHaveLength(1);
    expect(decoded.sheetSnapshots[0]?.classification).toEqual(["table"]);
    expect(decoded.sheetSnapshots[0]?.snapshotRevision).toBe(decoded.schemaRevision);
  });

  it("verifies the F02 digest over the bytes that were written", async () => {
    const decoded = decodeCheckpointManifest(f02);
    const body = checkpointSemanticBody(f02);

    expect(await sha256(body)).toEqual(decoded.semanticSha256);
    // Re-encoding through the F03 encoder adds the defaulted keys, so it would
    // not verify — which is why the body is taken from the payload as written.
    expect(await sha256(encodeCheckpointBody(decoded))).not.toEqual(
      decoded.semanticSha256,
    );
  });

  const full = (): ResolvedCheckpointManifestV1 => {
    const base = decodeCheckpointManifest(f02);
    const sheet = base.sheetSnapshots[0]!;
    const table = base.tables[0]!;
    return {
      ...base,
      sheetSnapshots: [{ ...sheet, classification: ["summary", "chart"], snapshotRevision: 3n }],
      relationships: [
        {
          relationshipId: id("relationship", 60),
          fromTableId: table.tableId,
          fromFieldId: table.fields[0]!.fieldId,
          toTableId: id("table", 61),
          toKeyFieldId: id("field", 62),
          detectionSource: "lookup-formula",
          isActive: true,
          schemaRevision: 1n,
        },
      ],
      validationRules: [
        {
          tableId: table.tableId,
          displayName: "Name when open",
          rule: {
            irVersion: 1,
            ruleId: id("rule", 63),
            condition: {
              kind: "any",
              conditions: [
                { kind: "field-present", fieldId: table.fields[0]!.fieldId },
                {
                  kind: "not",
                  condition: {
                    kind: "field-equals",
                    fieldId: table.fields[1]!.fieldId,
                    value: textValue("Open"),
                  },
                },
              ],
            },
            severity: "warning",
            messageKey: "rule.name-when-open",
            messageParameters: { fieldLabel: "Name", count: 2, strict: false },
          },
          isActive: true,
          schemaRevision: 1n,
        },
      ],
      inertItems: [
        {
          inertItemId: id("inert-item", 64),
          sheetId: sheet.sheetId,
          kind: "chart",
          location: "Overview!B2:F9",
          reasonKey: "chart-not-live-yet",
          anchor: { firstRow: 1, firstColumn: 1, lastRow: 8, lastColumn: 5 },
          preservedManifestStorageId: null,
        },
      ],
      inferenceDecisions: [
        {
          decisionId: id("decision", 65),
          subject: "relationship",
          decisionKind: "relationship",
          evidenceFingerprint: digest(66),
          disposition: "rejected",
          statement: new Map([["statementId", "rel:0"]]),
          evidence: [1n, "lookup"],
          recordedEventId: id("event", 67),
        },
        {
          decisionId: id("decision", 68),
          subject: "app-name",
          decisionKind: null,
          evidenceFingerprint: digest(69),
          disposition: "edited",
          statement: "Jobs",
          evidence: [],
          recordedEventId: id("event", 70),
        },
      ],
      importLineages: [
        {
          lineageId: id("lineage", 71),
          importKind: "initial",
          importOrdinal: 0,
          sourceDisplayName: "field-log.xlsx",
          sourceSha256: digest(72),
          acceptedAtMs: 1_757_000_000_000,
          identityDecisions: new Map([["kind", "initial"]]),
          acceptedCommitId: id("commit", 73),
        },
      ],
    };
  };

  it("round-trips every F03 root byte-identically", () => {
    const manifest = full();
    const encoded = encodeCheckpointManifest(manifest);
    const decoded = decodeCheckpointManifest(encoded);

    expect(decoded).toEqual(manifest);
    expect(encodeCheckpointManifest(decoded)).toEqual(encoded);
  });

  it("writes every key even when the writer predates them", () => {
    const { relationships, validationRules, inertItems, inferenceDecisions, importLineages, ...f02Writer } =
      decodeCheckpointManifest(f02);
    void [relationships, validationRules, inertItems, inferenceDecisions, importLineages];
    const writer: CheckpointManifestV1 = {
      ...f02Writer,
      sheetSnapshots: f02Writer.sheetSnapshots.map(
        ({ classification, snapshotRevision, ...sheet }) => {
          void [classification, snapshotRevision];
          return sheet;
        },
      ),
    };
    const map = decodeCanonical(encodeCheckpointManifest(writer)) as ReadonlyMap<string, unknown>;

    expect([...map.keys()]).toEqual(
      expect.arrayContaining(["relationships", "validationRules", "inertItems", "inferenceDecisions", "importLineages"]),
    );
    expect(decodeCheckpointManifest(encodeCheckpointManifest(writer))).toEqual(
      decodeCheckpointManifest(f02),
    );
  });

  const withKeys = (
    bytes: Uint8Array,
    edit: (map: Map<string, unknown>) => void,
  ): Uint8Array => {
    const map = new Map(decodeCanonical(bytes) as ReadonlyMap<string, unknown>);
    edit(map);
    return encodeCanonical(map as never);
  };

  it("refuses any key set that is neither exactly F02 nor exactly F03", () => {
    const f03 = encodeCheckpointManifest(full());

    // F02 plus one F03 root is neither shape.
    expect(() =>
      decodeCheckpointManifest(withKeys(f02, (map) => map.set("relationships", []))),
    ).toThrow(CodecError);
    // F03 missing one root.
    expect(() =>
      decodeCheckpointManifest(withKeys(f03, (map) => map.delete("inertItems"))),
    ).toThrow(CodecError);
    // A stray key on either shape.
    expect(() =>
      decodeCheckpointManifest(withKeys(f03, (map) => map.set("extra", 1n))),
    ).toThrow(CodecError);
  });

  it("refuses an F03 manifest whose sheet entry has the F02 shape", () => {
    const f03 = encodeCheckpointManifest(full());
    const f02Sheets = (decodeCanonical(f02) as ReadonlyMap<string, unknown>).get("sheetSnapshots");
    expect(() =>
      decodeCheckpointManifest(withKeys(f03, (map) => map.set("sheetSnapshots", f02Sheets))),
    ).toThrow(CodecError);
  });

  it("refuses an empty classification and an unknown decision kind", () => {
    const manifest = full();
    expect(() =>
      decodeCheckpointManifest(
        encodeCheckpointManifest({
          ...manifest,
          sheetSnapshots: [{ ...manifest.sheetSnapshots[0]!, classification: [] }],
        }),
      ),
    ).toThrow(CodecError);
    expect(() =>
      decodeCheckpointManifest(
        encodeCheckpointManifest({
          ...manifest,
          inferenceDecisions: [
            { ...manifest.inferenceDecisions[0]!, decisionKind: "app-name" as never },
          ],
        }),
      ),
    ).toThrow(CodecError);
  });
});
