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
  decodeRecordEventPayload,
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
import type {
  AuthoredRecordV1,
  F02DomainEventV1,
} from "../../../src/domain/model/events.js";
import type { CellValueV1 } from "../../../src/domain/model/values.js";
import {
  decodeCanonical,
  encodeCanonical,
} from "../../../src/persistence/codecs/canonical-cbor.js";

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

const EVENTS: readonly F02DomainEventV1[] = [
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

const roundTrip = (event: F02DomainEventV1): F02DomainEventV1 =>
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
    const back = roundTrip(EVENTS[0] as F02DomainEventV1);
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
    const back = roundTrip(EVENTS[0] as F02DomainEventV1);
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
    const back = roundTrip(EVENTS[1] as F02DomainEventV1);
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
    const back = roundTrip(EVENTS[2] as F02DomainEventV1);
    if (back.kind !== "record.deleted") {
      throw new Error("expected record.deleted");
    }
    expect(back.payload.restoration.values.size).toBe(FIELDS.length);
    expect(back.payload.priorRecordRevision).toBe(7n);
    expect(back.payload.source).toBe("user");
  });

  it("refuses a payload with an unexpected field", () => {
    const map = decodeCanonical(
      encodeCanonical(encodeRecordEventPayload(EVENTS[3] as F02DomainEventV1)),
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
    const older: F02DomainEventV1 = {
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
