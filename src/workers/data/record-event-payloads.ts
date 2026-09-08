/**
 * The semantic payload ↔ canonical CBOR mapping for the four record events
 * F02's CRUD authors (M33; CA-08 producer, CA-13 consumer).
 *
 * M09 carries `DomainEventV1.payload` as **opaque** canonical CBOR, so the
 * author of a commit owns what it means. `src/import/staging/events.ts` is that
 * author for the import commit; this file is it for `record.created`,
 * `record.patched`, `record.deleted`, and `record.restored`.
 *
 * Both halves live here on purpose. The encoder runs when a command is written
 * and the decoder runs when the tail is replayed after a restart, and the
 * agreement S02's guards check — typed events matching the commit they ride on
 * — is only real if one file owns both directions. `encode∘decode` is asserted
 * to be identity in `tests/unit/workers/record-event-payloads.test.ts`.
 *
 * The cell-value mapping is **M23's own** (`encodeCellValue`/`decodeCellValue`),
 * not a second copy: a value stored in a checkpoint record page and the same
 * value carried in a patch event must decode to the same thing, and one
 * function is the only way to guarantee that.
 */

import { CodecError } from "../../domain/model/errors.js";
import type {
  AuthoredRecordV1,
  F02DomainEventV1,
  FieldChangeV1,
  RecordCreatedPayloadV1,
  RecordDeletedPayloadV1,
  RecordPatchedPayloadV1,
  RecordRestoredPayloadV1,
} from "../../domain/model/events.js";
import { DELETION_SOURCES } from "../../domain/model/events.js";
import type { FieldId } from "../../domain/model/ids.js";
import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import {
  PROVENANCE_SOURCES,
  type ValueProvenanceV1,
} from "../../domain/model/provenance.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import { decodeCellValue, encodeCellValue } from "../../import/staging/roots.js";
import {
  asMap,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
  list,
  oneOf,
} from "../../import/staging/proposal-codec.js";
import {
  encodeCanonical,
  type CborValue,
  type DecodedValue,
} from "../../persistence/codecs/canonical-cbor.js";

const ID_BYTES = 16;
const SHA256_BYTES = 32;

/** The record event kinds this module maps; nothing else reaches it. */
export const RECORD_EVENT_KINDS = Object.freeze([
  "record.created",
  "record.patched",
  "record.deleted",
  "record.restored",
] as const);

export type RecordEventKindV1 = (typeof RECORD_EVENT_KINDS)[number];

export function isRecordEventKind(kind: string): kind is RecordEventKindV1 {
  return (RECORD_EVENT_KINDS as readonly string[]).includes(kind);
}

// --------------------------------------------------------------- provenance --

const encodeProvenance = (provenance: ValueProvenanceV1): CborValue =>
  cborMap([
    ["source", provenance.source],
    ["sourceId", provenance.sourceId ?? null],
    [
      "sourceTimestampMs",
      provenance.sourceTimestampMs === undefined
        ? null
        : provenance.sourceTimestampMs,
    ],
  ]);

const decodeProvenance = (value: DecodedValue): ValueProvenanceV1 => {
  const map = exactKeys(
    asMap(value, "a value provenance"),
    ["source", "sourceId", "sourceTimestampMs"],
    "a value provenance",
  );
  const sourceId = field(map, "sourceId");
  const timestamp = field(map, "sourceTimestampMs");
  return {
    source: oneOf(field(map, "source"), PROVENANCE_SOURCES, "a provenance source"),
    // Absent stays absent: a null here would be a third state the domain type
    // does not have.
    ...(sourceId === null
      ? {}
      : { sourceId: asDomainId("lineage", bytesOfLength(sourceId, ID_BYTES, "a source id")) }),
    ...(timestamp === null
      ? {}
      : { sourceTimestampMs: BigInt(count(timestamp, "a source timestamp")) }),
  };
};

// ------------------------------------------------------------ authored record --

/**
 * Field entries are sorted by field id, bytewise. Canonical CBOR sorts *map*
 * keys, but a domain id cannot be a map key, so these are arrays — and an array
 * keeps the order it was given. Without this sort the same record would encode
 * differently depending on which order a caller happened to build its `Map` in,
 * which would make `resultingRecordSha256` a hash of a spelling rather than of
 * a record.
 */
const byFieldId = <T>(
  entries: Iterable<readonly [FieldId, T]>,
): readonly (readonly [FieldId, T])[] =>
  [...entries].sort(([left], [right]) => compareDomainIds(left, right));

const encodeAuthoredRecord = (record: AuthoredRecordV1): CborValue =>
  cborMap([
    ["recordId", record.recordId],
    ["tableId", record.tableId],
    [
      "values",
      byFieldId(record.values).map(([fieldId, value]) =>
        cborMap([
          ["fieldId", fieldId],
          ["value", encodeCellValue(value)],
        ]),
      ),
    ],
    [
      "provenance",
      byFieldId(record.provenance).map(([fieldId, provenance]) =>
        cborMap([
          ["fieldId", fieldId],
          ["provenance", encodeProvenance(provenance)],
        ]),
      ),
    ],
  ]);

const decodeAuthoredRecord = (value: DecodedValue): AuthoredRecordV1 => {
  const map = exactKeys(
    asMap(value, "an authored record"),
    ["recordId", "tableId", "values", "provenance"],
    "an authored record",
  );
  const values = new Map<FieldId, CellValueV1>();
  for (const entry of list(field(map, "values"), "record values")) {
    const cell = exactKeys(
      asMap(entry, "a record value"),
      ["fieldId", "value"],
      "a record value",
    );
    values.set(fieldIdOf(field(cell, "fieldId")), decodeCellValue(field(cell, "value")));
  }
  const provenance = new Map<FieldId, ValueProvenanceV1>();
  for (const entry of list(field(map, "provenance"), "record provenance")) {
    const item = exactKeys(
      asMap(entry, "a provenance entry"),
      ["fieldId", "provenance"],
      "a provenance entry",
    );
    provenance.set(
      fieldIdOf(field(item, "fieldId")),
      decodeProvenance(field(item, "provenance")),
    );
  }
  return {
    recordId: asDomainId("record", bytesOfLength(field(map, "recordId"), ID_BYTES, "a record id")),
    tableId: asDomainId("table", bytesOfLength(field(map, "tableId"), ID_BYTES, "a table id")),
    values,
    provenance,
  };
};

/**
 * The canonical bytes of a record's authored state. `record.patched` folds
 * their digest into its payload, so a reader can tell whether the record it
 * holds is the one the patch produced.
 */
export function encodeAuthoredRecordBytes(record: AuthoredRecordV1): Uint8Array {
  return encodeCanonical(encodeAuthoredRecord(record));
}

const fieldIdOf = (value: DecodedValue): FieldId =>
  asDomainId("field", bytesOfLength(value, ID_BYTES, "a field id"));

// ------------------------------------------------------------------ changes --

const encodeChange = (change: FieldChangeV1): CborValue =>
  cborMap([
    ["fieldId", change.fieldId],
    // Both ends, always: a patch that named only its result could not be read
    // backwards, and history would be a list of assertions rather than moves.
    ["before", encodeCellValue(change.before)],
    ["after", encodeCellValue(change.after)],
    ["provenance", encodeProvenance(change.provenance)],
  ]);

const decodeChange = (value: DecodedValue): FieldChangeV1 => {
  const map = exactKeys(
    asMap(value, "a field change"),
    ["fieldId", "before", "after", "provenance"],
    "a field change",
  );
  return {
    fieldId: fieldIdOf(field(map, "fieldId")),
    before: decodeCellValue(field(map, "before")),
    after: decodeCellValue(field(map, "after")),
    provenance: decodeProvenance(field(map, "provenance")),
  };
};

// ----------------------------------------------------------------- payloads --

/** The wire payload for one typed record event. */
export function encodeRecordEventPayload(event: F02DomainEventV1): CborValue {
  switch (event.kind) {
    case "record.created":
      return cborMap([
        ["record", encodeAuthoredRecord(event.payload.record)],
        ["importedInvalid", event.payload.importedInvalid],
      ]);
    case "record.patched":
      return cborMap([
        ["recordId", event.payload.recordId],
        ["tableId", event.payload.tableId],
        ["recordRevision", event.payload.recordRevision],
        ["changes", event.payload.changes.map(encodeChange)],
        [
          "resultingRecordSha256",
          bytes32(event.payload.resultingRecordSha256, "a resulting record digest"),
        ],
      ]);
    case "record.deleted":
      return cborMap([
        ["recordId", event.payload.recordId],
        ["tableId", event.payload.tableId],
        ["priorRecordRevision", event.payload.priorRecordRevision],
        ["restoration", encodeAuthoredRecord(event.payload.restoration)],
        ["source", event.payload.source],
      ]);
    case "record.restored":
      return cborMap([
        ["deletedEventId", event.payload.deletedEventId],
        ["record", encodeAuthoredRecord(event.payload.record)],
      ]);
    default:
      throw new CodecError("this event kind is not a record event");
  }
}

/**
 * Reads a decoded payload back into the typed event its kind names. A commit
 * decoded from storage carries `unknown`; this is what turns it into something
 * the projection can be handed alongside the commit itself.
 */
export function decodeRecordEventPayload(
  kind: RecordEventKindV1,
  payload: DecodedValue,
): F02DomainEventV1 {
  switch (kind) {
    case "record.created":
      return { kind, payload: decodeCreated(payload) };
    case "record.patched":
      return { kind, payload: decodePatched(payload) };
    case "record.deleted":
      return { kind, payload: decodeDeleted(payload) };
    case "record.restored":
      return { kind, payload: decodeRestored(payload) };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function decodeCreated(value: DecodedValue): RecordCreatedPayloadV1 {
  const map = exactKeys(
    asMap(value, "a record.created payload"),
    ["record", "importedInvalid"],
    "a record.created payload",
  );
  const importedInvalid = field(map, "importedInvalid");
  if (typeof importedInvalid !== "boolean") {
    throw new CodecError("importedInvalid must be a boolean");
  }
  return { record: decodeAuthoredRecord(field(map, "record")), importedInvalid };
}

function decodePatched(value: DecodedValue): RecordPatchedPayloadV1 {
  const map = exactKeys(
    asMap(value, "a record.patched payload"),
    ["recordId", "tableId", "recordRevision", "changes", "resultingRecordSha256"],
    "a record.patched payload",
  );
  return {
    recordId: asDomainId(
      "record",
      bytesOfLength(field(map, "recordId"), ID_BYTES, "a record id"),
    ),
    tableId: asDomainId(
      "table",
      bytesOfLength(field(map, "tableId"), ID_BYTES, "a table id"),
    ),
    recordRevision: BigInt(count(field(map, "recordRevision"), "a record revision")),
    changes: list(field(map, "changes"), "field changes").map(decodeChange),
    resultingRecordSha256: bytesOfLength(
      field(map, "resultingRecordSha256"),
      SHA256_BYTES,
      "a resulting record digest",
    ),
  };
}

function decodeDeleted(value: DecodedValue): RecordDeletedPayloadV1 {
  const map = exactKeys(
    asMap(value, "a record.deleted payload"),
    ["recordId", "tableId", "priorRecordRevision", "restoration", "source"],
    "a record.deleted payload",
  );
  return {
    recordId: asDomainId(
      "record",
      bytesOfLength(field(map, "recordId"), ID_BYTES, "a record id"),
    ),
    tableId: asDomainId(
      "table",
      bytesOfLength(field(map, "tableId"), ID_BYTES, "a table id"),
    ),
    priorRecordRevision: BigInt(
      count(field(map, "priorRecordRevision"), "a record revision"),
    ),
    restoration: decodeAuthoredRecord(field(map, "restoration")),
    source: oneOf(field(map, "source"), DELETION_SOURCES, "a deletion source"),
  };
}

function decodeRestored(value: DecodedValue): RecordRestoredPayloadV1 {
  const map = exactKeys(
    asMap(value, "a record.restored payload"),
    ["deletedEventId", "record"],
    "a record.restored payload",
  );
  return {
    deletedEventId: asDomainId(
      "event",
      bytesOfLength(field(map, "deletedEventId"), ID_BYTES, "an event id"),
    ),
    record: decodeAuthoredRecord(field(map, "record")),
  };
}

function bytes32(value: Uint8Array, what: string): Uint8Array {
  if (value.byteLength !== SHA256_BYTES) {
    throw new CodecError(`${what} must be 32 bytes`);
  }
  return value;
}
