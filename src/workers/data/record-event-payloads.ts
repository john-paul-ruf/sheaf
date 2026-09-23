/**
 * The semantic payload ↔ canonical CBOR mapping for the four record events
 * F02's CRUD authors (M33; CA-08 producer, CA-13 consumer), and the read half
 * of the schema events an appended table's commit carries (CA-23, D38).
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
 * The append commit's `table.created`, `field.created`, `enum.changed`, and
 * `inference-decision.recorded` payloads are written by promotion
 * (`src/import/staging/events.ts`), which owns their encoding; this file owns
 * reading them back when that commit is replayed after a restart. Their table,
 * field, option, and sheet shapes are M23's `roots.ts` codecs, so a definition
 * reads the same from a checkpoint and from an event. A `table.created` written
 * before F03 carries no `sourceSheet` and reads as `null`.
 *
 * F04's schema, rule and formula kinds are mapped by `schema-event-payloads.ts`
 * and its chart kinds by `chart-event-payloads.ts`, both dispatched from here, so {@link encodeRecordEventPayload} is still the one
 * function the event store derives every authored payload from. A schema
 * command's `field.created` (a new computed column carries its `formulaId`)
 * and `enum.changed` are encoded here with the same M23 definitions promotion
 * uses, so both writers produce payloads one reader can decode.
 *
 * The cell-value mapping is **M23's own** (`encodeCellValue`/`decodeCellValue`),
 * not a second copy: a value stored in a checkpoint record page and the same
 * value carried in a patch event must decode to the same thing, and one
 * function is the only way to guarantee that.
 */

import { CodecError } from "../../domain/model/errors.js";
import type { DomainEventV1 } from "../../application/ports/event-repository.js";
import {
  F04_CHART_EVENT_KINDS,
  F04_SCHEMA_EVENT_KINDS,
  type AuthoredRecordV1,
  type F04SchemaEventKindV1,
  type FieldChangeV1,
  type RecordCreatedPayloadV1,
  type RecordDeletedPayloadV1,
  type RecordPatchedPayloadV1,
  type RecordRestoredPayloadV1,
} from "../../domain/model/events.js";
import {
  APP_THEME_TOKENS,
  DELETION_SOURCES,
  INFERENCE_DISPOSITIONS,
  isThemeColor,
  type AppThemeV1,
} from "../../domain/model/events.js";
import type { FieldId } from "../../domain/model/ids.js";
import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import {
  PROVENANCE_SOURCES,
  type ValueProvenanceV1,
} from "../../domain/model/provenance.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import {
  decodeAppTheme,
  decodeCellValue,
  decodeEnumOption,
  decodeFieldDef,
  decodeSheetDescriptor,
  decodeTableDef,
  encodeAppTheme,
  encodeCellValue,
  encodeEnumOption,
  encodeFieldDef,
} from "../../import/staging/roots.js";
import { decodeChartEventPayload, encodeChartEventPayload } from "./chart-event-payloads.js";
import { decodeSchemaEventPayload, encodeSchemaEventPayload } from "./schema-event-payloads.js";
import {
  asMap,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
  list,
  nfcText,
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

/**
 * Every kind a tail commit may carry: CRUD, an appended table's schema, and
 * F04's schema, rule, formula, chart and theme edits.
 */
export const TAIL_EVENT_KINDS = Object.freeze([
  ...RECORD_EVENT_KINDS,
  "table.created",
  "field.created",
  "enum.changed",
  "inference-decision.recorded",
  ...F04_SCHEMA_EVENT_KINDS,
  ...F04_CHART_EVENT_KINDS,
  "theme.changed",
] as const);

export type TailEventKindV1 = (typeof TAIL_EVENT_KINDS)[number];

export function isTailEventKind(kind: string): kind is TailEventKindV1 {
  return (TAIL_EVENT_KINDS as readonly string[]).includes(kind);
}

// --------------------------------------------------------------- provenance --

/**
 * The one evidence a command writes on a value (D51): a frozen formula's
 * literal names the formula text it was evaluated from, which is what lets
 * the validator accept that one user write to a computed field. It travels
 * as `evidence: {frozen}`; a provenance without it keeps the three keys it
 * always had, so every earlier payload decodes unchanged.
 */
const frozenTextOf = (evidence: unknown): string | null =>
  typeof evidence === "object" &&
  evidence !== null &&
  "frozen" in evidence &&
  typeof (evidence as { readonly frozen: unknown }).frozen === "string"
    ? (evidence as { readonly frozen: string }).frozen
    : null;

const encodeProvenance = (provenance: ValueProvenanceV1): CborValue => {
  const frozen = frozenTextOf(provenance.evidence);
  return cborMap([
    ["source", provenance.source],
    ["sourceId", provenance.sourceId ?? null],
    [
      "sourceTimestampMs",
      provenance.sourceTimestampMs === undefined
        ? null
        : provenance.sourceTimestampMs,
    ],
    ...(frozen === null ? [] : [["evidence", cborMap([["frozen", frozen]])] as const]),
  ]);
};

const decodeProvenance = (value: DecodedValue): ValueProvenanceV1 => {
  const raw = asMap(value, "a value provenance");
  const map = exactKeys(
    raw,
    raw.has("evidence")
      ? ["source", "sourceId", "sourceTimestampMs", "evidence"]
      : ["source", "sourceId", "sourceTimestampMs"],
    "a value provenance",
  );
  const sourceId = field(map, "sourceId");
  const timestamp = field(map, "sourceTimestampMs");
  const evidence = map.has("evidence")
    ? exactKeys(asMap(field(map, "evidence"), "value evidence"), ["frozen"], "value evidence")
    : null;
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
    ...(evidence === null ? {} : { evidence: { frozen: nfcText(field(evidence, "frozen"), "frozen formula text") } }),
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

/**
 * The wire payload for one authored event: a record event, a schema
 * command's `field.created`/`enum.changed`, or an F04 schema event. The
 * import commit's kinds are promotion's to write and are refused here.
 */
export function encodeRecordEventPayload(event: DomainEventV1): CborValue {
  switch (event.kind) {
    case "field.created":
      return cborMap([
        ["field", encodeFieldDef(event.payload.field)],
        ["evidence", event.payload.evidence as CborValue],
      ]);
    case "enum.changed":
      return cborMap([
        ["fieldId", event.payload.fieldId],
        ["priorOptionSetSha256", event.payload.priorOptionSetSha256],
        ["options", event.payload.options.map(encodeEnumOption)],
      ]);
    case "app.renamed":
    case "table.changed":
    case "field.changed":
    case "relationship.changed":
    case "relationship.removed":
    case "rule.changed":
    case "rule.removed":
    case "formula.changed":
    case "formula.removed":
      return encodeSchemaEventPayload(event);
    case "chart.saved":
    case "chart.deleted":
      return encodeChartEventPayload(event);
    case "theme.changed":
      return cborMap([
        ["before", event.payload.before === null ? null : encodeTheme(event.payload.before)],
        ["after", encodeTheme(event.payload.after)],
      ]);
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
      throw new CodecError("this event kind is not one a command authors");
  }
}

/** A theme a command writes names every token as a colour (CA-32). */
function encodeTheme(theme: AppThemeV1): CborValue {
  for (const token of APP_THEME_TOKENS) {
    const value = theme.tokens[token] as string | undefined;
    if (value === undefined || !isThemeColor(value)) {
      throw new CodecError("a theme token is not a colour");
    }
  }
  return encodeAppTheme(theme);
}

/**
 * Reads a decoded payload back into the typed event its kind names. A commit
 * decoded from storage carries `unknown`; this is what turns it into something
 * the projection can be handed alongside the commit itself.
 */
export function decodeRecordEventPayload(
  kind: RecordEventKindV1,
  payload: DecodedValue,
): DomainEventV1 {
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

/**
 * Reads any tail event back into its typed form. Record events go through
 * {@link decodeRecordEventPayload}; the schema events use M23's definitions.
 */
export function decodeTailEventPayload(
  kind: TailEventKindV1,
  payload: DecodedValue,
): DomainEventV1 {
  if (isSchemaEventKind(kind)) {
    return decodeSchemaEventPayload(kind, payload);
  }
  switch (kind) {
    case "chart.saved":
    case "chart.deleted":
      return decodeChartEventPayload(kind, payload);
    case "theme.changed": {
      const map = exactKeys(asMap(payload, "a theme.changed payload"), ["before", "after"], "a theme.changed payload");
      const before = field(map, "before");
      return {
        kind,
        payload: {
          before: before === null ? null : decodeAppTheme(before),
          after: decodeAppTheme(field(map, "after")),
        },
      };
    }
    case "record.created":
    case "record.patched":
    case "record.deleted":
    case "record.restored":
      return decodeRecordEventPayload(kind, payload);
    case "table.created": {
      const map = asMap(payload, "a table.created payload");
      const withSheet = map.has("sourceSheet");
      exactKeys(
        map,
        withSheet ? ["table", "sourceSheetId", "sourceSheet"] : ["table", "sourceSheetId"],
        "a table.created payload",
      );
      const sourceSheetId = field(map, "sourceSheetId");
      const sourceSheet = withSheet ? field(map, "sourceSheet") : null;
      return {
        kind,
        payload: {
          table: decodeTableDef(field(map, "table")),
          sourceSheetId:
            sourceSheetId === null
              ? null
              : asDomainId("sheet", bytesOfLength(sourceSheetId, ID_BYTES, "a sheet id")),
          sourceSheet: sourceSheet === null ? null : decodeSheetDescriptor(sourceSheet),
        },
      };
    }
    case "field.created": {
      const map = exactKeys(
        asMap(payload, "a field.created payload"),
        ["field", "evidence"],
        "a field.created payload",
      );
      return {
        kind,
        payload: { field: decodeFieldDef(field(map, "field")), evidence: field(map, "evidence") },
      };
    }
    case "enum.changed": {
      const map = exactKeys(
        asMap(payload, "an enum.changed payload"),
        ["fieldId", "priorOptionSetSha256", "options"],
        "an enum.changed payload",
      );
      const prior = field(map, "priorOptionSetSha256");
      return {
        kind,
        payload: {
          fieldId: fieldIdOf(field(map, "fieldId")),
          priorOptionSetSha256:
            prior === null ? null : bytesOfLength(prior, SHA256_BYTES, "an option-set digest"),
          options: list(field(map, "options"), "enum options").map(decodeEnumOption),
        },
      };
    }
    case "inference-decision.recorded": {
      const map = exactKeys(
        asMap(payload, "an inference-decision.recorded payload"),
        ["evidenceFingerprint", "statement", "evidence", "disposition"],
        "an inference-decision.recorded payload",
      );
      return {
        kind,
        payload: {
          evidenceFingerprint: bytesOfLength(
            field(map, "evidenceFingerprint"),
            SHA256_BYTES,
            "an evidence fingerprint",
          ),
          statement: field(map, "statement"),
          evidence: field(map, "evidence"),
          disposition: oneOf(
            field(map, "disposition"),
            INFERENCE_DISPOSITIONS,
            "a decision disposition",
          ),
        },
      };
    }
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function isSchemaEventKind(kind: TailEventKindV1): kind is F04SchemaEventKindV1 {
  return (F04_SCHEMA_EVENT_KINDS as readonly string[]).includes(kind);
}

function bytes32(value: Uint8Array, what: string): Uint8Array {
  if (value.byteLength !== SHA256_BYTES) {
    throw new CodecError(`${what} must be 32 bytes`);
  }
  return value;
}
