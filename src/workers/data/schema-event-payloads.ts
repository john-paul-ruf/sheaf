/**
 * The semantic payload ↔ canonical CBOR mapping for the F04 schema, rule and
 * formula events (M33; CA-25, CA-27, CA-28 producer and replay consumer).
 *
 * The same one-file rule as the record events beside it: the encoder runs
 * when a schema command is written and the decoder when the tail is replayed
 * after a restart, so both directions live here and `encode∘decode` is
 * asserted to be identity. Every definition inside a payload — a field, a
 * relationship, a rule IR, a formula — uses M23's `roots.ts` codec, so a
 * definition reads the same from a checkpoint and from an event.
 *
 * Every map has exact keys and every list is bounded by what it came from.
 * Nothing here can carry an evaluated value: a formula payload is a
 * definition and its metadata (invariant 7), and an impact report travels as
 * counts, never as the values it counted (CA-12).
 */

import { CodecError } from "../../domain/model/errors.js";
import type { F04SchemaEventKindV1, TableDefinitionV1 } from "../../domain/model/events.js";
import type {
  SchemaEventV1,
  SchemaImpactCountsV1,
} from "../../application/ports/event-repository.js";
import type { FieldId, SheetId, TableId } from "../../domain/model/ids.js";
import type { SchemaChangeKindV1 } from "../../domain/validation/schema-impact.js";
import {
  decodeFieldDef,
  decodeFormulaDefinition,
  decodeFormulaMetadata,
  decodeRelationship,
  decodeRuleIR,
  encodeFieldDef,
  encodeFormulaDefinition,
  encodeFormulaMetadata,
  encodeRelationship,
  encodeRuleIR,
} from "../../import/staging/roots.js";
import {
  asMap,
  boolean,
  bytesOfLength,
  cborMap,
  count,
  exactKeys,
  field,
  nfcText,
  oneOf,
} from "../../import/staging/proposal-codec.js";
import type { CborValue, DecodedValue } from "../../persistence/codecs/canonical-cbor.js";

const ID_BYTES = 16;
const SHA256_BYTES = 32;

/**
 * D59's change kinds, as an impact report names them. The `Record` below is
 * exhaustive over M02's union, so a kind added there is a compile error here
 * until the codec knows it.
 */
const CHANGE_KIND_PRESENCE: Readonly<Record<SchemaChangeKindV1, true>> = {
  "rename-app": true,
  "rename-table": true,
  "set-table-label": true,
  "create-field": true,
  "rename-field": true,
  "change-field-type": true,
  "set-required": true,
  "deactivate-field": true,
  "reactivate-field": true,
  "reorder-fields": true,
  "set-enum-options": true,
  "set-relationship": true,
  "remove-relationship": true,
  "save-rule": true,
  "remove-rule": true,
  "save-formula": true,
  "remove-formula": true,
};

const CHANGE_KINDS = Object.freeze(Object.keys(CHANGE_KIND_PRESENCE) as SchemaChangeKindV1[]);

const IMPACT_COUNT_KEYS = Object.freeze([
  "total",
  "affected",
  "unchanged",
  "converted",
  "keptAndFlagged",
  "missingNow",
  "onRemovedOptions",
  "matchedKeys",
  "unmatchedKeys",
  "unlinkedReferences",
  "failingRule",
  "formulaErrors",
] as const satisfies readonly (keyof SchemaImpactCountsV1)[]);

const encodeImpact = (impact: SchemaImpactCountsV1): CborValue =>
  cborMap([
    ["change", impact.change],
    ...IMPACT_COUNT_KEYS.map((key) => [key, impact[key]] as const),
  ]);

const decodeImpact = (value: DecodedValue): SchemaImpactCountsV1 => {
  const map = exactKeys(asMap(value, "an impact report"), ["change", ...IMPACT_COUNT_KEYS], "an impact report");
  const counts = Object.fromEntries(
    IMPACT_COUNT_KEYS.map((key) => [key, count(field(map, key), "an impact count")]),
  ) as Record<(typeof IMPACT_COUNT_KEYS)[number], number>;
  return { change: oneOf(field(map, "change"), CHANGE_KINDS, "a schema change kind"), ...counts };
};

const encodeTableDefinition = (table: TableDefinitionV1): CborValue =>
  cborMap([
    ["tableId", table.tableId],
    ["displayName", table.displayName],
    ["tableOrdinal", table.tableOrdinal],
    ["keyFieldId", table.keyFieldId],
    ["labelFieldId", table.labelFieldId],
    ["sourceSheetId", table.sourceSheetId],
    ["isActive", table.isActive],
    ["schemaRevision", table.schemaRevision],
  ]);

const id = <T>(value: DecodedValue, what: string): T => bytesOfLength(value, ID_BYTES, what) as T;
const optionalId = <T>(value: DecodedValue, what: string): T | null =>
  value === null ? null : id<T>(value, what);
const digest = (value: DecodedValue, what: string): Uint8Array =>
  bytesOfLength(value, SHA256_BYTES, what);
const optionalDigest = (value: DecodedValue, what: string): Uint8Array | null =>
  value === null ? null : digest(value, what);

const decodeTableDefinition = (value: DecodedValue): TableDefinitionV1 => {
  const map = exactKeys(
    asMap(value, "a table definition"),
    ["tableId", "displayName", "tableOrdinal", "keyFieldId", "labelFieldId", "sourceSheetId", "isActive", "schemaRevision"],
    "a table definition",
  );
  return {
    tableId: id<TableId>(field(map, "tableId"), "a table id"),
    displayName: nfcText(field(map, "displayName"), "a table name"),
    tableOrdinal: count(field(map, "tableOrdinal"), "a table ordinal"),
    keyFieldId: optionalId<FieldId>(field(map, "keyFieldId"), "a key field id"),
    labelFieldId: optionalId<FieldId>(field(map, "labelFieldId"), "a label field id"),
    sourceSheetId: optionalId<SheetId>(field(map, "sourceSheetId"), "a sheet id"),
    isActive: boolean(field(map, "isActive"), "an active flag"),
    schemaRevision: BigInt(count(field(map, "schemaRevision"), "a schema revision")),
  };
};

/** The wire payload for one F04 schema event. */
export function encodeSchemaEventPayload(event: SchemaEventV1): CborValue {
  switch (event.kind) {
    case "app.renamed":
      return cborMap([
        ["priorNameSha256", event.payload.priorNameSha256],
        ["displayName", event.payload.displayName],
      ]);
    case "table.changed":
      return cborMap([
        ["priorSha256", event.payload.priorSha256],
        ["before", encodeTableDefinition(event.payload.before)],
        ["after", encodeTableDefinition(event.payload.after)],
        ["impact", encodeImpact(event.payload.impact)],
      ]);
    case "field.changed":
      return cborMap([
        ["before", encodeFieldDef(event.payload.before)],
        ["after", encodeFieldDef(event.payload.after)],
        ["impact", encodeImpact(event.payload.impact)],
      ]);
    case "relationship.changed":
      return cborMap([
        ["relationship", encodeRelationship(event.payload.relationship)],
        ["priorSha256", event.payload.priorSha256],
      ]);
    case "relationship.removed":
      return cborMap([
        ["relationship", encodeRelationship(event.payload.relationship)],
        ["rejectionFingerprint", event.payload.rejectionFingerprint],
      ]);
    case "rule.changed":
      return cborMap([
        ["tableId", event.payload.tableId],
        ["displayName", event.payload.displayName],
        ["rule", encodeRuleIR(event.payload.rule)],
        ["priorSha256", event.payload.priorSha256],
      ]);
    case "rule.removed":
      return cborMap([
        ["tableId", event.payload.tableId],
        ["displayName", event.payload.displayName],
        ["rule", encodeRuleIR(event.payload.rule)],
        ["impact", encodeImpact(event.payload.impact)],
      ]);
    case "formula.changed":
      return cborMap([
        ["formula", encodeFormulaDefinition(event.payload.formula)],
        ["metadata", encodeFormulaMetadata(event.payload.metadata)],
        ["priorSha256", event.payload.priorSha256],
      ]);
    case "formula.removed":
      return cborMap([
        ["formula", encodeFormulaDefinition(event.payload.formula)],
        ["metadata", encodeFormulaMetadata(event.payload.metadata)],
        ["impact", encodeImpact(event.payload.impact)],
      ]);
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** Reads a decoded F04 payload back into the typed event its kind names. */
export function decodeSchemaEventPayload(
  kind: F04SchemaEventKindV1,
  payload: DecodedValue,
): SchemaEventV1 {
  const keys = (names: readonly string[]) => exactKeys(asMap(payload, `a ${kind} payload`), names, `a ${kind} payload`);
  switch (kind) {
    case "app.renamed": {
      const map = keys(["priorNameSha256", "displayName"]);
      return {
        kind,
        payload: {
          priorNameSha256: digest(field(map, "priorNameSha256"), "a prior name digest"),
          displayName: nfcText(field(map, "displayName"), "an app name"),
        },
      };
    }
    case "table.changed": {
      const map = keys(["priorSha256", "before", "after", "impact"]);
      return {
        kind,
        payload: {
          priorSha256: digest(field(map, "priorSha256"), "a prior table digest"),
          before: decodeTableDefinition(field(map, "before")),
          after: decodeTableDefinition(field(map, "after")),
          impact: decodeImpact(field(map, "impact")),
        },
      };
    }
    case "field.changed": {
      const map = keys(["before", "after", "impact"]);
      return {
        kind,
        payload: {
          before: decodeFieldDef(field(map, "before")),
          after: decodeFieldDef(field(map, "after")),
          impact: decodeImpact(field(map, "impact")),
        },
      };
    }
    case "relationship.changed": {
      const map = keys(["relationship", "priorSha256"]);
      return {
        kind,
        payload: {
          relationship: decodeRelationship(field(map, "relationship")),
          priorSha256: optionalDigest(field(map, "priorSha256"), "a prior relationship digest"),
        },
      };
    }
    case "relationship.removed": {
      const map = keys(["relationship", "rejectionFingerprint"]);
      return {
        kind,
        payload: {
          relationship: decodeRelationship(field(map, "relationship")),
          rejectionFingerprint: optionalDigest(field(map, "rejectionFingerprint"), "a rejection fingerprint"),
        },
      };
    }
    case "rule.changed": {
      const map = keys(["tableId", "displayName", "rule", "priorSha256"]);
      return {
        kind,
        payload: {
          tableId: id<TableId>(field(map, "tableId"), "a table id"),
          displayName: nfcText(field(map, "displayName"), "a rule name"),
          rule: decodeRuleIR(field(map, "rule")),
          priorSha256: optionalDigest(field(map, "priorSha256"), "a prior rule digest"),
        },
      };
    }
    case "rule.removed": {
      const map = keys(["tableId", "displayName", "rule", "impact"]);
      return {
        kind,
        payload: {
          tableId: id<TableId>(field(map, "tableId"), "a table id"),
          displayName: nfcText(field(map, "displayName"), "a rule name"),
          rule: decodeRuleIR(field(map, "rule")),
          impact: decodeImpact(field(map, "impact")),
        },
      };
    }
    case "formula.changed": {
      const map = keys(["formula", "metadata", "priorSha256"]);
      return {
        kind,
        payload: {
          formula: decodeFormulaDefinition(field(map, "formula")),
          metadata: decodeFormulaMetadata(field(map, "metadata")),
          priorSha256: optionalDigest(field(map, "priorSha256"), "a prior formula digest"),
        },
      };
    }
    case "formula.removed": {
      const map = keys(["formula", "metadata", "impact"]);
      return {
        kind,
        payload: {
          formula: decodeFormulaDefinition(field(map, "formula")),
          metadata: decodeFormulaMetadata(field(map, "metadata")),
          impact: decodeImpact(field(map, "impact")),
        },
      };
    }
    default: {
      const unreachable: never = kind;
      throw new CodecError(`unknown schema event kind ${String(unreachable)}`);
    }
  }
}
