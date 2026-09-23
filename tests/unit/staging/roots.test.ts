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
import type { FormulaDefinitionV1 } from "../../../src/domain/formulas/index.js";
import {
  decodeChartDefinition,
  decodeRuleIR,
  encodeChartDefinition,
  encodeRuleIR,
  type CheckpointChartV1,
  type CheckpointFormulaV1,
} from "../../../src/import/staging/roots.js";
import type { ChartDefinitionV1 } from "../../../src/domain/model/charts.js";
import { encodeChartDefinition as encodeProjectionChart } from "../../../src/persistence/projection/cbor-values.js";
import type { ValidationRuleIRV2 } from "../../../src/domain/validation/rules.js";
import { decodeCanonical, encodeCanonical } from "../../../src/persistence/codecs/canonical-cbor.js";
import {
  checkpointSemanticBody,
  decodeFieldDef,
  encodeCheckpointBody,
  encodeFieldDef,
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
  decimalValue,
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

/**
 * A checkpoint manifest exactly as F03's encoder wrote it, generated at
 * `4ce7f54` (before F04 added the `formulas` root) from the F02 manifest above
 * with an F03 sheet classification, a v1 rule and a lineage: the F03 key set,
 * which every GATE-F03 app's checkpoint has.
 */
const F03_CHECKPOINT_HEX = [
  "af656170704964502c2d2e2f303132333435363738393a3b667461626c657381a9666669656c647382a86474797065a1",
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
  "6e6365016a696e6572744974656d73806b656e756d4f7074696f6e7381a6676669656c644964502a2b2c2d2e2f303132",
  "33343536373839686973416374697665f5686f7074696f6e4964502e2f303132333435363738393a3b3c3d6c64697370",
  "6c61794c6162656c644f70656e6d6f7074696f6e4f7264696e616c006e736368656d615265766973696f6e016b726563",
  "6f7264506167657381a6676c6173744b6579582002020202020202020202020202020202020202020202020202020202",
  "020202026866697273744b65795820010101010101010101010101010101010101010101010101010101010101010169",
  "73746f72616765496476474747474747474747474747474747474747474747416c6465636f646564436f756e74026e73",
  "656d616e74696353686132353658202f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e71",
  "6465636f646564427974654c656e67746819012c6d72656c6174696f6e7368697073806e696d706f72744c696e656167",
  "657381a8696c696e656167654964504748494a4b4c4d4e4f505152535455566a696d706f72744b696e6467696e697469",
  "616c6c616363657074656441744d731b00000199155c62006c736f75726365536861323536582048494a4b4c4d4e4f50",
  "5152535455565758595a5b5c5d5e5f60616263646566676d696d706f72744f7264696e616c0070616363657074656443",
  "6f6d6d6974496450494a4b4c4d4e4f505152535455565758716964656e746974794465636973696f6e73a1646b696e64",
  "67696e697469616c71736f75726365446973706c61794e616d656e6669656c642d6c6f672e786c73786e736368656d61",
  "5265766973696f6e016e73656d616e74696353686132353658202d483e1d6399542b917ffccc3ee549936cc05e7a3867",
  "2fbe4eb6f0036ed184606e7368656574536e617073686f747381a86773686565744964502b2c2d2e2f30313233343536",
  "3738393a6b646973706c61794e616d65694669656c64204c6f676c73686565744f7264696e616c006e636c6173736966",
  "69636174696f6e826773756d6d617279656368617274706465636c61726564526f77436f756e74f670736e617073686f",
  "745265766973696f6e03736465636c61726564436f6c756d6e436f756e74f67819736e617073686f744d616e69666573",
  "7453746f72616765496476464646464646464646464646464646464646464646416f6d616e696665737456657273696f",
  "6e016f76616c69646174696f6e52756c657381a56472756c65a66672756c654964503f404142434445464748494a4b4c",
  "4d4e687365766572697479677761726e696e6769636f6e646974696f6ea2646b696e64636e6f7469636f6e646974696f",
  "6ea3646b696e646c6669656c642d657175616c736576616c7565a2646b696e6464746578746474657874644f70656e67",
  "6669656c644964502a2b2c2d2e2f3031323334353637383969697256657273696f6e016a6d6573736167654b65797372",
  "756c652e6e616d652d7768656e2d6f70656e716d657373616765506172616d6574657273a265636f756e74026a666965",
  "6c644c6162656c644e616d65677461626c6549645028292a2b2c2d2e2f3031323334353637686973416374697665f56b",
  "646973706c61794e616d656e4e616d65207768656e206f70656e6e736368656d615265766973696f6e0172696e666572",
  "656e63654465636973696f6e7380",
].join("");

describe("checkpoint manifest evolution, F04 (CA-25, CA-27)", () => {
  const f03 = fromHex(F03_CHECKPOINT_HEX);

  it("decodes F03 bytes with no formulas, and a v1 rule unchanged", () => {
    const decoded = decodeCheckpointManifest(f03);

    expect(decoded.formulas).toEqual([]);
    expect(decoded.sheetSnapshots[0]?.classification).toEqual(["summary", "chart"]);
    expect(decoded.validationRules[0]?.rule.irVersion).toBe(1);
    expect(decoded.validationRules[0]?.rule.condition.kind).toBe("not");
    expect(decoded.importLineages).toHaveLength(1);
    // The body the digest covers is the F03 bytes as written, without the
    // `formulas` key the F04 encoder would add.
    expect([...(decodeCanonical(checkpointSemanticBody(f03)) as ReadonlyMap<string, unknown>).keys()]).not.toContain("formulas");
    // And an F02 manifest still decodes to no formulas either (D37).
    expect(decodeCheckpointManifest(fromHex(F02_CHECKPOINT_HEX)).formulas).toEqual([]);
  });

  const table = decodeCheckpointManifest(f03).tables[0]!;
  const [first, second] = table.fields;
  const formula = (
    seed: number,
    overrides: Partial<FormulaDefinitionV1> & Pick<FormulaDefinitionV1, "target">,
  ): CheckpointFormulaV1 => ({
    formula: {
      formulaId: id("formula", seed),
      displayName: null,
      originalText: "[Name]&\"!\"",
      document: {
        irVersion: 1,
        root: {
          kind: "binary",
          operator: "&",
          left: { kind: "field", fieldId: first!.fieldId },
          right: { kind: "literal", value: { kind: "text", text: "!" } },
        },
      },
      disposition: "live",
      determinism: "deterministic",
      dependencies: [{ kind: "field", fieldId: first!.fieldId }],
      ...overrides,
    },
    metadata: {
      catalogVersion: 1,
      functionVersions: [],
      source: "authored",
      importedValuePolicy: "none",
    },
    isActive: true,
    schemaRevision: 2n,
  });
  const column = { kind: "computed-column" as const, tableId: table.tableId, fieldId: second!.fieldId };
  const metric = { kind: "table-metric" as const, tableId: table.tableId };
  const dashboard = { kind: "dashboard-value" as const, tableId: null };
  const every: CheckpointFormulaV1[] = [
    formula(80, { target: column }),
    formula(81, {
      target: metric,
      originalText: "SUM(Field_Log[Name])",
      document: {
        irVersion: 1,
        root: {
          kind: "call",
          name: "SUM",
          version: 1,
          args: [{ kind: "column", tableId: table.tableId, fieldId: first!.fieldId }, null],
        },
      },
      displayName: "Total",
    }),
    formula(82, {
      target: dashboard,
      displayName: "Today",
      originalText: "TODAY()",
      document: { irVersion: 1, root: { kind: "call", name: "TODAY", version: 1, args: [] } },
      determinism: "clock-volatile",
      dependencies: [],
    }),
    formula(83, {
      target: column,
      originalText: "RAND()",
      document: { irVersion: 1, root: { kind: "call", name: "RAND", version: 1, args: [] } },
      disposition: "frozen",
      determinism: "frozen-nondeterministic",
      dependencies: [],
    }),
    formula(84, {
      target: metric,
      originalText: "CUBEVALUE(1)",
      document: null,
      disposition: "unsupported",
      determinism: "unsupported",
      dependencies: [{ kind: "formula", formulaId: id("formula", 81) }],
    }),
    formula(85, {
      target: dashboard,
      originalText: "-[Total]%+(1-2)^3",
      document: {
        irVersion: 1,
        root: {
          kind: "binary",
          operator: "+",
          left: {
            kind: "unary",
            operator: "-",
            operand: { kind: "unary", operator: "%", operand: { kind: "formula", formulaId: id("formula", 81) } },
          },
          right: {
            kind: "binary",
            operator: "^",
            left: { kind: "binary", operator: "-", left: { kind: "literal", value: { kind: "decimal", decimal: "1" } }, right: { kind: "error", code: "#N/A" } },
            right: { kind: "literal", value: { kind: "boolean", boolean: true } },
          },
        },
      },
      dependencies: [{ kind: "formula", formulaId: id("formula", 81) }],
    }),
    formula(86, {
      target: column,
      originalText: "RELATED([Name],[Status])",
      document: {
        irVersion: 1,
        root: {
          kind: "related",
          relationshipId: id("relationship", 60),
          referenceFieldId: first!.fieldId,
          fieldId: second!.fieldId,
        },
      },
      dependencies: [
        { kind: "field", fieldId: first!.fieldId },
        { kind: "field", fieldId: second!.fieldId },
      ],
    }),
  ].map((entry) => ({
    ...entry,
    metadata: {
      catalogVersion: 1,
      functionVersions: [{ name: "SUM", version: 1 }],
      source: "imported",
      importedValuePolicy: "kept-as-literal",
    },
  }));

  it("round-trips a formula of every target × disposition byte-identically (CA-25)", () => {
    const manifest = { ...decodeCheckpointManifest(f03), formulas: every };
    const encoded = encodeCheckpointManifest(manifest);
    const decoded = decodeCheckpointManifest(encoded);

    expect(decoded.formulas).toEqual(every);
    expect(encodeCheckpointManifest(decoded)).toEqual(encoded);
    const pairs = new Set(decoded.formulas.map(({ formula: entry }) => `${entry.target.kind}/${entry.disposition}`));
    for (const target of ["computed-column", "table-metric", "dashboard-value"]) {
      expect([...pairs].some((pair) => pair.startsWith(`${target}/`)), target).toBe(true);
    }
    for (const disposition of ["live", "frozen", "unsupported"]) {
      expect([...pairs].some((pair) => pair.endsWith(`/${disposition}`)), disposition).toBe(true);
    }
  });

  it("writes the F04 key set, and refuses a key set that is none of the three", () => {
    const f04 = encodeCheckpointManifest(decodeCheckpointManifest(f03));
    expect([...(decodeCanonical(f04) as ReadonlyMap<string, unknown>).keys()]).toContain("formulas");

    // F03 plus a stray formula-like key, or F04 missing another root.
    expect(() => decodeCheckpointManifest(withF03Keys(f03, (map) => map.set("formula", [])))).toThrow(CodecError);
    expect(() => decodeCheckpointManifest(withF03Keys(f04, (map) => map.delete("importLineages")))).toThrow(CodecError);
  });

  it("refuses a formula whose disposition and determinism are not a legal pair, or a live one without IR", () => {
    const illegal = { ...every[0]!, formula: { ...every[0]!.formula, determinism: "unsupported" as const } };
    expect(() =>
      decodeCheckpointManifest(encodeCheckpointManifest({ ...decodeCheckpointManifest(f03), formulas: [illegal] })),
    ).toThrow(CodecError);
    const bare = { ...every[0]!, formula: { ...every[0]!.formula, document: null } };
    expect(() =>
      decodeCheckpointManifest(encodeCheckpointManifest({ ...decodeCheckpointManifest(f03), formulas: [bare] })),
    ).toThrow(CodecError);
    const headless = { ...every[1]!, formula: { ...every[1]!.formula, target: { kind: "table-metric" as const, tableId: null as never } } };
    expect(() =>
      decodeCheckpointManifest(encodeCheckpointManifest({ ...decodeCheckpointManifest(f03), formulas: [headless] })),
    ).toThrow(CodecError);
  });

  it("carries formulaId on a computed field only, and reads both shapes back (D51)", () => {
    const authored = first!;
    const computed = { ...second!, formulaId: id("formula", 80) };

    expect([...(decodeCanonical(encodeCanonical(encodeFieldDef(authored))) as ReadonlyMap<string, unknown>).keys()]).not.toContain(
      "formulaId",
    );
    expect(decodeFieldDef(decodeCanonical(encodeCanonical(encodeFieldDef(authored))))).toEqual(authored);
    expect(decodeFieldDef(decodeCanonical(encodeCanonical(encodeFieldDef(computed))))).toEqual(computed);
  });

  it("round-trips rule IR v1 and v2, and refuses a v2 condition inside a v1 rule (CA-27)", () => {
    const v2: ValidationRuleIRV2 = {
      irVersion: 2,
      ruleId: id("rule", 90),
      condition: {
        kind: "all",
        conditions: [
          { kind: "compare", left: first!.fieldId, op: "le", right: { field: second!.fieldId } },
          { kind: "compare", left: first!.fieldId, op: "gt", right: { value: decimalValue("10.5") }, measure: "text-length" },
          { kind: "between", fieldId: second!.fieldId, low: dateValue(1), high: dateValue(40) },
          { kind: "not", condition: { kind: "not-between", fieldId: second!.fieldId, low: dateValue(2), high: dateValue(3) } },
        ],
      },
      severity: "blocking",
      messageKey: "rule-compare",
      messageParameters: { leftLabel: "Start", rightLabel: "Finish" },
    };
    const v1 = decodeCheckpointManifest(f03).validationRules[0]!.rule;
    for (const rule of [v1, v2]) {
      const bytes = encodeCanonical(encodeRuleIR(rule));
      expect(decodeRuleIR(decodeCanonical(bytes))).toEqual(rule);
    }
    const smuggled = new Map(decodeCanonical(encodeCanonical(encodeRuleIR(v2))) as ReadonlyMap<string, unknown>);
    smuggled.set("irVersion", 1n);
    expect(() => decodeRuleIR(smuggled as never)).toThrow(CodecError);
  });
});

describe("checkpoint manifest evolution, charts (CA-30)", () => {
  const f03 = fromHex(F03_CHECKPOINT_HEX);
  const common = {
    chartVersion: 1 as const,
    tableId: TABLE,
    pinned: true,
  };
  /** Every type, grouping kind, measure kind and filter operand kind at least once. */
  const every: readonly ChartDefinitionV1[] = [
    {
      ...common,
      chartId: id("chart", 100),
      name: "Quoted by status",
      filters: [
        { fieldId: FIELD, operand: { kind: "enum-in", optionIds: [id("option", 3)] } },
        { fieldId: FIELD, operand: { kind: "date-range", from: -40, to: null } },
        { fieldId: FIELD, operand: { kind: "number-range", min: null, max: "10.50" } },
        { fieldId: FIELD, operand: { kind: "boolean-is", value: false } },
        { fieldId: FIELD, operand: { kind: "reference-in", recordIds: [id("record", 4), id("record", 5)] } },
        { fieldId: FIELD, operand: { kind: "reference-broken" } },
        { fieldId: FIELD, operand: { kind: "text-contains", text: "café" } },
        { fieldId: FIELD, operand: { kind: "text-equals", text: "North" } },
        { fieldId: FIELD, operand: { kind: "is-empty" } },
        { fieldId: FIELD, operand: { kind: "not-empty" } },
      ],
      type: "bar",
      groupBy: { kind: "field", fieldId: FIELD },
      seriesBy: null,
      measure: { kind: "sum", fieldId: FIELD },
      sort: "category",
    },
    {
      ...common,
      chartId: id("chart", 101),
      name: "Jobs by customer region",
      filters: [],
      type: "stacked",
      groupBy: { kind: "related-field", relationshipId: id("relationship", 6), referenceFieldId: FIELD, fieldId: id("field", 7) },
      seriesBy: { kind: "date", fieldId: id("field", 8), unit: "month" },
      measure: { kind: "count" },
      sort: "measure-desc",
    },
    ...(["line", "pie"] as const).map(
      (type, index): ChartDefinitionV1 => ({
        ...common,
        chartId: id("chart", 102 + index),
        name: type,
        filters: [],
        type,
        groupBy: { kind: "date", fieldId: FIELD, unit: index === 0 ? "day" : "year" },
        seriesBy: null,
        measure: { kind: index === 0 ? "average" : "min", fieldId: FIELD },
        sort: "category",
      }),
    ),
    { ...common, chartId: id("chart", 104), name: "Hours vs quoted", filters: [], pinned: false, type: "scatter", x: FIELD, y: id("field", 9) },
    {
      ...common,
      chartId: id("chart", 105),
      name: "Largest",
      filters: [],
      type: "bar",
      groupBy: { kind: "field", fieldId: FIELD },
      seriesBy: null,
      measure: { kind: "max", fieldId: FIELD },
      sort: "category",
    },
  ];
  const charts: readonly CheckpointChartV1[] = every.map((definition, ordinal) => ({
    definition,
    ordinal,
    provenance: ordinal % 2 === 0 ? "user" : "imported",
    chartRevision: BigInt(ordinal * 3),
  }));

  it("decodes F02, F03 and formula-only F04 bytes to no charts", () => {
    expect(decodeCheckpointManifest(fromHex(F02_CHECKPOINT_HEX)).charts).toEqual([]);
    expect(decodeCheckpointManifest(f03).charts).toEqual([]);
    // The shape S03 wrote: F03 plus `formulas`, no `charts`.
    const formulaOnly = withF03Keys(encodeCheckpointManifest(decodeCheckpointManifest(f03)), (map) => map.delete("charts"));
    expect([...(decodeCanonical(formulaOnly) as ReadonlyMap<string, unknown>).keys()]).toContain("formulas");
    expect(decodeCheckpointManifest(formulaOnly).charts).toEqual([]);
  });

  it("round-trips every chart type, grouping, measure and filter byte-identically", () => {
    const manifest = { ...decodeCheckpointManifest(f03), charts };
    const encoded = encodeCheckpointManifest(manifest);
    const decoded = decodeCheckpointManifest(encoded);
    expect([...(decodeCanonical(encoded) as ReadonlyMap<string, unknown>).keys()]).toContain("charts");
    expect(decoded.charts).toEqual(charts);
    expect(encodeCheckpointManifest(decoded)).toEqual(encoded);
    expect(new Set(decoded.charts.map(({ definition }) => definition.type))).toEqual(new Set(["bar", "line", "pie", "scatter", "stacked"]));
  });

  it("writes the same definition bytes the projection stores", () => {
    for (const definition of every) {
      expect(encodeProjectionChart(definition)).toEqual(encodeCanonical(encodeChartDefinition(definition)));
      expect(decodeChartDefinition(decodeCanonical(encodeProjectionChart(definition)))).toEqual(definition);
    }
  });

  it("refuses a chart type, key or version the format does not have", () => {
    const bytes = (edit: (map: Map<string, unknown>) => void): Uint8Array =>
      withF03Keys(encodeCanonical(encodeChartDefinition(every[0]!)), edit);
    expect(() => decodeChartDefinition(decodeCanonical(bytes((map) => map.set("type", "area"))))).toThrow(CodecError);
    expect(() => decodeChartDefinition(decodeCanonical(bytes((map) => map.set("x", FIELD))))).toThrow(CodecError);
    expect(() => decodeChartDefinition(decodeCanonical(bytes((map) => map.set("chartVersion", 2n))))).toThrow(CodecError);
    expect(() =>
      decodeCheckpointManifest(
        encodeCheckpointManifest({ ...decodeCheckpointManifest(f03), charts: [{ ...charts[0]!, provenance: "guessed" as never }] }),
      ),
    ).toThrow(CodecError);
  });
});

function withF03Keys(bytes: Uint8Array, edit: (map: Map<string, unknown>) => void): Uint8Array {
  const map = new Map(decodeCanonical(bytes) as ReadonlyMap<string, unknown>);
  edit(map);
  return encodeCanonical(map as never);
}
