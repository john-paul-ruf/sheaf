/**
 * The read surface: one closed set of queries, and nothing else.
 *
 * `executeQuery` takes a value from a closed union, not a string, so there is
 * no way for a caller — or a user's text travelling through one — to reach SQL.
 * Every branch below runs a template from `statements.ts` with bound parameters
 * and maps the rows back into domain values.
 *
 * Two truthfulness rules from CA-14 are held here rather than promised:
 *
 * - **An exact count is only ever `count(*)`.** A page never reports a total,
 *   and `hasMore` is observed by reading one row past the page rather than
 *   estimated from anything.
 * - **A page boundary is a row key.** Paging and search both continue from
 *   `record_pk`, so a page cannot skip or repeat a record because rows were
 *   written between two requests — which is what `OFFSET` would do.
 *
 * A record's authoritative state is its authored payload, so every record this
 * module returns carries the complete authored value set — including the values
 * that have no typed cell. `record-by-id` additionally returns the typed cells
 * verbatim, which is where CA-13(b)'s "exactly one lane" and CA-13(c)'s
 * preserved-but-unindexed value are both visible to a consumer.
 */

import { CodecError } from "../../domain/model/errors.js";
import { asDomainId, compareDomainIds } from "../../domain/model/ids.js";
import type { FieldId, RecordId, RelationshipId } from "../../domain/model/ids.js";
import type { AuthoredRecordV1 } from "../../domain/model/events.js";
import type { RelationshipDefV1 } from "../../domain/model/schema.js";
import type { CellValueV1 } from "../../domain/model/values.js";
import {
  RELATIONSHIP_DETECTION_SOURCES,
  type FieldDefV1,
  type FieldTypeV1,
  type StorageKindV1,
} from "../../domain/model/schema.js";
import type { EnumOptionDefV1 } from "../../domain/model/schema.js";
import type { EventClassV1 } from "../../migrations/004_event_format_v1.js";
import type { SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  decodeAppTheme,
  decodeAuthoredRecord,
  decodeChangeSummary,
  decodeMessageParameters,
  decodeRuleIR,
  isValidationIssueKind,
  isValidationSeverity,
} from "./cbor-values.js";
import {
  assertUsable,
  selectRow,
  selectRows,
  type ProjectionHandleV1,
  type SqlParam,
} from "./engine.js";
import { idKey } from "./record-rows.js";
import {
  COUNT_CHILDREN,
  COUNT_RECORDS_FOR_TABLE,
  PAGE_CHILDREN_AFTER,
  PAGE_CHILDREN_FIRST,
  PAGE_CHANGE_HISTORY_AFTER,
  PAGE_CHANGE_HISTORY_FIRST,
  PAGE_RECORDS_AFTER,
  PAGE_RECORDS_FIRST,
  SEARCH_RECORDS_AFTER,
  SEARCH_RECORDS_FIRST,
  SELECT_ACTIVE_TABLES,
  SELECT_ALL_RELATIONSHIPS,
  SELECT_APP_STATE,
  SELECT_CELLS_FOR_RECORD,
  SELECT_ENUM_OPTIONS_FOR_FIELD,
  SELECT_FIELDS_FOR_TABLE,
  SELECT_HISTORY_FOR_RECORD,
  SELECT_ISSUES_FOR_RECORD,
  SELECT_RECORD_BY_ID,
  SELECT_LATEST_DELETE_FOR_RECORD,
  SELECT_RECORD_IS_LIVE,
  SELECT_RECORD_STATE_BY_ID,
  SELECT_RELATIONSHIPS_FOR_TABLE,
  SELECT_RULES_FOR_TABLE,
  toFtsMatchQuery,
} from "./statements.js";
import type {
  ChangeHistoryCursorV1,
  ChangeSubjectKindV1,
  ProjectionAppStateV1,
  ProjectionCellRowV1,
  ProjectionChangeEventV1,
  ProjectionChangeHistoryPageV1,
  ProjectionIssueRowV1,
  ProjectionQueryResultsV1,
  ProjectionQueryV1,
  ProjectionRecordDetailV1,
  ProjectionRecordPageResultV1,
  ProjectionDeletedRecordV1,
  ProjectionLabeledRecordV1,
  ProjectionRecordSummaryV1,
  ProjectionRelatedChildrenPageV1,
  ProjectionRelatedParentV1,
  ProjectionRelationshipV1,
  ProjectionTableSummaryV1,
  ProjectionValidationRuleV1,
} from "./types.js";

type Row = readonly SqlValue[];

/** A page is bounded: `RecordPageV1`'s 1,024-record cap is the ceiling here. */
const MAX_PAGE_SIZE = 1024;

/**
 * Runs one query from the closed set. The public signature ties each kind to
 * its own result type; the body below is written against the plain union, where
 * the compiler can narrow it, and the single cast between the two is the only
 * place the pairing is asserted rather than inferred.
 */
export function executeQuery<K extends ProjectionQueryV1["kind"]>(
  handle: ProjectionHandleV1,
  query: Extract<ProjectionQueryV1, { kind: K }>,
): ProjectionQueryResultsV1[K] {
  return runQuery(handle, query) as ProjectionQueryResultsV1[K];
}

type AnyResult = ProjectionQueryResultsV1[ProjectionQueryV1["kind"]];

function runQuery(
  handle: ProjectionHandleV1,
  query: ProjectionQueryV1,
): AnyResult {
  assertUsable(handle);
  const answer = (value: unknown): AnyResult => value as AnyResult;

  switch (query.kind) {
    case "app-state":
      return answer(readAppState(handle));
    case "list-tables":
      return answer(
        selectRows(handle, SELECT_ACTIVE_TABLES).map(toTableSummary),
      );
    case "list-fields":
      return answer(
        selectRows(handle, SELECT_FIELDS_FOR_TABLE, [query.tableId]).map((row) =>
          toFieldDef(handle, row),
        ),
      );
    case "list-enum-options":
      return answer(
        selectRows(handle, SELECT_ENUM_OPTIONS_FOR_FIELD, [query.fieldId]).map(
          toEnumOption,
        ),
      );
    case "list-validation-rules":
      return answer(
        selectRows(handle, SELECT_RULES_FOR_TABLE, [query.tableId]).map(toRule),
      );
    case "count-records":
      return answer(
        Number(
          selectRow(handle, COUNT_RECORDS_FOR_TABLE, [query.tableId])?.[0] ?? 0,
        ),
      );
    case "page-records":
      return answer(
        pageRecords(
          handle,
          query.afterRecordPk === null
            ? [PAGE_RECORDS_FIRST, [query.tableId]]
            : [PAGE_RECORDS_AFTER, [query.tableId, query.afterRecordPk]],
          query.limit,
        ),
      );
    case "search-records":
      return answer(searchRecords(handle, query));
    case "record-by-id":
      return answer(readRecord(handle, query.recordId));
    case "page-change-history":
      return answer(pageChangeHistory(handle, query.after, query.limit));
    case "record-change-history":
      return answer(
        selectRows(handle, SELECT_HISTORY_FOR_RECORD, [
          query.recordId,
          boundedLimit(query.limit),
        ]).map(toChangeEvent),
      );
    case "record-is-live":
      return answer(
        selectRow(handle, SELECT_RECORD_IS_LIVE, [query.recordId, query.tableId]) !==
          null,
      );
    case "list-relationships":
      return answer(
        (query.tableId === null
          ? selectRows(handle, SELECT_ALL_RELATIONSHIPS)
          : selectRows(handle, SELECT_RELATIONSHIPS_FOR_TABLE, [
              query.tableId,
              query.tableId,
            ])
        ).map(toRelationship),
      );
    case "related-parent":
      return answer(relatedParent(handle, query.recordId, query.fieldId));
    case "related-children":
      return answer(relatedChildren(handle, query));
    case "count-related-children": {
      const relationship = relationshipById(handle, query.relationshipId);
      return answer(
        relationship === null
          ? 0
          : Number(
              selectRow(handle, COUNT_CHILDREN, [
                relationship.fromFieldId,
                query.parentRecordId,
              ])?.[0] ?? 0,
            ),
      );
    }
    case "reference-candidates":
      return answer(referenceCandidates(handle, query));
    case "deleted-record":
      return answer(deletedRecord(handle, query.recordId));
    default: {
      const unreachable: never = query;
      return unreachable;
    }
  }
}

const boundedLimit = (limit: number): number => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new CodecError("page size is outside the bounded range");
  }
  return limit;
};

// ------------------------------------------------------------------- pages --

function pageRecords(
  handle: ProjectionHandleV1,
  [sql, parameters]: readonly [string, readonly SqlParam[]],
  limit: number,
): ProjectionRecordPageResultV1 {
  const bounded = boundedLimit(limit);
  // One row past the page: `hasMore` is something this observed, not a guess.
  const rows = selectRows(handle, sql, [...parameters, bounded + 1]);
  const page = rows.slice(0, bounded).map((row) => toRecordSummary(handle, row));

  return {
    records: page,
    hasMore: rows.length > bounded,
    nextRecordPk: page.at(-1)?.recordPk ?? null,
  };
}

function searchRecords(
  handle: ProjectionHandleV1,
  query: Extract<ProjectionQueryV1, { kind: "search-records" }>,
): ProjectionRecordPageResultV1 {
  const match = toFtsMatchQuery(query.text);
  if (match === null) {
    // Text with no words matches nothing, rather than everything.
    return { records: [], hasMore: false, nextRecordPk: null };
  }
  return pageRecords(
    handle,
    query.afterRecordPk === null
      ? [SEARCH_RECORDS_FIRST, [match, query.tableId]]
      : [SEARCH_RECORDS_AFTER, [match, query.tableId, query.afterRecordPk]],
    query.limit,
  );
}

function pageChangeHistory(
  handle: ProjectionHandleV1,
  after: ChangeHistoryCursorV1 | null,
  limit: number,
): ProjectionChangeHistoryPageV1 {
  const bounded = boundedLimit(limit);
  const rows =
    after === null
      ? selectRows(handle, PAGE_CHANGE_HISTORY_FIRST, [bounded + 1])
      : selectRows(handle, PAGE_CHANGE_HISTORY_AFTER, [
          after.wallTimeMs,
          after.logicalCounter,
          after.eventId,
          bounded + 1,
        ]);

  const page = rows.slice(0, bounded).map(toChangeEvent);
  const last = page.at(-1);

  return {
    events: page,
    hasMore: rows.length > bounded,
    nextCursor:
      last === undefined
        ? null
        : {
            wallTimeMs: last.wallTimeMs,
            logicalCounter: last.logicalCounter,
            eventId: last.eventId,
          },
  };
}

// ----------------------------------------------------------------- records --

function readRecord(
  handle: ProjectionHandleV1,
  recordId: RecordId,
): ProjectionRecordDetailV1 | null {
  const row = selectRow(handle, SELECT_RECORD_BY_ID, [recordId]);
  if (row === null) {
    return null;
  }

  const summary = toRecordSummary(handle, row);
  const authored = decodeAuthoredRecord(bytesAt(row, 4));

  return {
    ...summary,
    createdCommitId: asDomainId("commit", bytesAt(row, 7)),
    updatedCommitId: asDomainId("commit", bytesAt(row, 8)),
    provenance: new Map(
      [...authored.provenance].map(([fieldId, value]) => [
        canonicalFieldId(handle, fieldId),
        value,
      ]),
    ),
    cells: selectRows(handle, SELECT_CELLS_FOR_RECORD, [summary.recordPk]).map(
      (cell) => toCellRow(handle, cell),
    ),
    issues: selectRows(handle, SELECT_ISSUES_FOR_RECORD, [summary.recordPk]).map(
      toIssueRow,
    ),
  };
}

function toRecordSummary(
  handle: ProjectionHandleV1,
  row: Row,
): ProjectionRecordSummaryV1 {
  const authored = decodeAuthoredRecord(bytesAt(row, 4));
  return {
    recordPk: numberAt(row, 0),
    recordId: asDomainId("record", bytesAt(row, 1)),
    tableId: asDomainId("table", bytesAt(row, 2)),
    recordRevision: BigInt(numberAt(row, 3)),
    authoredValues: new Map(
      [...authored.values].map(([fieldId, value]) => [
        canonicalFieldId(handle, fieldId),
        value,
      ]),
    ),
    blockingIssueCount: numberAt(row, 5),
    warningIssueCount: numberAt(row, 6),
  };
}

/**
 * A decoded ID is a fresh `Uint8Array`, and a `Map` keyed by one matches on
 * object identity — so the keys returned here are the schema's own field
 * instances wherever the field is known. A consumer can then read a value with
 * the `fieldId` it got from `list-fields`, which is the only ergonomic that
 * makes these maps usable at all.
 */
function canonicalFieldId(
  handle: ProjectionHandleV1,
  fieldId: FieldId,
): FieldId {
  return handle.schema.fields.get(idKey(fieldId))?.fieldId ?? fieldId;
}

function toCellRow(handle: ProjectionHandleV1, row: Row): ProjectionCellRowV1 {
  const origin = textAt(row, 1);
  if (origin !== "authored" && origin !== "computed") {
    throw new CodecError("cell origin is not in the closed v1 list");
  }
  return {
    fieldId: canonicalFieldId(handle, asDomainId("field", bytesAt(row, 0))),
    origin,
    valueKind: textAt(row, 2) as StorageKindV1,
    textValue: optionalText(row, 3),
    textSortKey: optionalBytes(row, 4),
    decimalValue: optionalText(row, 5),
    decimalOrderKey: optionalBytes(row, 6),
    integerValue: row[7] === null ? null : numberAt(row, 7),
    idValue: optionalBytes(row, 8),
  };
}

function toIssueRow(row: Row): ProjectionIssueRowV1 {
  const kind = textAt(row, 3);
  const severity = textAt(row, 4);
  if (!isValidationIssueKind(kind) || !isValidationSeverity(severity)) {
    throw new CodecError("record issue is not in the closed v1 lists");
  }
  return {
    issueId: bytesAt(row, 0),
    fieldId: row[1] === null ? null : asDomainId("field", bytesAt(row, 1)),
    ruleId: row[2] === null ? null : asDomainId("rule", bytesAt(row, 2)),
    issueKind: kind as ProjectionIssueRowV1["issueKind"],
    severity: severity as ProjectionIssueRowV1["severity"],
    messageKey: textAt(row, 5),
    messageParameters: decodeMessageParameters(bytesAt(row, 6)),
  };
}

// ----------------------------------------------------------- relationships --

function relationshipById(
  handle: ProjectionHandleV1,
  relationshipId: RelationshipId,
): RelationshipDefV1 | null {
  for (const relationship of handle.schema.relationships.values()) {
    if (compareDomainIds(relationship.relationshipId, relationshipId) === 0) {
      return relationship;
    }
  }
  return null;
}

/**
 * The display text of a value, as a relationship surface shows a record: the
 * words a person reads, never an id. Absent values and references have none.
 */
function displayText(handle: ProjectionHandleV1, value: CellValueV1): string {
  switch (value.kind) {
    case "text":
      return value.text;
    case "decimal":
      return value.decimal;
    case "invalid-preserved":
      return value.sourceText;
    case "enum":
      return handle.schema.optionLabels.get(idKey(value.optionId)) ?? "";
    case "date":
      return new Date(value.epochDay * 86_400_000).toISOString().slice(0, 10);
    case "boolean":
      return value.boolean ? "true" : "false";
    case "reference":
    case "missing":
    case "blank":
      return "";
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

const valueAt = (
  record: AuthoredRecordV1,
  fieldId: Uint8Array,
): CellValueV1 | undefined =>
  [...record.values].find(([candidate]) => compareDomainIds(candidate, fieldId) === 0)?.[1];

/**
 * A record's label: its table's label field, else its key — the minimal
 * plaintext a relationship surface needs (invariant 3).
 */
function labelOf(handle: ProjectionHandleV1, record: AuthoredRecordV1): string {
  const table = handle.schema.tables.get(idKey(record.tableId));
  const fieldId = table?.labelFieldId ?? table?.keyFieldId ?? null;
  const value = fieldId === null ? undefined : valueAt(record, fieldId);
  return value === undefined ? "" : displayText(handle, value);
}

const toLabeled = (
  handle: ProjectionHandleV1,
  row: Row,
  authoredAt: number,
): ProjectionLabeledRecordV1 => ({
  recordPk: numberAt(row, 0),
  recordId: asDomainId("record", bytesAt(row, 1)),
  label: labelOf(handle, decodeAuthoredRecord(bytesAt(row, authoredAt))),
});

function latestDelete(
  handle: ProjectionHandleV1,
  recordId: Uint8Array,
): { readonly row: Row; readonly restoration: AuthoredRecordV1 } | null {
  const row = selectRow(handle, SELECT_LATEST_DELETE_FOR_RECORD, [recordId]);
  if (row === null || row[2] === null) {
    return null;
  }
  return { row, restoration: decodeAuthoredRecord(bytesAt(row, 2)) };
}

function relatedParent(
  handle: ProjectionHandleV1,
  recordId: RecordId,
  fieldId: FieldId,
): ProjectionRelatedParentV1 | null {
  const row = selectRow(handle, SELECT_RECORD_STATE_BY_ID, [recordId]);
  const relationship = handle.schema.relationships.get(idKey(fieldId));
  if (row === null || relationship === undefined || !relationship.isActive) {
    return null;
  }
  const value = valueAt(decodeAuthoredRecord(bytesAt(row, 4)), fieldId);
  if (value?.kind === "invalid-preserved") {
    // An imported key that matched no parent: the value *is* the original key.
    return { status: "broken", originalKey: value.sourceText };
  }
  if (value?.kind !== "reference") {
    return null;
  }

  const parent = selectRow(handle, SELECT_RECORD_STATE_BY_ID, [value.recordId]);
  if (parent !== null && compareDomainIds(bytesAt(parent, 1), relationship.toTableId) === 0) {
    return {
      status: "resolved",
      recordId: value.recordId,
      tableId: relationship.toTableId,
      label: labelOf(handle, decodeAuthoredRecord(bytesAt(parent, 4))),
    };
  }

  // The parent is gone. Its delete carried its whole record, key included.
  const deleted = latestDelete(handle, value.recordId);
  const key =
    deleted === null ? undefined : valueAt(deleted.restoration, relationship.toKeyFieldId);
  return {
    status: "broken",
    originalKey: key === undefined ? null : displayText(handle, key) || null,
  };
}

function relatedChildren(
  handle: ProjectionHandleV1,
  query: Extract<ProjectionQueryV1, { kind: "related-children" }>,
): ProjectionRelatedChildrenPageV1 | null {
  const relationship = relationshipById(handle, query.relationshipId);
  if (relationship === null) {
    return null;
  }
  const bounded = boundedLimit(query.limit);
  const rows =
    query.afterRecordPk === null
      ? selectRows(handle, PAGE_CHILDREN_FIRST, [
          relationship.fromFieldId,
          query.parentRecordId,
          bounded + 1,
        ])
      : selectRows(handle, PAGE_CHILDREN_AFTER, [
          relationship.fromFieldId,
          query.parentRecordId,
          query.afterRecordPk,
          bounded + 1,
        ]);
  const children = rows.slice(0, bounded).map((row) => toLabeled(handle, row, 2));
  return {
    children,
    hasMore: rows.length > bounded,
    nextRecordPk: rows.length > bounded ? (children.at(-1)?.recordPk ?? null) : null,
  };
}

function referenceCandidates(
  handle: ProjectionHandleV1,
  query: Extract<ProjectionQueryV1, { kind: "reference-candidates" }>,
): readonly ProjectionLabeledRecordV1[] {
  const relationship = relationshipById(handle, query.relationshipId);
  if (relationship === null) {
    return [];
  }
  const bounded = boundedLimit(query.limit);
  if (query.text.trim().length === 0) {
    return selectRows(handle, PAGE_RECORDS_FIRST, [relationship.toTableId, bounded]).map(
      (row) => toLabeled(handle, row, 4),
    );
  }
  const match = toFtsMatchQuery(query.text);
  if (match === null) {
    return [];
  }
  return selectRows(handle, SEARCH_RECORDS_FIRST, [
    match,
    relationship.toTableId,
    bounded,
  ]).map((row) => toLabeled(handle, row, 4));
}

function deletedRecord(
  handle: ProjectionHandleV1,
  recordId: RecordId,
): ProjectionDeletedRecordV1 | null {
  if (selectRow(handle, SELECT_RECORD_STATE_BY_ID, [recordId]) !== null) {
    return null;
  }
  const deleted = latestDelete(handle, recordId);
  if (deleted === null) {
    return null;
  }
  const { restoration } = deleted;
  const keyFieldId = handle.schema.tables.get(idKey(restoration.tableId))?.keyFieldId ?? null;
  return {
    tableId: restoration.tableId,
    restoration,
    deletedEventId: asDomainId("event", bytesAt(deleted.row, 0)),
    deletedAtMs: numberAt(deleted.row, 1),
    keyValue: keyFieldId === null ? null : (valueAt(restoration, keyFieldId) ?? null),
  };
}

// ------------------------------------------------------------------ schema --

function readAppState(handle: ProjectionHandleV1): ProjectionAppStateV1 {
  const row = selectRow(handle, SELECT_APP_STATE);
  if (row === null) {
    throw new CodecError("projection holds no app state");
  }
  const locality = textAt(row, 5);
  if (locality !== "present" && locality !== "oversized-local") {
    throw new CodecError("app locality is not in the closed v1 list");
  }
  return {
    appId: asDomainId("app", bytesAt(row, 0)),
    displayName: textAt(row, 1),
    createdAtMs: numberAt(row, 2),
    lastOpenedAtMs: row[3] === null ? null : numberAt(row, 3),
    schemaRevision: BigInt(numberAt(row, 4)),
    locality,
    durableHomeId: optionalBytes(row, 6),
    lastSuccessfulBackupMs: row[7] === null ? null : numberAt(row, 7),
    deviceOnlyChangeCount: numberAt(row, 8),
    theme: decodeAppTheme(bytesAt(row, 9)),
    stateRevision: BigInt(numberAt(row, 10)),
  };
}

function toTableSummary(row: Row): ProjectionTableSummaryV1 {
  return {
    tableId: asDomainId("table", bytesAt(row, 0)),
    displayName: textAt(row, 1),
    tableOrdinal: numberAt(row, 2),
    sourceSheetId: row[3] === null ? null : asDomainId("sheet", bytesAt(row, 3)),
    keyFieldId: row[4] === null ? null : asDomainId("field", bytesAt(row, 4)),
    labelFieldId: row[5] === null ? null : asDomainId("field", bytesAt(row, 5)),
    isActive: numberAt(row, 6) === 1,
    schemaRevision: BigInt(numberAt(row, 7)),
  };
}

function toFieldDef(handle: ProjectionHandleV1, row: Row): FieldDefV1 {
  const fieldId = asDomainId("field", bytesAt(row, 0));
  return {
    fieldId,
    tableId: asDomainId("table", bytesAt(row, 1)),
    displayName: textAt(row, 2),
    fieldOrdinal: numberAt(row, 3),
    type: fieldTypeOf(handle, fieldId, textAt(row, 4)),
    isRequired: numberAt(row, 6) === 1,
    isActive: numberAt(row, 7) === 1,
    schemaRevision: BigInt(numberAt(row, 8)),
  };
}

/**
 * `schema_fields.logical_type` names the type but cannot carry a currency's
 * code — migration 005 has no column for it — so the code comes from the field
 * definition hydration was given. A currency field the projection cannot name
 * the currency of is refused rather than answered with a guess. (Reported as a
 * schema gap; the SQL is DB-owned and not this session's to change.)
 */
function fieldTypeOf(
  handle: ProjectionHandleV1,
  fieldId: FieldId,
  logicalType: string,
): FieldTypeV1 {
  if (logicalType !== "currency") {
    return { kind: logicalType } as FieldTypeV1;
  }
  const known = handle.schema.fields.get(idKey(fieldId))?.type;
  if (known?.kind !== "currency") {
    throw new CodecError("currency field has no currency code in this session");
  }
  return known;
}

function toRelationship(row: Row): ProjectionRelationshipV1 {
  const source = textAt(row, 5);
  const detectionSource = RELATIONSHIP_DETECTION_SOURCES.find(
    (candidate) => candidate === source,
  );
  if (detectionSource === undefined) {
    throw new CodecError("detection source is not in the closed v1 list");
  }
  return {
    relationship: {
      relationshipId: asDomainId("relationship", bytesAt(row, 0)),
      fromTableId: asDomainId("table", bytesAt(row, 1)),
      fromFieldId: asDomainId("field", bytesAt(row, 2)),
      toTableId: asDomainId("table", bytesAt(row, 3)),
      toKeyFieldId: asDomainId("field", bytesAt(row, 4)),
      detectionSource,
      isActive: numberAt(row, 6) === 1,
      schemaRevision: BigInt(numberAt(row, 7)),
    },
    fromTableName: textAt(row, 8),
    toTableName: textAt(row, 9),
  };
}

function toEnumOption(row: Row): EnumOptionDefV1 {
  return {
    optionId: asDomainId("option", bytesAt(row, 0)),
    fieldId: asDomainId("field", bytesAt(row, 1)),
    displayLabel: textAt(row, 2),
    optionOrdinal: numberAt(row, 3),
    isActive: numberAt(row, 4) === 1,
    schemaRevision: BigInt(numberAt(row, 5)),
  };
}

function toRule(row: Row): ProjectionValidationRuleV1 {
  return {
    tableId: asDomainId("table", bytesAt(row, 1)),
    displayName: textAt(row, 2),
    rule: decodeRuleIR(bytesAt(row, 3), decodeMessageParameters(bytesAt(row, 5))),
    isActive: numberAt(row, 6) === 1,
    schemaRevision: BigInt(numberAt(row, 7)),
  };
}

function toChangeEvent(row: Row): ProjectionChangeEventV1 {
  return {
    eventId: asDomainId("event", bytesAt(row, 0)),
    commitId: asDomainId("commit", bytesAt(row, 1)),
    eventIndex: numberAt(row, 2),
    eventKind: textAt(row, 3),
    eventClass: textAt(row, 4) as EventClassV1,
    subjectKind: textAt(row, 5) as ChangeSubjectKindV1,
    subjectId: bytesAt(row, 6),
    wallTimeMs: numberAt(row, 7),
    logicalCounter: numberAt(row, 8),
    deviceId: asDomainId("device", bytesAt(row, 9)),
    summary: decodeChangeSummary(bytesAt(row, 10)),
    restoration:
      row[11] === null ? null : decodeAuthoredRecord(bytesAt(row, 11)),
  };
}

// ----------------------------------------------------------------- readers --

function bytesAt(row: Row, index: number): Uint8Array {
  const value = row[index];
  if (!(value instanceof Uint8Array)) {
    throw new CodecError("projection column is not a blob");
  }
  return value;
}

function textAt(row: Row, index: number): string {
  const value = row[index];
  if (typeof value !== "string") {
    throw new CodecError("projection column is not text");
  }
  return value;
}

function numberAt(row: Row, index: number): number {
  const value = row[index];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new CodecError("projection column is not an integer");
  }
  return Number(value);
}

function optionalText(row: Row, index: number): string | null {
  return row[index] === null ? null : textAt(row, index);
}

function optionalBytes(row: Row, index: number): Uint8Array | null {
  return row[index] === null ? null : bytesAt(row, index);
}
