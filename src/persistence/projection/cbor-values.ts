/**
 * The projection's payload columns, encoded and decoded.
 *
 * Migration 005 stores several facts as opaque CBOR blobs — `authored_cbor`,
 * `theme_cbor`, `rule_ir_cbor`, `summary_cbor`, `restoration_cbor`,
 * `message_parameters_cbor` — because they are structured domain values, not
 * things SQL should decompose. This module is the only place that reads or
 * writes those bytes, and it uses M09's canonical encoder so that identical
 * state always produces identical bytes. That determinism is what makes CA-13's
 * hydration equivalence checkable at all: two paths that reach the same state
 * hold literally the same blobs.
 *
 * These bytes are **ephemeral**. They live in a `:memory:` database that lock
 * destroys, so nothing here is a durable format and nothing here may be written
 * to IndexedDB or a provider. The durable encoding of an event payload belongs
 * to its author (S04's promotion, S05's commands); this is the projection's own
 * session representation of already-decoded values.
 *
 * Integers decode as `bigint` (M09's rule, so that decode∘encode is byte
 * identical), which is why an integer message parameter comes back as `bigint`
 * even when it was authored as `number`.
 */

import { CodecError } from "../../domain/model/errors.js";
import {
  APP_THEME_TOKENS,
  type AppThemeTokenV1,
  type AppThemeV1,
  type AuthoredRecordV1,
  type FieldChangeV1,
} from "../../domain/model/events.js";
import {
  asDomainId,
  compareDomainIds,
  type FieldId,
} from "../../domain/model/ids.js";
import {
  PROVENANCE_SOURCES,
  type ProvenanceSourceV1,
  type ValueProvenanceV1,
} from "../../domain/model/provenance.js";
import {
  BLANK_VALUE,
  booleanValue,
  dateValue,
  decimalValue,
  enumValue,
  invalidPreservedValue,
  MISSING_VALUE,
  referenceValue,
  textValue,
  type CellValueV1,
} from "../../domain/model/values.js";
import {
  VALIDATION_ISSUE_KINDS,
  VALIDATION_SEVERITIES,
  type MessageParameterV1,
  type RuleConditionV1,
  type ValidationRuleIR,
} from "../../domain/validation/rules.js";
import {
  decodeCanonical,
  encodeCanonical,
  type CborValue,
  type DecodedKey,
  type DecodedValue,
} from "../codecs/canonical-cbor.js";
import { sortFrontier } from "../codecs/event-commit.js";
import type { FrontierEntryV1 } from "../../migrations/004_event_format_v1.js";
import type { ProjectionChangeSummaryV1 } from "./types.js";

type CborMap = Map<string, CborValue>;
type DecodedMap = ReadonlyMap<DecodedKey, DecodedValue>;

// ------------------------------------------------------------------ values --

const encodeCellValue = (value: CellValueV1): CborValue => {
  const map: CborMap = new Map([["kind", value.kind]]);
  switch (value.kind) {
    case "text":
      map.set("text", value.text);
      break;
    case "decimal":
      map.set("decimal", value.decimal);
      break;
    case "date":
      map.set("epochDay", BigInt(value.epochDay));
      break;
    case "boolean":
      map.set("boolean", value.boolean);
      break;
    case "enum":
      map.set("optionId", value.optionId);
      break;
    case "reference":
      map.set("recordId", value.recordId);
      break;
    case "invalid-preserved":
      map.set("sourceText", value.sourceText);
      break;
    case "missing":
    case "blank":
      break;
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
  return map;
};

const decodeCellValue = (value: DecodedValue): CellValueV1 => {
  const map = asMap(value, "cell value");
  switch (readText(map, "kind")) {
    case "text":
      return textValue(readText(map, "text"));
    case "decimal":
      return decimalValue(readText(map, "decimal"));
    case "date":
      return dateValue(Number(readInteger(map, "epochDay")));
    case "boolean":
      return booleanValue(readBoolean(map, "boolean"));
    case "enum":
      return enumValue(asDomainId("option", readBytes(map, "optionId")));
    case "reference":
      return referenceValue(asDomainId("record", readBytes(map, "recordId")));
    case "invalid-preserved":
      return invalidPreservedValue(readText(map, "sourceText"));
    case "missing":
      return MISSING_VALUE;
    case "blank":
      return BLANK_VALUE;
    default:
      throw new CodecError("cell value kind is not in the closed v1 list");
  }
};

const encodeProvenance = (provenance: ValueProvenanceV1): CborValue => {
  if (!PROVENANCE_SOURCES.includes(provenance.source)) {
    throw new CodecError("provenance source is not in the closed v1 list");
  }
  const map: CborMap = new Map([["source", provenance.source]]);
  if (provenance.sourceId !== undefined) {
    map.set("sourceId", provenance.sourceId);
  }
  if (provenance.sourceTimestampMs !== undefined) {
    map.set("sourceTimestampMs", provenance.sourceTimestampMs);
  }
  if (provenance.evidence !== undefined) {
    map.set("evidence", provenance.evidence as CborValue);
  }
  return map;
};

const decodeProvenance = (value: DecodedValue): ValueProvenanceV1 => {
  const map = asMap(value, "provenance");
  const source = readText(map, "source");
  if (!(PROVENANCE_SOURCES as readonly string[]).includes(source)) {
    throw new CodecError("provenance source is not in the closed v1 list");
  }
  const sourceId = map.get("sourceId");
  const sourceTimestampMs = map.get("sourceTimestampMs");
  const evidence = map.get("evidence");
  return {
    source: source as ProvenanceSourceV1,
    // Which kind of ID these 16 bytes name is implied by `source` (a lineage
    // for an import, a device for a remote edit); the bytes do not state it and
    // this codec does not guess. The length is checked; the brand is not
    // evidence and no consumer may read it as one.
    ...(sourceId === undefined
      ? {}
      : { sourceId: asDomainId("app", asBytes(sourceId, "sourceId")) }),
    ...(sourceTimestampMs === undefined
      ? {}
      : { sourceTimestampMs: asInteger(sourceTimestampMs, "sourceTimestampMs") }),
    ...(evidence === undefined ? {} : { evidence }),
  };
};

// --------------------------------------------------------- authored records --

/**
 * `records.authored_cbor`: the complete authored value set with its per-value
 * provenance — including the values that have no typed cell (missing, blank,
 * invalid-preserved). This blob, not the `cells` table, is the authoritative
 * state of a record, which is why the record-by-id read path returns it
 * (CA-13(c)).
 *
 * Entries are sorted by field ID so the bytes depend on the state and not on
 * the order a caller happened to build its map in.
 */
export function encodeAuthoredRecord(record: AuthoredRecordV1): Uint8Array {
  const fieldIds = [...record.values.keys()].sort(compareDomainIds);
  const entries = fieldIds.map((fieldId) => {
    const value = record.values.get(fieldId);
    if (value === undefined) {
      throw new CodecError("authored record value is missing for a field");
    }
    const entry: CborMap = new Map<string, CborValue>([
      ["fieldId", fieldId],
      ["value", encodeCellValue(value)],
    ]);
    const provenance = record.provenance.get(fieldId);
    if (provenance !== undefined) {
      entry.set("provenance", encodeProvenance(provenance));
    }
    return entry;
  });

  return encodeCanonical(
    new Map<string, CborValue>([
      ["recordId", record.recordId],
      ["tableId", record.tableId],
      ["values", entries],
    ]),
  );
}

export function decodeAuthoredRecord(bytes: Uint8Array): AuthoredRecordV1 {
  const map = asMap(decodeCanonical(bytes), "authored record");
  const values = new Map<FieldId, CellValueV1>();
  const provenance = new Map<FieldId, ValueProvenanceV1>();

  for (const entry of asArray(map.get("values"), "authored values")) {
    const fields = asMap(entry, "authored value");
    const fieldId = asDomainId("field", readBytes(fields, "fieldId"));
    values.set(fieldId, decodeCellValue(required(fields, "value")));
    const source = fields.get("provenance");
    if (source !== undefined) {
      provenance.set(fieldId, decodeProvenance(source));
    }
  }

  return {
    recordId: asDomainId("record", readBytes(map, "recordId")),
    tableId: asDomainId("table", readBytes(map, "tableId")),
    values,
    provenance,
  };
}

// ------------------------------------------------------------------- theme --

/** `app_state.theme_cbor` (D29). The engine never composes a default. */
export function encodeAppTheme(theme: AppThemeV1): Uint8Array {
  const tokens: CborMap = new Map();
  for (const token of APP_THEME_TOKENS) {
    const value = theme.tokens[token];
    if (typeof value !== "string" || value.length === 0) {
      throw new CodecError("app theme is missing a token value");
    }
    tokens.set(token, value);
  }
  return encodeCanonical(
    new Map<string, CborValue>([
      ["themeKey", theme.themeKey],
      ["tokens", tokens],
    ]),
  );
}

export function decodeAppTheme(bytes: Uint8Array): AppThemeV1 {
  const map = asMap(decodeCanonical(bytes), "app theme");
  const source = asMap(map.get("tokens"), "app theme tokens");
  const tokens: Record<string, string> = {};
  for (const token of APP_THEME_TOKENS) {
    tokens[token] = readText(source, token);
  }
  return {
    themeKey: readText(map, "themeKey"),
    tokens: tokens as Record<AppThemeTokenV1, string>,
  };
}

// ------------------------------------------------------------------- rules --

const encodeCondition = (condition: RuleConditionV1): CborValue => {
  const map: CborMap = new Map([["kind", condition.kind]]);
  switch (condition.kind) {
    case "field-present":
    case "field-absent":
      map.set("fieldId", condition.fieldId);
      break;
    case "field-equals":
      map.set("fieldId", condition.fieldId);
      map.set("value", encodeCellValue(condition.value));
      break;
    case "all":
    case "any":
      map.set("conditions", condition.conditions.map(encodeCondition));
      break;
    case "not":
      map.set("condition", encodeCondition(condition.condition));
      break;
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
  return map;
};

const decodeCondition = (value: DecodedValue): RuleConditionV1 => {
  const map = asMap(value, "rule condition");
  const kind = readText(map, "kind");
  switch (kind) {
    case "field-present":
    case "field-absent":
      return { kind, fieldId: asDomainId("field", readBytes(map, "fieldId")) };
    case "field-equals":
      return {
        kind,
        fieldId: asDomainId("field", readBytes(map, "fieldId")),
        value: decodeCellValue(required(map, "value")),
      };
    case "all":
    case "any":
      return {
        kind,
        conditions: asArray(map.get("conditions"), "conditions").map(
          decodeCondition,
        ),
      };
    case "not":
      return { kind, condition: decodeCondition(required(map, "condition")) };
    default:
      throw new CodecError("rule condition kind is not in the closed v1 IR");
  }
};

/** `validation_rules.rule_ir_cbor`: the closed, non-executing rule IR. */
export function encodeRuleIR(rule: ValidationRuleIR): Uint8Array {
  if (rule.irVersion !== 1) {
    throw new CodecError("unsupported rule IR version");
  }
  return encodeCanonical(
    new Map<string, CborValue>([
      ["irVersion", 1n],
      ["ruleId", rule.ruleId],
      ["severity", rule.severity],
      ["messageKey", rule.messageKey],
      ["condition", encodeCondition(rule.condition)],
    ]),
  );
}

export function decodeRuleIR(
  bytes: Uint8Array,
  messageParameters: Readonly<Record<string, MessageParameterV1>>,
): ValidationRuleIR {
  const map = asMap(decodeCanonical(bytes), "rule IR");
  if (readInteger(map, "irVersion") !== 1n) {
    throw new CodecError("unsupported rule IR version");
  }
  const severity = readText(map, "severity");
  if (!(VALIDATION_SEVERITIES as readonly string[]).includes(severity)) {
    throw new CodecError("rule severity is not in the closed v1 list");
  }
  return {
    irVersion: 1,
    ruleId: asDomainId("rule", readBytes(map, "ruleId")),
    severity: severity as ValidationRuleIR["severity"],
    messageKey: readText(map, "messageKey"),
    messageParameters,
    condition: decodeCondition(required(map, "condition")),
  };
}

// -------------------------------------------------- messages and summaries --

/** `message_parameters_cbor`: labels, types, and counts — never cell values. */
export function encodeMessageParameters(
  parameters: Readonly<Record<string, MessageParameterV1>>,
): Uint8Array {
  const map: CborMap = new Map();
  for (const [name, value] of Object.entries(parameters)) {
    map.set(name, typeof value === "number" ? BigInt(value) : value);
  }
  return encodeCanonical(map);
}

export function decodeMessageParameters(
  bytes: Uint8Array,
): Readonly<Record<string, string | bigint | boolean>> {
  const map = asMap(decodeCanonical(bytes), "message parameters");
  const parameters: Record<string, string | bigint | boolean> = {};
  for (const [name, value] of map) {
    if (typeof name !== "string") {
      throw new CodecError("message parameter name must be text");
    }
    if (
      typeof value !== "string" &&
      typeof value !== "bigint" &&
      typeof value !== "boolean"
    ) {
      throw new CodecError("message parameter value is not a safe scalar");
    }
    parameters[name] = value;
  }
  return parameters;
}

const encodeFieldChange = (change: FieldChangeV1): CborValue =>
  new Map<string, CborValue>([
    ["fieldId", change.fieldId],
    ["before", encodeCellValue(change.before)],
    ["after", encodeCellValue(change.after)],
    ["provenance", encodeProvenance(change.provenance)],
  ]);

const decodeFieldChange = (value: DecodedValue): FieldChangeV1 => {
  const map = asMap(value, "field change");
  return {
    fieldId: asDomainId("field", readBytes(map, "fieldId")),
    before: decodeCellValue(required(map, "before")),
    after: decodeCellValue(required(map, "after")),
    provenance: decodeProvenance(required(map, "provenance")),
  };
};

/** `change_history.summary_cbor`: the structured before/after SCR-032 renders. */
export function encodeChangeSummary(
  summary: ProjectionChangeSummaryV1,
): Uint8Array {
  const map: CborMap = new Map([
    ["fieldChanges", summary.fieldChanges.map(encodeFieldChange)],
  ]);
  if (summary.recordRevision !== null) {
    map.set("recordRevision", summary.recordRevision);
  }
  if (summary.createdCommitId !== null) {
    map.set("createdCommitId", summary.createdCommitId);
  }
  return encodeCanonical(map);
}

export function decodeChangeSummary(
  bytes: Uint8Array,
): ProjectionChangeSummaryV1 {
  const map = asMap(decodeCanonical(bytes), "change summary");
  const recordRevision = map.get("recordRevision");
  const createdCommitId = map.get("createdCommitId");
  return {
    fieldChanges: asArray(map.get("fieldChanges"), "field changes").map(
      decodeFieldChange,
    ),
    recordRevision:
      recordRevision === undefined
        ? null
        : asInteger(recordRevision, "recordRevision"),
    createdCommitId:
      createdCommitId === undefined
        ? null
        : asDomainId("commit", asBytes(createdCommitId, "createdCommitId")),
  };
}

/**
 * `projection_meta.frontier_cbor`: the applied per-device frontier. M09 owns
 * the ordering rule — sorted by device, no device twice — so the sort is its
 * `sortFrontier` rather than a second implementation of the same invariant.
 */
export function encodeFrontier(
  entries: readonly FrontierEntryV1[],
): Uint8Array {
  return encodeCanonical(
    sortFrontier(entries).map(
      (entry) =>
        new Map<string, CborValue>([
          ["commitSequence", entry.commitSequence],
          ["deviceId", entry.deviceId],
        ]),
    ),
  );
}

export function decodeFrontier(bytes: Uint8Array): readonly FrontierEntryV1[] {
  return asArray(decodeCanonical(bytes), "frontier").map((entry) => {
    const map = asMap(entry, "frontier entry");
    return {
      deviceId: readBytes(map, "deviceId"),
      commitSequence: readInteger(map, "commitSequence"),
    };
  });
}

/** The closed issue kinds, shared with migration 005's `record_issues` CHECK. */
export function isValidationIssueKind(value: string): boolean {
  return (VALIDATION_ISSUE_KINDS as readonly string[]).includes(value);
}

export function isValidationSeverity(value: string): boolean {
  return (VALIDATION_SEVERITIES as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ readers --

function asMap(value: DecodedValue | undefined, field: string): DecodedMap {
  if (!(value instanceof Map)) {
    throw new CodecError(`${field} must be a map`);
  }
  return value;
}

function asArray(
  value: DecodedValue | undefined,
  field: string,
): readonly DecodedValue[] {
  if (!Array.isArray(value)) {
    throw new CodecError(`${field} must be an array`);
  }
  return value as readonly DecodedValue[];
}

function asBytes(value: DecodedValue, field: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new CodecError(`${field} must be bytes`);
  }
  return value;
}

function asInteger(value: DecodedValue, field: string): bigint {
  if (typeof value !== "bigint") {
    throw new CodecError(`${field} must be an integer`);
  }
  return value;
}

function required(map: DecodedMap, field: string): DecodedValue {
  const value = map.get(field);
  if (value === undefined) {
    throw new CodecError(`${field} is required`);
  }
  return value;
}

function readText(map: DecodedMap, field: string): string {
  const value = required(map, field);
  if (typeof value !== "string") {
    throw new CodecError(`${field} must be text`);
  }
  return value;
}

function readBoolean(map: DecodedMap, field: string): boolean {
  const value = required(map, field);
  if (typeof value !== "boolean") {
    throw new CodecError(`${field} must be a boolean`);
  }
  return value;
}

function readBytes(map: DecodedMap, field: string): Uint8Array {
  return asBytes(required(map, field), field);
}

function readInteger(map: DecodedMap, field: string): bigint {
  return asInteger(required(map, field), field);
}
