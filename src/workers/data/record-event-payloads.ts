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

import type { ProjectionEvidenceEventV1, ProjectionEvidenceStateV1, ProjectionEvidenceSourceV1, ProjectionEvidenceBaselineV1, ProjectionEvidenceReportV1 } from "../../application/ports/projection.js";
import { decodeEventProvenance } from "../../persistence/codecs/event-commit.js";
import { VALIDATION_ISSUE_KINDS, VALIDATION_SEVERITIES } from "../../domain/validation/rules.js";
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
  decodeRelationship, decodeRuleIR, decodeFormulaDefinition, decodeFormulaMetadata, decodeCheckpointChart,
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
  "durable-home.assigned",
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
    case "durable-home.assigned":
      return cborMap([
        ["homeId", event.payload.homeId],
        ["homeKind", event.payload.homeKind],
        ["vaultId", event.payload.vaultId],
        ["wrappedAppKeyVersion", event.payload.wrappedAppKeyVersion],
      ]);
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
    case "durable-home.assigned": {
      const map = exactKeys(asMap(payload, "a home assignment"),
        ["homeId", "homeKind", "vaultId", "wrappedAppKeyVersion"], "a home assignment");
      if (count(field(map, "wrappedAppKeyVersion"), "an app wrap version") !== 1) {
        throw new CodecError("unsupported app wrap version");
      }
      return { kind, payload: {
        homeId: asDomainId("home", bytesOfLength(field(map, "homeId"), ID_BYTES, "a home id")),
        vaultId: asDomainId("vault", bytesOfLength(field(map, "vaultId"), ID_BYTES, "a vault id")),
        homeKind: oneOf(field(map, "homeKind"), ["bundle", "dropbox", "onedrive"], "a home kind"),
        wrappedAppKeyVersion: 1,
      } };
    }
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

/** Original evidence payloads have their own lossless provenance representation. */
export type EvidenceEventKindV1 = "conflict.detected" | "conflict.resolved" | "merge.applied";
export function isEvidenceEventKind(kind: string): kind is EvidenceEventKindV1 {
  return kind === "conflict.detected" || kind === "conflict.resolved" || kind === "merge.applied";
}

export function decodeEvidenceRecord(value: DecodedValue): AuthoredRecordV1 {
  const map = evidenceMap(value, ["recordId", "tableId", "values", "provenance"]);
  const values = evidenceFields(field(map, "values"), decodeCellValue);
  const provenance = evidenceFields(field(map, "provenance"), (value): ValueProvenanceV1 => {
    const { sourceId, ...decoded } = decodeEventProvenance(value);
    return { ...decoded, ...(sourceId === undefined ? {} : { sourceId: asDomainId("lineage", sourceId) }) };
  });
  return { recordId: asDomainId("record", evidenceId(field(map, "recordId"))),
    tableId: asDomainId("table", evidenceId(field(map, "tableId"))),
    values: new Map(values), provenance: new Map(provenance) };
}

const evidenceMap = (value: DecodedValue, keys: readonly string[]) =>
  exactKeys(asMap(value, "original evidence"), keys, "original evidence");
const evidenceId = (value: DecodedValue) => bytesOfLength(value, 16, "evidence identity");
const evidenceText = (value: DecodedValue) => {
  const result = nfcText(value, "evidence text");
  if (result.length === 0) throw new CodecError("empty evidence text");
  return result;
};
function evidenceRevision(value: DecodedValue): bigint {
  if (typeof value !== "bigint" || value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new CodecError("invalid evidence revision");
  return value;
}
function evidenceFields<T>(value: DecodedValue, decode: (value: DecodedValue) => T): readonly (readonly [FieldId, T])[] {
  const entries = list(value, "evidence fields").map((entry) => {
    const map = evidenceMap(entry, ["fieldId", "value"]);
    return [fieldIdOf(field(map, "fieldId")), decode(field(map, "value"))] as const;
  });
  for (let i = 1; i < entries.length; i++) if (compareDomainIds(entries[i - 1]![0], entries[i]![0]) >= 0) {
    throw new CodecError("evidence fields must be sorted and unique");
  }
  return entries;
}
function evidenceIds(value: DecodedValue, ordered: boolean): readonly Uint8Array[] {
  const ids = list(value, "evidence identities").map(evidenceId);
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    const key = [...id].join(",");
    if (seen.has(key) || (ordered && index > 0 && compareDomainIds(ids[index - 1]!, id) >= 0)) throw new CodecError("duplicate or unordered evidence identities");
    seen.add(key);
  });
  return ids;
}
function evidenceFrontier(value: DecodedValue) {
  const entries = list(value, "evidence frontier").map((entry) => {
    const map = evidenceMap(entry, ["deviceId", "commitSequence"]);
    const commitSequence = evidenceRevision(field(map, "commitSequence"));
    if (commitSequence === 0n) throw new CodecError("zero evidence frontier sequence");
    return { deviceId: evidenceId(field(map, "deviceId")), commitSequence };
  });
  for (let i = 1; i < entries.length; i++) if (compareDomainIds(entries[i - 1]!.deviceId, entries[i]!.deviceId) >= 0) {
    throw new CodecError("evidence frontier must be sorted and unique");
  }
  return entries;
}
function evidenceParameters(value: DecodedValue) {
  const map = asMap(value, "evidence parameters");
  for (const [key, item] of map) {
    if (typeof key !== "string" || !["string", "bigint", "boolean"].includes(typeof item)) throw new CodecError("invalid evidence parameter");
  }
  return map;
}
export function decodeEvidenceValidationReport(value: DecodedValue) {
  const map = evidenceMap(value, ["isValid", "issues"]);
  const isValid = field(map, "isValid");
  if (typeof isValid !== "boolean") throw new CodecError("invalid evidence verdict");
  const issues = list(field(map, "issues"), "evidence issues").map((value) => {
    const issue = evidenceMap(value, ["fieldId", "ruleId", "kind", "severity", "messageKey", "messageParameters"]);
    const fieldId = field(issue, "fieldId");
    const ruleId = field(issue, "ruleId");
    return { fieldId: fieldId === null ? null : evidenceId(fieldId), ruleId: ruleId === null ? null : evidenceId(ruleId),
      kind: oneOf(field(issue, "kind"), VALIDATION_ISSUE_KINDS, "issue kind"),
      severity: oneOf(field(issue, "severity"), VALIDATION_SEVERITIES, "issue severity"),
      messageKey: evidenceText(field(issue, "messageKey")), messageParameters: evidenceParameters(field(issue, "messageParameters")) };
  });
  if (isValid !== !issues.some((issue) => issue.severity === "blocking")) throw new CodecError("evidence report contradicts its issues");
  return { isValid, issues };
}
function evidenceSchema(value: DecodedValue) {
  const map = evidenceMap(value, ["tables", "enumOptions", "relationships", "validationRules", "formulas", "charts"]);
  const tables = list(field(map, "tables"), "evidence tables").map(decodeTableDef);
  const enumOptions = list(field(map, "enumOptions"), "evidence enum options").map(decodeEnumOption);
  const relationships = list(field(map, "relationships"), "evidence relationships").map(decodeRelationship);
  const validationRules = list(field(map, "validationRules"), "evidence rules").map((value) => {
    const rule = evidenceMap(value, ["tableId", "displayName", "rule", "isActive", "schemaRevision"]);
    if (typeof field(rule, "isActive") !== "boolean") throw new CodecError("invalid rule activity");
    return { tableId: evidenceId(field(rule, "tableId")), displayName: nfcText(field(rule, "displayName"), "rule name"),
      rule: decodeRuleIR(field(rule, "rule")), isActive: field(rule, "isActive"), schemaRevision: evidenceRevision(field(rule, "schemaRevision")) };
  });
  const formulas = list(field(map, "formulas"), "evidence formulas").map((value) => {
    const formula = evidenceMap(value, ["formula", "metadata", "isActive", "schemaRevision"]);
    if (typeof field(formula, "isActive") !== "boolean") throw new CodecError("invalid formula activity");
    return { formula: decodeFormulaDefinition(field(formula, "formula")), metadata: decodeFormulaMetadata(field(formula, "metadata")),
      isActive: field(formula, "isActive"), schemaRevision: evidenceRevision(field(formula, "schemaRevision")) };
  });
  const charts = list(field(map, "charts"), "evidence charts").map(decodeCheckpointChart);
  return { tables, enumOptions, relationships, validationRules, formulas, charts };
}
export function decodeEvidenceState(value: DecodedValue, targetKind: "record" | "schema" | "identity") {
  const map = evidenceMap(value, ["state", "value"]);
  const state = oneOf(field(map, "state"), ["present", "deleted", "absent"], "evidence state");
  const content = field(map, "value");
  if (state !== "present") {
    if (content !== null) throw new CodecError("non-present evidence carries a value");
    return { state, value: null };
  }
  if (targetKind === "record") return { state, value: decodeEvidenceRecord(content) };
  if (targetKind === "schema") return { state, value: evidenceSchema(content) };
  const identity = evidenceMap(content, ["matchFieldId", "candidates"]);
  const matchFieldId = field(identity, "matchFieldId");
  const candidates = list(field(identity, "candidates"), "identity candidates").map(decodeEvidenceRecord);
  for (let i = 1; i < candidates.length; i++) if (compareDomainIds(candidates[i - 1]!.recordId, candidates[i]!.recordId) >= 0) {
    throw new CodecError("identity candidates must be sorted and unique");
  }
  return { state, value: { matchFieldId: matchFieldId === null ? null : evidenceId(matchFieldId), candidates } };
}
function evidenceSource(value: DecodedValue, targetKind: "record" | "schema" | "identity") {
  const map = evidenceMap(value, ["source", "timestampMs", "commitId", "frontier", "state"]);
  return { source: oneOf(field(map, "source"), ["this-device", "another-device", "uploaded-file"], "evidence source"),
    timestampMs: count(field(map, "timestampMs"), "source timestamp"), commitId: evidenceId(field(map, "commitId")),
    frontier: evidenceFrontier(field(map, "frontier")), state: decodeEvidenceState(field(map, "state"), targetKind) };
}
function evidenceBaseline(value: DecodedValue) {
  const map = evidenceMap(value, ["scopeId", "state", "values", "absentReason", "frontier"]);
  const state = oneOf(field(map, "state"), ["present", "deleted", "absent"], "baseline state");
  const values = field(map, "values");
  const reason = field(map, "absentReason");
  if ((state === "present" ? values === null : values !== null) || (state === "absent" ? reason === null : reason !== null)) {
    throw new CodecError("contradictory baseline state");
  }
  return { scopeId: evidenceId(field(map, "scopeId")), state, values: values === null ? null : evidenceFields(values, decodeCellValue),
    absentReason: reason === null ? null : evidenceText(reason), frontier: evidenceFrontier(field(map, "frontier")) };
}

/** Shape validation only; replay verifies identities, source authority and effects. */
export function decodeEvidenceEventPayload(kind: EvidenceEventKindV1, value: DecodedValue) {
  const keys = kind === "conflict.detected"
    ? ["payloadVersion", "conflictId", "tableId", "targetKind", "targetId", "conflictKind", "schemaRevision", "baseline", "local", "incoming", "conflictingFields", "validationReport"]
    : kind === "conflict.resolved"
      ? ["payloadVersion", "conflictId", "detectedEventId", "decision", "result", "schemaRevision", "validationReport", "effectEventIds"]
      : ["payloadVersion", "mergeId", "tableId", "recordId", "schemaRevision", "baseline", "local", "incoming", "localChangedFields", "incomingChangedFields", "result", "resultCommitId", "validationReport", "explanation", "effectEventIds"];
  const map = evidenceMap(value, keys);
  if (field(map, "payloadVersion") !== 1n) throw new CodecError("unsupported evidence payload version");
  const schemaRevision = evidenceRevision(field(map, "schemaRevision"));
  if (kind === "conflict.detected") {
    const targetKind = oneOf(field(map, "targetKind"), ["record", "schema", "identity"], "conflict target");
    const conflictKind = oneOf(field(map, "conflictKind"), targetKind === "record"
      ? ["field", "key", "delete-edit", "baseline-absent", "record-validation"] : [targetKind], "conflict kind");
    const baselineValue = field(map, "baseline");
    const baseline = baselineValue === null ? null : evidenceBaseline(baselineValue);
    const reportValue = field(map, "validationReport");
    const validationReport = reportValue === null ? null : decodeEvidenceValidationReport(reportValue);
    if ((targetKind === "record" && baseline === null) || (conflictKind === "baseline-absent" && baseline?.state !== "absent") ||
        (["record-validation", "schema"].includes(conflictKind) && (validationReport === null || validationReport.isValid))) {
      throw new CodecError("conflict lacks its baseline or rejection report");
    }
    return { kind, payload: { schemaRevision, conflictId: evidenceId(field(map, "conflictId")), tableId: evidenceId(field(map, "tableId")),
      targetKind, targetId: evidenceId(field(map, "targetId")), conflictKind, baseline,
      local: evidenceSource(field(map, "local"), targetKind), incoming: evidenceSource(field(map, "incoming"), targetKind),
      conflictingFields: evidenceIds(field(map, "conflictingFields"), true), validationReport }, canonical: map };
  }
  const validationReport = decodeEvidenceValidationReport(field(map, "validationReport"));
  if (!validationReport.isValid) throw new CodecError("successful evidence requires a valid report");
  const effectEventIds = evidenceIds(field(map, "effectEventIds"), false);
  if (kind === "conflict.resolved") {
    // The authenticated detection supplies the target kind before result decoding.
    const result = evidenceMap(field(map, "result"), ["state", "value"]);
    const state = oneOf(field(result, "state"), ["present", "deleted", "absent"], "resolution state");
    if (state !== "present" && field(result, "value") !== null) throw new CodecError("non-present result carries a value");
    return { kind, payload: { schemaRevision, conflictId: evidenceId(field(map, "conflictId")), detectedEventId: evidenceId(field(map, "detectedEventId")),
      decision: oneOf(field(map, "decision"), ["keep-local", "use-incoming", "edited"], "resolution decision"),
      result, validationReport, effectEventIds }, canonical: map };
  }
  const baseline = evidenceBaseline(field(map, "baseline"));
  const local = evidenceSource(field(map, "local"), "record");
  const incoming = evidenceSource(field(map, "incoming"), "record");
  if (baseline.state !== "present" || local.state.state !== "present" || incoming.state.state !== "present") throw new CodecError("merge requires present alternatives and baseline");
  const explanation = evidenceMap(field(map, "explanation"), ["messageKey", "messageParameters"]);
  return { kind, payload: { schemaRevision, mergeId: evidenceId(field(map, "mergeId")), tableId: evidenceId(field(map, "tableId")),
    recordId: evidenceId(field(map, "recordId")), baseline, local, incoming,
    localChangedFields: evidenceIds(field(map, "localChangedFields"), true), incomingChangedFields: evidenceIds(field(map, "incomingChangedFields"), true),
    result: decodeEvidenceRecord(field(map, "result")), resultCommitId: evidenceId(field(map, "resultCommitId")), validationReport, effectEventIds,
    explanation: { messageKey: evidenceText(field(explanation, "messageKey")), messageParameters: evidenceParameters(field(explanation, "messageParameters")) } }, canonical: map };
}


/** Converts checked wire evidence to the projection's storage-independent replay vocabulary. */
export function toProjectionEvidence(kind: EvidenceEventKindV1, value: DecodedValue): ProjectionEvidenceEventV1 {
  const decoded = decodeEvidenceEventPayload(kind, value);
  const raw = decoded.canonical;
  const canonical = encodeCanonical(raw);
  const state = (value: DecodedValue, target: "record" | "schema" | "identity"): ProjectionEvidenceStateV1 => {
    const decoded = decodeEvidenceState(value, target);
    return { state: decoded.state,
      ...(target === "identity" && decoded.value !== null && "candidates" in decoded.value ? { identity: decoded.value } : {}),
      record: target === "record" && decoded.state === "present"
      ? decodeEvidenceRecord(field(asMap(value, "evidence state"), "value")) : null,
      canonical: encodeCanonical(value) };
  };
  const source = (value: DecodedValue, target: "record" | "schema" | "identity"): ProjectionEvidenceSourceV1 => {
    const decoded = evidenceSource(value, target);
    return { ...decoded, state: state(field(asMap(value, "evidence source"), "state"), target), canonical: encodeCanonical(value) };
  };
  const baseline = (value: DecodedValue): ProjectionEvidenceBaselineV1 => {
    const decoded = evidenceBaseline(value);
    return { ...decoded, values: decoded.values === null ? null : encodeCanonical(field(asMap(value, "baseline"), "values")),
      canonical: encodeCanonical(value) };
  };
  const report = (value: DecodedValue): ProjectionEvidenceReportV1 => {
    const decoded = decodeEvidenceValidationReport(value);
    return { isValid: decoded.isValid, canonical: encodeCanonical(value), issues: decoded.issues.map((issue) => ({
      ...issue, fieldId: issue.fieldId === null ? null : asDomainId("field", issue.fieldId),
      ruleId: issue.ruleId === null ? null : asDomainId("rule", issue.ruleId),
      messageParameters: Object.fromEntries(issue.messageParameters) as Record<string, string | bigint | boolean>,
    })) };
  };
  if (decoded.kind === "conflict.detected") {
    const target = decoded.payload.targetKind;
    return { kind: decoded.kind, canonical, payload: { ...decoded.payload,
      baseline: decoded.payload.baseline === null ? null : baseline(field(raw, "baseline")),
      local: source(field(raw, "local"), target), incoming: source(field(raw, "incoming"), target),
      validationReport: decoded.payload.validationReport === null ? null : report(field(raw, "validationReport")) } };
  }
  if (decoded.kind === "conflict.resolved") {
    const result = field(raw, "result");
    const content = field(asMap(result, "resolution"), "value");
    const target = content instanceof Map && content.has("tables") ? "schema"
      : content instanceof Map && content.has("candidates") ? "identity" : "record";
    return { kind: decoded.kind, canonical, payload: { ...decoded.payload, result: state(result, target),
      validationReport: report(field(raw, "validationReport")) } };
  }
  return { kind: decoded.kind, canonical, payload: { ...decoded.payload,
    baseline: baseline(field(raw, "baseline")), local: source(field(raw, "local"), "record"), incoming: source(field(raw, "incoming"), "record"),
    validationReport: report(field(raw, "validationReport")), explanation: encodeCanonical(field(raw, "explanation")) } };
}
