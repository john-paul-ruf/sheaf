/**
 * The structure RPCs of an open app (M33; CAP-28/29/35/36; CA-26, CA-28).
 *
 * `getAppStructure`, `previewSchemaChange`, `applySchemaChange` and
 * `getAppMetrics` — thin, like the record handlers beside them: the wire is
 * translated to M34's request at this boundary, and every decision is the
 * command's or the query's. The worker supplies what the application layer
 * may not reach itself:
 *
 * - digests of canonical definitions (M09 + M08) for a change's prior hash;
 * - F03's inference fingerprint function (M21's `workbookFingerprintInput`,
 *   imported rather than restated) for a removed relationship (FR-7);
 * - the encoded size of each event, for D38's segment cap;
 * - the local-time clock `TODAY()` reads.
 *
 * A refusal is a typed result, never a worker error (D23); an error that
 * does escape is redacted to its kind (CA-04) — no name, value, or formula
 * text crosses in an error.
 */

import { encodeBase64Url } from "../../domain/model/bytes.js";
import { decodeDomainId, encodeDomainId, type DomainIdKind } from "../../domain/model/ids.js";
import type { FieldTypeV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import type { RuleConditionV2 } from "../../domain/validation/rules.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { EntropyPort } from "../../application/ports/entropy.js";
import type { RecordRuleIRV1, SchemaImpactCountsV1 } from "../../application/ports/event-repository.js";
import {
  executeSchemaChange,
  previewSchemaChange,
  type DefinitionDigestSubjectV1,
  type SchemaChangeRequestV1,
  type SchemaCommandDependenciesV1,
  type SchemaCommitLimitsV1,
  type SchemaRefusalV1,
} from "../../application/commands/schema-commands.js";
import { readAppMetrics, readAppStructure, type MetricV1 } from "../../application/queries/structure.js";
import { sha256 } from "../../crypto/hash.js";
import { workbookFingerprintInput } from "../../import/inference/statements.js";
import {
  encodeEnumOption,
  encodeFormulaDefinition,
  encodeRelationship,
  encodeRuleIR,
} from "../../import/staging/roots.js";
import { encodeCanonical } from "../../persistence/codecs/canonical-cbor.js";
import type {
  AppStructureViewV1,
  ApplySchemaChangeRequestV1,
  CellWireValueV1,
  FieldTypeWireV1,
  DataWorkerResponseV1,
  GetAppMetricsRequestV1,
  GetAppStructureRequestV1,
  ImpactReportWireV1,
  MetricViewV1,
  PreviewSchemaChangeRequestV1,
  RuleConditionWireV1,
  SchemaChangeWireV1,
  SchemaRefusalWireV1,
} from "../protocol/messages.js";
import { DataWorkerCommandError } from "../protocol/redact.js";
import { localClockReading, type AppSessionV1 } from "./app-session.js";
import { encodeAuthoredRecordBytes, encodeRecordEventPayload } from "./record-event-payloads.js";
import { toDomainValue, toWireValue } from "./record-handlers.js";
import { encodeTableDefinition } from "./schema-event-payloads.js";

/** How long a `TODAY()` result may stand before a read refreshes it (D60). */
const VOLATILE_MAX_AGE_MS = 60_000;

export interface StructureHandlerDependenciesV1 {
  readonly clock: ClockPort;
  readonly entropy: EntropyPort;
  /** The open session of a catalog app, hydrating it if needed. */
  readonly appSession: (appId: string) => Promise<AppSessionV1 | undefined>;
  /** Drops a session whose projection a failed commit disposed. */
  readonly closeAppSession: (appId: string) => void;
  /** D38's segment cap; tests pin a smaller one. */
  readonly limits?: SchemaCommitLimitsV1;
}

export interface StructureHandlersV1 {
  getAppStructure(request: GetAppStructureRequestV1): Promise<DataWorkerResponseV1>;
  previewSchemaChange(request: PreviewSchemaChangeRequestV1): Promise<DataWorkerResponseV1>;
  applySchemaChange(request: ApplySchemaChangeRequestV1): Promise<DataWorkerResponseV1>;
  getAppMetrics(request: GetAppMetricsRequestV1): Promise<DataWorkerResponseV1>;
}

export function createStructureHandlers(deps: StructureHandlerDependenciesV1): StructureHandlersV1 {
  const commandDeps = (session: AppSessionV1): SchemaCommandDependenciesV1 => ({
    clock: deps.clock,
    entropy: deps.entropy,
    projection: session.projection,
    repository: session.repository,
    formulaClock: () => localClockReading(deps.clock),
    recordDigest: (record) => sha256(encodeAuthoredRecordBytes(record)),
    definitionDigest: (subject) => sha256(definitionBytes(subject)),
    rejectionFingerprint: (relationship) => {
      const names = new Map(
        session.projection
          .execute({ kind: "list-tables" })
          .flatMap((table) => [
            [encodeDomainId(table.tableId), table.displayName] as const,
            ...session.projection
              .execute({ kind: "list-fields", tableId: table.tableId })
              .map((field) => [encodeDomainId(field.fieldId), field.displayName] as const),
          ]),
      );
      // F03's own fingerprint function, over what the app still knows of the
      // relationship. The import-time evidence terms are not kept, so the
      // re-upload consumer (F06) matches on this scope.
      const input = workbookFingerprintInput(
        "relationship",
        [
          names.get(encodeDomainId(relationship.fromTableId)) ?? "",
          names.get(encodeDomainId(relationship.fromFieldId)) ?? "",
          names.get(encodeDomainId(relationship.toTableId)) ?? "",
        ],
        [],
      );
      return sha256(new TextEncoder().encode(input));
    },
    payloadByteLength: (event) => encodeCanonical(encodeRecordEventPayload(event)).byteLength,
    ...(deps.limits === undefined ? {} : { limits: deps.limits }),
  });

  return {
    async getAppStructure(request) {
      const session = await deps.appSession(request.appId);
      return {
        kind: "getAppStructure",
        structure: session === undefined ? null : toStructureView(request.appId, session),
      };
    },

    async previewSchemaChange(request) {
      const session = await deps.appSession(request.appId);
      if (session === undefined) {
        return { kind: "previewSchemaChange", preview: null };
      }
      const preview = await previewSchemaChange(commandDeps(session), toRequest(request.change));
      return {
        kind: "previewSchemaChange",
        preview: {
          schemaRevision: Number(preview.schemaRevision),
          impact: toImpactWire(preview.impact),
          eventCount: preview.eventCount,
          refusal: preview.refusal === null ? null : toRefusalWire(preview.refusal),
          isTooLarge: preview.isTooLarge,
        },
      };
    },

    async applySchemaChange(request) {
      const session = await deps.appSession(request.appId);
      if (session === undefined) {
        return { kind: "applySchemaChange", outcome: { result: "unknown-app" } };
      }
      if (!Number.isSafeInteger(request.previewedSchemaRevision) || request.previewedSchemaRevision < 0) {
        throw new DataWorkerCommandError("malformed-request");
      }
      let result: Awaited<ReturnType<typeof executeSchemaChange>>;
      try {
        result = await executeSchemaChange(
          commandDeps(session),
          toRequest(request.change),
          BigInt(request.previewedSchemaRevision),
        );
      } catch (cause) {
        // A replay guard failing after the commit landed disposes the
        // projection; the commit is durable, so the next read re-hydrates.
        deps.closeAppSession(request.appId);
        throw cause;
      }
      switch (result.result) {
        case "applied":
          return {
            kind: "applySchemaChange",
            outcome: {
              result: "applied",
              commitId: encodeBase64Url(result.commit.commit.commitId),
              headRevision: Number(result.commit.headRevision),
              schemaRevision: Number(result.schemaRevision),
              impact: toImpactWire(result.impact),
              recalculated: { fieldIds: result.recalculatedFieldIds.map((fieldId) => encodeDomainId(fieldId)) },
            },
          };
        case "unchanged":
          return { kind: "applySchemaChange", outcome: { result: "unchanged", schemaRevision: Number(result.schemaRevision) } };
        case "stale-preview":
          return { kind: "applySchemaChange", outcome: { result: "stale-preview", schemaRevision: Number(result.schemaRevision) } };
        case "refused":
          return { kind: "applySchemaChange", outcome: { result: "refused", refusal: toRefusalWire(result.refusal) } };
        case "too-large":
          return {
            kind: "applySchemaChange",
            outcome: {
              result: "too-large",
              eventCount: result.eventCount,
              byteLength: result.byteLength,
              maxEvents: result.limits.maxEvents,
              maxBytes: result.limits.maxBytes,
            },
          };
        default: {
          const unreachable: never = result;
          return unreachable;
        }
      }
    },

    async getAppMetrics(request) {
      const session = await deps.appSession(request.appId);
      if (session === undefined) {
        return { kind: "getAppMetrics", metrics: null };
      }
      await session.projection.refreshVolatile(VOLATILE_MAX_AGE_MS);
      const metrics = readAppMetrics(session.projection);
      return {
        kind: "getAppMetrics",
        metrics: {
          tables: metrics.tables.map((table) => ({
            tableId: encodeDomainId(table.tableId),
            metrics: table.metrics.map(toMetricView),
          })),
          dashboard: metrics.dashboard.map(toMetricView),
        },
      };
    },
  };
}

// ------------------------------------------------------------ canonical bytes --

/** The exact bytes a prior hash is taken over: M23's canonical definitions. */
function definitionBytes(subject: DefinitionDigestSubjectV1): Uint8Array {
  switch (subject.kind) {
    case "app-name":
      return new TextEncoder().encode(subject.name);
    case "table":
      return encodeCanonical(encodeTableDefinition(subject.table));
    case "options":
      return encodeCanonical(subject.options.map(encodeEnumOption));
    case "relationship":
      return encodeCanonical(encodeRelationship(subject.relationship));
    case "rule":
      return encodeCanonical(encodeRuleIR(subject.rule));
    case "formula":
      return encodeCanonical(encodeFormulaDefinition(subject.formula));
    default: {
      const unreachable: never = subject;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------- wire → domain --

const idOf = <K extends DomainIdKind>(kind: K, text: string) => {
  try {
    return decodeDomainId(kind, text);
  } catch {
    throw new DataWorkerCommandError("malformed-request");
  }
};
const optionalIdOf = <K extends DomainIdKind>(kind: K, text: string | null) => (text === null ? null : idOf(kind, text));

/** A rule's literal, at the D28 entry boundary; a preserved-invalid value is import-only. */
const valueOf = (value: CellWireValueV1): CellValueV1 => {
  if (value.kind === "invalid") throw new DataWorkerCommandError("malformed-request");
  return toDomainValue(value);
};

function conditionOf(condition: RuleConditionWireV1): RuleConditionV2 {
  switch (condition.kind) {
    case "field-present":
    case "field-absent":
      return { kind: condition.kind, fieldId: idOf("field", condition.fieldId) };
    case "field-equals":
      return { kind: condition.kind, fieldId: idOf("field", condition.fieldId), value: valueOf(condition.value) };
    case "all":
    case "any":
      return { kind: condition.kind, conditions: condition.conditions.map(conditionOf) };
    case "not":
      return { kind: condition.kind, condition: conditionOf(condition.condition) };
    case "compare":
      return {
        kind: condition.kind,
        left: idOf("field", condition.left),
        op: condition.op,
        right: "field" in condition.right ? { field: idOf("field", condition.right.field) } : { value: valueOf(condition.right.value) },
        ...(condition.measure === undefined ? {} : { measure: condition.measure }),
      };
    case "between":
    case "not-between":
      return {
        kind: condition.kind,
        fieldId: idOf("field", condition.fieldId),
        low: valueOf(condition.low),
        high: valueOf(condition.high),
        ...(condition.measure === undefined ? {} : { measure: condition.measure }),
      };
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
}

/** The wire's field type is the domain's closed union (a currency carries its code). */
const typeOf = (type: FieldTypeWireV1): FieldTypeV1 => type;

export function toRequest(change: SchemaChangeWireV1): SchemaChangeRequestV1 {
  switch (change.kind) {
    case "rename-app":
      return change;
    case "rename-table":
      return { kind: change.kind, tableId: idOf("table", change.tableId), name: change.name };
    case "set-table-label":
      return { kind: change.kind, tableId: idOf("table", change.tableId), labelFieldId: optionalIdOf("field", change.labelFieldId) };
    case "set-table-key":
      return { kind: change.kind, tableId: idOf("table", change.tableId), keyFieldId: optionalIdOf("field", change.keyFieldId) };
    case "create-field":
      return {
        kind: change.kind,
        tableId: idOf("table", change.tableId),
        displayName: change.displayName,
        type: typeOf(change.type),
        isRequired: change.isRequired,
        optionLabels: change.optionLabels,
      };
    case "rename-field":
      return { kind: change.kind, fieldId: idOf("field", change.fieldId), name: change.name };
    case "change-field-type":
      return {
        kind: change.kind,
        fieldId: idOf("field", change.fieldId),
        type: typeOf(change.type),
        ...(change.optionLabels === undefined ? {} : { optionLabels: change.optionLabels }),
      };
    case "set-required":
      return { kind: change.kind, fieldId: idOf("field", change.fieldId), isRequired: change.isRequired };
    case "deactivate-field":
    case "reactivate-field":
      return { kind: change.kind, fieldId: idOf("field", change.fieldId) };
    case "reorder-fields":
      return { kind: change.kind, tableId: idOf("table", change.tableId), fieldIds: change.fieldIds.map((fieldId) => idOf("field", fieldId)) };
    case "set-enum-options":
      return {
        kind: change.kind,
        fieldId: idOf("field", change.fieldId),
        options: change.options.map((option) => ({
          optionId: optionalIdOf("option", option.optionId),
          label: option.label,
          isActive: option.isActive,
        })),
      };
    case "set-relationship":
      return {
        kind: change.kind,
        relationshipId: optionalIdOf("relationship", change.relationshipId),
        fromFieldId: idOf("field", change.fromFieldId),
        toTableId: idOf("table", change.toTableId),
        isActive: change.isActive,
      };
    case "remove-relationship":
      return { kind: change.kind, relationshipId: idOf("relationship", change.relationshipId) };
    case "save-rule":
      return {
        kind: change.kind,
        ruleId: optionalIdOf("rule", change.ruleId),
        tableId: idOf("table", change.tableId),
        displayName: change.displayName,
        condition: conditionOf(change.condition),
        severity: change.severity,
      };
    case "remove-rule":
      return { kind: change.kind, ruleId: idOf("rule", change.ruleId) };
    case "save-formula": {
      const target = change.target;
      return {
        kind: change.kind,
        formulaId: optionalIdOf("formula", change.formulaId),
        displayName: change.displayName,
        text: change.text,
        target:
          target.kind === "computed-column"
            ? {
                kind: target.kind,
                tableId: idOf("table", target.tableId),
                fieldId: optionalIdOf("field", target.fieldId),
                newField: target.newField === null ? null : { displayName: target.newField.displayName, type: typeOf(target.newField.type) },
              }
            : target.kind === "table-metric"
              ? { kind: target.kind, tableId: idOf("table", target.tableId) }
              : { kind: target.kind, tableId: optionalIdOf("table", target.tableId) },
      };
    }
    case "remove-formula":
      return { kind: change.kind, formulaId: idOf("formula", change.formulaId) };
    default: {
      const unreachable: never = change;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------- domain → wire --

function conditionWire(condition: RuleConditionV2): RuleConditionWireV1 {
  switch (condition.kind) {
    case "field-present":
    case "field-absent":
      return { kind: condition.kind, fieldId: encodeDomainId(condition.fieldId) };
    case "field-equals":
      return { kind: condition.kind, fieldId: encodeDomainId(condition.fieldId), value: toWireValue(condition.value) };
    case "all":
    case "any":
      return { kind: condition.kind, conditions: condition.conditions.map(conditionWire) };
    case "not":
      return { kind: condition.kind, condition: conditionWire(condition.condition) };
    case "compare":
      return {
        kind: condition.kind,
        left: encodeDomainId(condition.left),
        op: condition.op,
        right:
          "field" in condition.right
            ? { field: encodeDomainId(condition.right.field) }
            : { value: toWireValue(condition.right.value) },
        ...(condition.measure === undefined ? {} : { measure: condition.measure }),
      };
    case "between":
    case "not-between":
      return {
        kind: condition.kind,
        fieldId: encodeDomainId(condition.fieldId),
        low: toWireValue(condition.low),
        high: toWireValue(condition.high),
        ...(condition.measure === undefined ? {} : { measure: condition.measure }),
      };
    default: {
      const unreachable: never = condition;
      return unreachable;
    }
  }
}

const ruleWire = (displayName: string, rule: RecordRuleIRV1) => ({
  ruleId: encodeDomainId(rule.ruleId),
  displayName,
  irVersion: rule.irVersion,
  severity: rule.severity,
  condition: conditionWire(rule.condition),
});

function toStructureView(appId: string, session: AppSessionV1): AppStructureViewV1 {
  const structure = readAppStructure(session.projection);
  return {
    appId,
    displayName: structure.displayName,
    schemaRevision: Number(structure.schemaRevision),
    tables: structure.tables.map((table) => ({
      tableId: encodeDomainId(table.tableId),
      displayName: table.displayName,
      tableOrdinal: table.tableOrdinal,
      keyFieldId: table.keyFieldId === null ? null : encodeDomainId(table.keyFieldId),
      labelFieldId: table.labelFieldId === null ? null : encodeDomainId(table.labelFieldId),
      recordCount: table.recordCount,
      fields: table.fields.map(({ field, enumOptions }) => ({
        fieldId: encodeDomainId(field.fieldId),
        displayName: field.displayName,
        fieldOrdinal: field.fieldOrdinal,
        type: field.type,
        isRequired: field.isRequired,
        isActive: field.isActive,
        formulaId: field.formulaId === undefined ? null : encodeDomainId(field.formulaId),
        enumOptions: enumOptions.map((option) => ({
          optionId: encodeDomainId(option.optionId),
          label: option.displayLabel,
          optionOrdinal: option.optionOrdinal,
          isActive: option.isActive,
        })),
      })),
      rules: table.rules.map((entry) => ruleWire(entry.displayName, entry.rule)),
    })),
    relationships: structure.relationships.map(({ relationship, fromTableName, toTableName }) => ({
      relationshipId: encodeDomainId(relationship.relationshipId),
      fromTableId: encodeDomainId(relationship.fromTableId),
      fromFieldId: encodeDomainId(relationship.fromFieldId),
      toTableId: encodeDomainId(relationship.toTableId),
      toKeyFieldId: encodeDomainId(relationship.toKeyFieldId),
      fromTableName,
      toTableName,
      detectionSource: relationship.detectionSource,
      isActive: relationship.isActive,
    })),
    formulas: structure.formulas.map(({ formula, renderedText, isActive }) => ({
      formulaId: encodeDomainId(formula.formulaId),
      target:
        formula.target.kind === "computed-column"
          ? { kind: formula.target.kind, tableId: encodeDomainId(formula.target.tableId), fieldId: encodeDomainId(formula.target.fieldId) }
          : formula.target.kind === "table-metric"
            ? { kind: formula.target.kind, tableId: encodeDomainId(formula.target.tableId) }
            : { kind: formula.target.kind, tableId: formula.target.tableId === null ? null : encodeDomainId(formula.target.tableId) },
      displayName: formula.displayName,
      text: renderedText,
      disposition: formula.disposition,
      determinism: formula.determinism,
      isActive,
    })),
  };
}

const toImpactWire = (impact: SchemaImpactCountsV1): ImpactReportWireV1 => ({ ...impact });

function toRefusalWire(refusal: SchemaRefusalV1): SchemaRefusalWireV1 {
  switch (refusal.kind) {
    case "transition":
      return {
        kind: refusal.kind,
        refusals: refusal.refusals.map((entry) => ({
          kind: entry.kind,
          fieldId: entry.fieldId === null ? null : encodeDomainId(entry.fieldId),
          messageKey: entry.messageKey,
        })),
      };
    case "unknown-subject":
    case "invalid-change":
    case "formula":
    case "validation":
      return refusal;
    default: {
      const unreachable: never = refusal;
      return unreachable;
    }
  }
}

const toMetricView = (metric: MetricV1): MetricViewV1 => ({
  formulaId: encodeDomainId(metric.formulaId),
  displayName: metric.displayName,
  status: metric.status,
  value: metric.value === null ? null : toWireValue(metric.value),
  code: metric.code,
  evaluatedAtEpochMs: metric.evaluatedAtMs,
});
