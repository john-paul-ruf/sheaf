/**
 * The record-event payload codec: one file owns both directions (CA-08).
 *
 * A commit's hash is taken over its canonical body, payloads included — so a
 * payload that does not survive `encode ∘ decode` byte-identically makes the
 * hash meaningless, and a decoder that reads back something other than what was
 * written makes the projection's typed-event guard vacuous. Both are asserted
 * here, over values chosen to include every cell kind and all three absent
 * states.
 */

import { describe, expect, it } from "vitest";

import {
  RECORD_EVENT_KINDS,
  TAIL_EVENT_KINDS,
  decodeRecordEventPayload,
  decodeTailEventPayload,
  isTailEventKind,
  type TailEventKindV1,
  encodeAuthoredRecordBytes,
  encodeRecordEventPayload,
  isRecordEventKind,
  type RecordEventKindV1,
} from "../../../src/workers/data/record-event-payloads.js";
import {
  createDomainId,
  encodeDomainId,
  type FieldId,
} from "../../../src/domain/model/ids.js";
import { F04_CHART_EVENT_KINDS, F04_SCHEMA_EVENT_KINDS, type AuthoredRecordV1 } from "../../../src/domain/model/events.js";
import type {
  DomainEventV1,
  SchemaImpactCountsV1,
} from "../../../src/application/ports/event-repository.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedValue,
} from "../../../src/persistence/codecs/canonical-cbor.js";
import { CodecError } from "../../../src/domain/model/errors.js";
import type { TableDefV1 } from "../../../src/domain/model/schema.js";
import type { SheetDescriptorV1 } from "../../../src/domain/model/snapshots.js";
import { encodeImportEventPayload } from "../../../src/import/staging/events.js";
import { encodeSheetDescriptor } from "../../../src/import/staging/roots.js";

const entropy = {
  randomBytes: (byteLength: number): Uint8Array =>
    crypto.getRandomValues(new Uint8Array(byteLength)),
};

const TABLE_ID = createDomainId("table", entropy);
const RECORD_ID = createDomainId("record", entropy);
const OPTION_ID = createDomainId("option", entropy);
const OTHER_RECORD = createDomainId("record", entropy);

const FIELDS = Array.from({ length: 9 }, () => createDomainId("field", entropy));

/** Every cell kind, including all three distinct absent states. */
const VALUES: readonly CellValueV1[] = [
  { kind: "text", text: "North yard" },
  { kind: "decimal", decimal: "10.50" },
  { kind: "date", epochDay: 20_454 },
  { kind: "boolean", boolean: false },
  { kind: "enum", optionId: OPTION_ID },
  { kind: "reference", recordId: OTHER_RECORD },
  { kind: "missing" },
  { kind: "blank" },
  { kind: "invalid-preserved", sourceText: "about twelve" },
];

const RECORD: AuthoredRecordV1 = {
  recordId: RECORD_ID,
  tableId: TABLE_ID,
  values: new Map<FieldId, CellValueV1>(
    FIELDS.map((fieldId, index) => [fieldId, VALUES[index] as CellValueV1]),
  ),
  provenance: new Map([
    [FIELDS[0] as FieldId, { source: "user" as const }],
    [
      FIELDS[1] as FieldId,
      {
        source: "initial-import" as const,
        sourceId: createDomainId("lineage", entropy),
        sourceTimestampMs: 1_760_000_000_000n,
      },
    ],
  ]),
};

const EVENTS: readonly DomainEventV1[] = [
  { kind: "record.created", payload: { record: RECORD, importedInvalid: false } },
  {
    kind: "record.patched",
    payload: {
      recordId: RECORD_ID,
      tableId: TABLE_ID,
      recordRevision: 7n,
      changes: [
        {
          fieldId: FIELDS[0] as FieldId,
          before: { kind: "text", text: "North yard" },
          after: { kind: "blank" },
          provenance: { source: "user" },
        },
        {
          fieldId: FIELDS[8] as FieldId,
          before: { kind: "invalid-preserved", sourceText: "about twelve" },
          after: { kind: "decimal", decimal: "12" },
          provenance: { source: "user" },
        },
      ],
      resultingRecordSha256: new Uint8Array(32).fill(9),
    },
  },
  {
    kind: "record.deleted",
    payload: {
      recordId: RECORD_ID,
      tableId: TABLE_ID,
      priorRecordRevision: 7n,
      restoration: RECORD,
      source: "user",
    },
  },
  {
    kind: "record.restored",
    payload: {
      deletedEventId: createDomainId("event", entropy),
      record: RECORD,
    },
  },
];

const roundTrip = (event: DomainEventV1): DomainEventV1 =>
  decodeRecordEventPayload(
    event.kind as RecordEventKindV1,
    decodeCanonical(encodeCanonical(encodeRecordEventPayload(event))),
  );

describe("the record-event payload codec", () => {
  it("covers exactly the four kinds F02's CRUD authors", () => {
    expect([...RECORD_EVENT_KINDS]).toEqual([
      "record.created",
      "record.patched",
      "record.deleted",
      "record.restored",
    ]);
    expect(isRecordEventKind("record.patched")).toBe(true);
    expect(isRecordEventKind("app.created")).toBe(false);
    expect(EVENTS.map((event) => event.kind)).toEqual([...RECORD_EVENT_KINDS]);
  });

  it("re-encodes to the same bytes after a decode — the commit hash needs it", () => {
    for (const event of EVENTS) {
      const first = encodeCanonical(encodeRecordEventPayload(event));
      const again = encodeCanonical(
        encodeRecordEventPayload(roundTrip(event)),
      );
      expect({ kind: event.kind, bytes: [...again] }).toEqual({
        kind: event.kind,
        bytes: [...first],
      });
    }
  });

  it("reads every cell kind back as itself, absent states included", () => {
    const back = roundTrip(EVENTS[0] as DomainEventV1);
    if (back.kind !== "record.created") {
      throw new Error("expected record.created");
    }
    const values = [...back.payload.record.values];
    expect(values).toHaveLength(FIELDS.length);
    for (const [index, fieldId] of FIELDS.entries()) {
      const decoded = values.find(
        ([candidate]) => encodeDomainId(candidate) === encodeDomainId(fieldId),
      )?.[1];
      expect({ index, value: decoded }).toEqual({
        index,
        value: VALUES[index],
      });
    }
    // `missing`, `blank`, and `invalid-preserved` stayed three things.
    expect(values.filter(([, value]) => value.kind === "missing")).toHaveLength(1);
    expect(values.filter(([, value]) => value.kind === "blank")).toHaveLength(1);
    expect(
      values.filter(([, value]) => value.kind === "invalid-preserved"),
    ).toHaveLength(1);
  });

  it("keeps provenance absent where it was absent", () => {
    const back = roundTrip(EVENTS[0] as DomainEventV1);
    if (back.kind !== "record.created") {
      throw new Error("expected record.created");
    }
    const entries = [...back.payload.record.provenance];
    expect(entries).toHaveLength(2);
    // Looked up by field, not by position: the encoder sorts entries by field
    // id and those ids are random, so an index here would be a coin toss.
    const provenanceOf = (fieldId: FieldId): object =>
      entries.find(
        ([candidate]) => encodeDomainId(candidate) === encodeDomainId(fieldId),
      )?.[1] as object;

    // A `user` provenance carries no source id, and decoding must not invent
    // a null one — the domain type has no third state for it.
    expect(Object.keys(provenanceOf(FIELDS[0] as FieldId))).toEqual(["source"]);
    expect(Object.keys(provenanceOf(FIELDS[1] as FieldId)).sort()).toEqual([
      "source",
      "sourceId",
      "sourceTimestampMs",
    ]);
  });

  it("keeps both ends of every change", () => {
    const back = roundTrip(EVENTS[1] as DomainEventV1);
    if (back.kind !== "record.patched") {
      throw new Error("expected record.patched");
    }
    expect(back.payload.recordRevision).toBe(7n);
    expect(back.payload.changes).toHaveLength(2);
    expect(back.payload.changes[0]?.before).toEqual({
      kind: "text",
      text: "North yard",
    });
    expect(back.payload.changes[0]?.after).toEqual({ kind: "blank" });
    expect(back.payload.resultingRecordSha256).toHaveLength(32);
  });

  it("carries the whole record in a delete, which is what makes it recoverable", () => {
    const back = roundTrip(EVENTS[2] as DomainEventV1);
    if (back.kind !== "record.deleted") {
      throw new Error("expected record.deleted");
    }
    expect(back.payload.restoration.values.size).toBe(FIELDS.length);
    expect(back.payload.priorRecordRevision).toBe(7n);
    expect(back.payload.source).toBe("user");
  });

  it("refuses a payload with an unexpected field", () => {
    const map = decodeCanonical(
      encodeCanonical(encodeRecordEventPayload(EVENTS[3] as DomainEventV1)),
    ) as ReadonlyMap<string, unknown>;
    const tampered = new Map(map);
    tampered.set("extra", "surprise");
    expect(() =>
      decodeRecordEventPayload("record.restored", tampered as never),
    ).toThrow();
  });

  /**
   * `epochDay` is signed in the domain (`MIN_EPOCH_DAY` is -100,000,000) and
   * canonical CBOR carries a negative integer correctly, so a date before
   * 1970-01-01 must survive the round trip. It was once a recorded limit —
   * M23's `decodeCellValue` read the day with the nonnegative-integer reader —
   * and that mattered beyond this codec: the same decoder reads checkpoint
   * record pages, so an imported CSV holding an older date promoted and then
   * could not be opened again. The correction landed in
   * `src/import/staging/roots.ts`; this case now holds it.
   */
  it("records the pre-1970 date limit this codec inherits from M23", () => {
    const older: DomainEventV1 = {
      kind: "record.created",
      payload: {
        record: {
          recordId: RECORD_ID,
          tableId: TABLE_ID,
          values: new Map<FieldId, CellValueV1>([
            [FIELDS[0] as FieldId, { kind: "date", epochDay: -1_826 }],
          ]),
          provenance: new Map(),
        },
        importedInvalid: false,
      },
    };
    // Encoding is fine — canonical CBOR carries a negative integer correctly.
    expect(() => encodeRecordEventPayload(older)).not.toThrow();
    expect(() => roundTrip(older)).not.toThrow();

    const back = roundTrip(older);
    if (back.kind !== "record.created") {
      throw new Error("expected record.created");
    }
    expect([...back.payload.record.values.values()]).toEqual([
      { kind: "date", epochDay: -1_826 },
    ]);
  });

  it("hashes a record over its authored state, stably", () => {
    const first = encodeAuthoredRecordBytes(RECORD);
    const again = encodeAuthoredRecordBytes({
      ...RECORD,
      // Same values, inserted in a different order: canonical CBOR sorts, so
      // the bytes must not move.
      values: new Map([...RECORD.values].reverse()),
    });
    expect([...again]).toEqual([...first]);
  });
});

describe("an appended table's schema events, read back from a tail (CA-23)", () => {
  const sheetId = createDomainId("sheet", entropy);
  const keyField = createDomainId("field", entropy);
  const statusField = createDomainId("field", entropy);
  const option = {
    optionId: createDomainId("option", entropy),
    fieldId: statusField,
    displayLabel: "Open",
    optionOrdinal: 0,
    isActive: true,
    schemaRevision: 2n,
  };
  const table: TableDefV1 = {
    tableId: TABLE_ID,
    displayName: "Deliveries",
    tableOrdinal: 1,
    fields: [
      {
        fieldId: keyField,
        tableId: TABLE_ID,
        displayName: "Code",
        fieldOrdinal: 0,
        type: { kind: "text" },
        isRequired: false,
        isActive: true,
        schemaRevision: 2n,
      },
      {
        fieldId: statusField,
        tableId: TABLE_ID,
        displayName: "Status",
        fieldOrdinal: 1,
        type: { kind: "enum" },
        isRequired: false,
        isActive: true,
        schemaRevision: 2n,
      },
    ],
    keyFieldId: keyField,
    labelFieldId: null,
    sourceSheetId: sheetId,
    isActive: true,
    schemaRevision: 2n,
  };
  const sheet: SheetDescriptorV1 = {
    sheetId,
    displayName: "deliveries.csv",
    sheetOrdinal: 1,
    classification: ["table"],
    snapshotManifestStorageId: "AAAAAAAAAAAAAAAAAAAAAA",
    declaredRowCount: null,
    declaredColumnCount: null,
    snapshotRevision: 2n,
  };
  const roundTrip = (payload: CborValue): DecodedValue =>
    decodeCanonical(encodeCanonical(payload));

  it("accepts exactly the tail kinds and nothing else", () => {
    expect([...TAIL_EVENT_KINDS]).toEqual([
      ...RECORD_EVENT_KINDS,
      "table.created",
      "field.created",
      "enum.changed",
      "inference-decision.recorded",
      ...F04_SCHEMA_EVENT_KINDS,
      ...F04_CHART_EVENT_KINDS,
      "theme.changed",
      "durable-home.assigned",
    ]);
    expect(isTailEventKind("app.created")).toBe(false);
    expect(isTailEventKind("import.accepted")).toBe(false);
  });

  it("reads promotion's table.created, with and without the sheet descriptor", () => {
    // The shape promotion writes since F03: the descriptor rides along.
    const written = encodeImportEventPayload.tableCreated({ table, sourceSheet: sheet });
    expect(decodeTailEventPayload("table.created", roundTrip(written))).toEqual({
      kind: "table.created",
      payload: { table, sourceSheetId: sheet.sheetId, sourceSheet: sheet },
    });
    expect((written as ReadonlyMap<string, CborValue>).get("sourceSheet")).toEqual(encodeSheetDescriptor(sheet));

    // The shape F02 promotion wrote (no descriptor): the sheet reads null.
    const f02 = new Map(written as ReadonlyMap<string, CborValue>);
    f02.delete("sourceSheet");
    f02.set("sourceSheetId", sheetId);
    expect(decodeTailEventPayload("table.created", roundTrip(f02))).toEqual({
      kind: "table.created",
      payload: { table, sourceSheetId: sheetId, sourceSheet: null },
    });
  });

  it("reads field.created and enum.changed as promotion encodes them", () => {
    expect(
      decodeTailEventPayload(
        "field.created",
        roundTrip(
          encodeImportEventPayload.fieldCreated({
            field: table.fields[1]!,
            statementId: "field-type:1",
          }),
        ),
      ),
    ).toEqual({
      kind: "field.created",
      payload: { field: table.fields[1], evidence: "field-type:1" },
    });
    expect(
      decodeTailEventPayload(
        "enum.changed",
        roundTrip(
          encodeImportEventPayload.enumChanged({
            fieldId: statusField,
            priorOptionSetSha256: null,
            options: [option],
          }),
        ),
      ),
    ).toEqual({
      kind: "enum.changed",
      payload: { fieldId: statusField, priorOptionSetSha256: null, options: [option] },
    });
  });

  it("refuses a table.created with a stray field", () => {
    expect(() =>
      decodeTailEventPayload(
        "table.created",
        roundTrip(
          new Map<string, CborValue>([
            ...(encodeImportEventPayload.tableCreated({
              table,
              sourceSheet: sheet,
            }) as ReadonlyMap<string, CborValue>),
            ["extra", 1n],
          ]),
        ),
      ),
    ).toThrow(CodecError);
  });
});

describe("the F04 schema, rule and formula payloads (CA-25, CA-27, CA-28)", () => {
  const fieldId = FIELDS[0] as FieldId;
  const otherField = FIELDS[1] as FieldId;
  const formulaId = createDomainId("formula", entropy);
  const relationshipId = createDomainId("relationship", entropy);
  const ruleId = createDomainId("rule", entropy);
  const impact: SchemaImpactCountsV1 = {
    change: "change-field-type",
    total: 60,
    affected: 3,
    unchanged: 57,
    converted: 1,
    keptAndFlagged: 2,
    missingNow: 0,
    onRemovedOptions: 0,
    matchedKeys: 0,
    unmatchedKeys: 0,
    unlinkedReferences: 0,
    failingRule: 0,
    formulaErrors: 0,
  };
  const field = {
    fieldId,
    tableId: TABLE_ID,
    displayName: "Quoted amount",
    fieldOrdinal: 4,
    type: { kind: "number" as const },
    isRequired: false,
    isActive: true,
    schemaRevision: 1n,
  };
  const tableDefinition = {
    tableId: TABLE_ID,
    displayName: "Jobs",
    tableOrdinal: 0,
    keyFieldId: fieldId,
    labelFieldId: null,
    sourceSheetId: null,
    isActive: true,
    schemaRevision: 1n,
  };
  const relationship = {
    relationshipId,
    fromTableId: TABLE_ID,
    fromFieldId: otherField,
    toTableId: TABLE_ID,
    toKeyFieldId: fieldId,
    detectionSource: "user" as const,
    isActive: true,
    schemaRevision: 2n,
  };
  const formula = {
    formulaId,
    target: { kind: "computed-column" as const, tableId: TABLE_ID, fieldId: otherField },
    displayName: null,
    originalText: "[Quoted amount]-[Paid]",
    document: {
      irVersion: 1 as const,
      root: {
        kind: "binary" as const,
        operator: "-" as const,
        left: { kind: "field" as const, fieldId },
        right: { kind: "field" as const, fieldId: FIELDS[2] as FieldId },
      },
    },
    disposition: "live" as const,
    determinism: "deterministic" as const,
    dependencies: [
      { kind: "field" as const, fieldId },
      { kind: "field" as const, fieldId: FIELDS[2] as FieldId },
    ],
  };
  const metadata = {
    catalogVersion: 1,
    functionVersions: [],
    source: "authored" as const,
    importedValuePolicy: "none" as const,
  };
  const digest = new Uint8Array(32).fill(4);

  const SCHEMA_EVENTS: readonly DomainEventV1[] = [
    { kind: "app.renamed", payload: { priorNameSha256: digest, displayName: "Fieldwork" } },
    {
      kind: "table.changed",
      payload: {
        priorSha256: digest,
        before: tableDefinition,
        after: { ...tableDefinition, displayName: "Jobs 2026", labelFieldId: otherField },
        impact: { ...impact, change: "rename-table", affected: 0, converted: 0, keptAndFlagged: 0, unchanged: 60 },
      },
    },
    {
      kind: "field.changed",
      payload: {
        before: field,
        after: { ...field, type: { kind: "currency", currencyCode: "EUR" }, schemaRevision: 2n },
        impact,
      },
    },
    { kind: "relationship.changed", payload: { relationship, priorSha256: null } },
    { kind: "relationship.changed", payload: { relationship: { ...relationship, isActive: false }, priorSha256: digest } },
    { kind: "relationship.removed", payload: { relationship, rejectionFingerprint: digest } },
    {
      kind: "rule.changed",
      payload: {
        tableId: TABLE_ID,
        displayName: "Finish after start",
        rule: {
          irVersion: 2,
          ruleId,
          condition: { kind: "compare", left: fieldId, op: "ge", right: { field: otherField } },
          severity: "blocking",
          messageKey: "rule-compare",
          messageParameters: { leftLabel: "Finish", rightLabel: "Start" },
        },
        priorSha256: null,
      },
    },
    {
      kind: "rule.removed",
      payload: {
        tableId: TABLE_ID,
        displayName: "Name present",
        rule: {
          irVersion: 1,
          ruleId,
          condition: { kind: "field-present", fieldId },
          severity: "warning",
          messageKey: "validation.rule",
          messageParameters: {},
        },
        impact: { ...impact, change: "remove-rule" },
      },
    },
    { kind: "formula.changed", payload: { formula, metadata, priorSha256: null } },
    { kind: "formula.removed", payload: { formula, metadata, impact: { ...impact, change: "remove-formula" } } },
  ];

  const decodeWire = (event: DomainEventV1): DomainEventV1 =>
    decodeTailEventPayload(
      event.kind as (typeof TAIL_EVENT_KINDS)[number],
      decodeCanonical(encodeCanonical(encodeRecordEventPayload(event))),
    );

  it("covers all nine kinds, and reads each back as itself, byte-identically", () => {
    expect(new Set(SCHEMA_EVENTS.map((event) => event.kind))).toEqual(new Set(F04_SCHEMA_EVENT_KINDS));
    for (const event of SCHEMA_EVENTS) {
      const bytes = encodeCanonical(encodeRecordEventPayload(event));
      const back = decodeWire(event);
      expect({ kind: event.kind, back }).toEqual({ kind: event.kind, back: event });
      expect([...encodeCanonical(encodeRecordEventPayload(back))]).toEqual([...bytes]);
    }
  });

  it("keeps a currency code across a field.changed round trip", () => {
    const back = decodeWire(SCHEMA_EVENTS[2] as DomainEventV1);
    expect(back.kind === "field.changed" && back.payload.after.type).toEqual({ kind: "currency", currencyCode: "EUR" });
  });

  it("encodes a command's field.created exactly as promotion does, formulaId included when computed", () => {
    const created: DomainEventV1 = { kind: "field.created", payload: { field, evidence: null } };
    expect([...encodeCanonical(encodeRecordEventPayload(created))]).toEqual([
      ...encodeCanonical(encodeImportEventPayload.fieldCreated({ field, statementId: null })),
    ]);
    const computed: DomainEventV1 = {
      kind: "field.created",
      payload: { field: { ...field, fieldId: otherField, formulaId }, evidence: null },
    };
    expect(decodeWire(computed)).toEqual(computed);
  });

  it("refuses a stray key, an unknown change kind, and the import commit's own kinds", () => {
    const tampered = new Map(
      decodeCanonical(encodeCanonical(encodeRecordEventPayload(SCHEMA_EVENTS[0] as DomainEventV1))) as ReadonlyMap<string, unknown>,
    );
    tampered.set("extra", 1n);
    expect(() => decodeTailEventPayload("app.renamed", tampered as never)).toThrow(CodecError);

    const wrongChange = new Map(
      decodeCanonical(encodeCanonical(encodeRecordEventPayload(SCHEMA_EVENTS[9] as DomainEventV1))) as ReadonlyMap<string, unknown>,
    );
    wrongChange.set("impact", new Map([...(wrongChange.get("impact") as ReadonlyMap<string, unknown>), ["change", "recalculate"]]));
    expect(() => decodeTailEventPayload("formula.removed", wrongChange as never)).toThrow(CodecError);

    expect(() =>
      encodeRecordEventPayload({ kind: "theme.changed", payload: { before: null, after: { themeKey: "k", tokens: {} as never } } }),
    ).toThrow(CodecError);
  });

  it("holds no evaluated value in a formula payload (invariant 7)", () => {
    const map = decodeCanonical(
      encodeCanonical(encodeRecordEventPayload(SCHEMA_EVENTS[8] as DomainEventV1)),
    ) as ReadonlyMap<string, unknown>;
    expect([...map.keys()].sort()).toEqual(["formula", "metadata", "priorSha256"]);
    expect([...(map.get("formula") as ReadonlyMap<string, unknown>).keys()].sort()).toEqual([
      "dependencies",
      "determinism",
      "displayName",
      "disposition",
      "document",
      "formulaId",
      "originalText",
      "target",
    ]);
  });
});

describe("a frozen literal's provenance (D51)", () => {
  it("carries the formula text it was frozen from, and still reads the three-key form", () => {
    const fieldId = FIELDS[0] as FieldId;
    const event: DomainEventV1 = {
      kind: "record.patched",
      payload: {
        recordId: RECORD_ID,
        tableId: TABLE_ID,
        recordRevision: 2n,
        changes: [
          {
            fieldId,
            before: { kind: "missing" },
            after: { kind: "decimal", decimal: "0.37" },
            provenance: { source: "user", evidence: { frozen: "RAND()" } },
          },
        ],
        resultingRecordSha256: new Uint8Array(32).fill(3),
      },
    };
    const back = roundTrip(event);
    expect(back.kind === "record.patched" && back.payload.changes[0]?.provenance).toEqual({
      source: "user",
      evidence: { frozen: "RAND()" },
    });
    // An F02/F03 patch has no evidence key, and decodes exactly as before.
    const plain = roundTrip(EVENTS[1] as DomainEventV1);
    expect(plain.kind === "record.patched" && Object.keys(plain.payload.changes[0]!.provenance)).toEqual(["source"]);
  });
});

describe("the chart payloads (CA-30)", () => {
  const chartId = createDomainId("chart", entropy);
  const tableId = createDomainId("table", entropy);
  const fieldId = createDomainId("field", entropy);
  const state = {
    definition: {
      chartVersion: 1 as const,
      chartId,
      name: "Quoted by status",
      tableId,
      filters: [{ fieldId, operand: { kind: "not-empty" as const } }],
      pinned: true,
      type: "bar" as const,
      groupBy: { kind: "field" as const, fieldId },
      seriesBy: null,
      measure: { kind: "sum" as const, fieldId },
      sort: "category" as const,
    },
    displayName: "Quoted by status",
    pinned: true,
    ordinal: 3,
    provenance: "imported" as const,
    chartRevision: 2n,
  };
  const events: readonly DomainEventV1[] = [
    { kind: "chart.saved", payload: { chartId, ...state, priorSha256: new Uint8Array(32).fill(7) } },
    { kind: "chart.saved", payload: { chartId, ...state, chartRevision: 0n, priorSha256: null } },
    { kind: "chart.deleted", payload: { chartId, prior: state } },
  ];
  const read = (event: DomainEventV1): DomainEventV1 =>
    decodeTailEventPayload(event.kind as TailEventKindV1, decodeCanonical(encodeCanonical(encodeRecordEventPayload(event))));

  it("reads each back as itself, byte-identically, as a tail kind", () => {
    for (const event of events) {
      expect(isTailEventKind(event.kind)).toBe(true);
      expect(read(event)).toEqual(event);
      expect(encodeCanonical(encodeRecordEventPayload(read(event)))).toEqual(encodeCanonical(encodeRecordEventPayload(event)));
    }
  });

  it("refuses a payload whose name, pin or id disagrees with its own definition", () => {
    const saved = events[0]!;
    if (saved.kind !== "chart.saved") throw new Error("fixture");
    for (const payload of [
      { ...saved.payload, displayName: "Something else" },
      { ...saved.payload, pinned: false },
      { ...saved.payload, chartId: createDomainId("chart", entropy) },
    ]) {
      const bytes = encodeCanonical(encodeRecordEventPayload({ kind: "chart.saved", payload }));
      expect(() => decodeTailEventPayload("chart.saved", decodeCanonical(bytes))).toThrow(CodecError);
    }
  });
});


describe("durable home assignment (CA-34)", () => {
  it("round trips the identity and rejects an unsupported wrap or home kind", () => {
    const event: DomainEventV1 = { kind: "durable-home.assigned", payload: {
      homeId: createDomainId("home", entropy), vaultId: createDomainId("vault", entropy),
      homeKind: "bundle", wrappedAppKeyVersion: 1,
    } };
    const value = decodeCanonical(encodeCanonical(encodeRecordEventPayload(event)));
    expect(decodeTailEventPayload("durable-home.assigned", value)).toEqual(event);
    for (const [key, bad] of [["wrappedAppKeyVersion", 2n], ["homeKind", "unknown"]] as const) {
      const changed = new Map(value as ReadonlyMap<string, CborValue>);
      changed.set(key, bad);
      expect(() => decodeTailEventPayload("durable-home.assigned", decodeCanonical(encodeCanonical(changed)))).toThrow(CodecError);
    }
  });
});
