/**
 * Relationship navigation, reference candidates, and the deleted-record read,
 * as bounded plans over the projection (M35; CAP-24, CA-21).
 *
 * The projection answers each fact once; what this module adds is the shape a
 * record surface reads in one request, and the bounds it must not exceed:
 *
 * - **Both directions.** A record's parents are its own reference fields,
 *   each resolved or broken (D36); its children are, per relationship that
 *   points at its table, an **exact** count (`count(*)`, CA-14) and the first
 *   few children — never the whole list. The rest is paged by row key.
 * - **Labels, not records.** Every related record crosses as its id and its
 *   label (label field, else key) — the minimal plaintext navigation needs
 *   (invariant 3). A related record's other values stay where they are until
 *   someone opens it.
 * - **Broken is a status, not an absence.** A reference that resolves to no
 *   live parent comes back `broken` with its original key when one is
 *   knowable, so the surface can say what is missing (STA-011).
 */

import { compareDomainIds } from "../../domain/model/ids.js";
import type {
  FieldId,
  RecordId,
  RelationshipId,
  TableId,
} from "../../domain/model/ids.js";
import type {
  ProjectionDeletedRecordV1,
  ProjectionEnginePort,
  ProjectionLabeledRecordV1,
  ProjectionRelatedChildrenPageV1,
  ProjectionRelatedParentV1,
  ProjectionRelationshipV1,
} from "../ports/projection.js";

/** How many children a record shows per relationship before paging. */
export const RELATED_CHILDREN_PREVIEW = 5;
export const DEFAULT_RELATED_PAGE_SIZE = 50;
export const MAX_RELATED_PAGE_SIZE = 1024;
export const DEFAULT_CANDIDATE_LIMIT = 20;
export const MAX_CANDIDATE_LIMIT = 100;

/** One of the record's own reference fields, and where it points. */
export interface RelatedParentV1 {
  readonly fieldId: FieldId;
  readonly relationshipId: RelationshipId;
  readonly parent: ProjectionRelatedParentV1;
}

/** One relationship pointing at the record's table, seen from the parent. */
export interface RelatedChildrenGroupV1 {
  readonly relationshipId: RelationshipId;
  readonly tableId: TableId;
  readonly tableName: string;
  /** Exact, because it is `count(*)`. */
  readonly count: number;
  readonly first: readonly ProjectionLabeledRecordV1[];
}

export interface RelatedRecordsV1 {
  readonly parents: readonly RelatedParentV1[];
  readonly children: readonly RelatedChildrenGroupV1[];
}

const sameId = (left: Uint8Array, right: Uint8Array): boolean =>
  compareDomainIds(left, right) === 0;

const boundedLimit = (limit: number, max: number, what: string): number => {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new RangeError(`${what} is outside the bounded range`);
  }
  return limit;
};

const activeRelationships = (
  projection: ProjectionEnginePort,
  tableId: TableId | null,
): readonly ProjectionRelationshipV1[] =>
  projection
    .execute({ kind: "list-relationships", tableId })
    .filter(({ relationship }) => relationship.isActive);

/**
 * The record's reference fields, resolved or broken. Also the `references`
 * of a record detail: a field that holds no reference (missing, blank) is
 * omitted rather than reported as broken.
 */
export function planRecordReferences(
  projection: ProjectionEnginePort,
  record: { readonly recordId: RecordId; readonly tableId: TableId },
): readonly RelatedParentV1[] {
  return activeRelationships(projection, record.tableId)
    .filter(({ relationship }) => sameId(relationship.fromTableId, record.tableId))
    .flatMap(({ relationship }) => {
      const parent = projection.execute({
        kind: "related-parent",
        recordId: record.recordId,
        fieldId: relationship.fromFieldId,
      });
      return parent === null
        ? []
        : [
            {
              fieldId: relationship.fromFieldId,
              relationshipId: relationship.relationshipId,
              parent,
            },
          ];
    });
}

/**
 * Both directions for one live record, in one bounded answer. Null when no
 * live record carries this id — a deleted record navigates nowhere.
 */
export function planRelatedRecords(
  projection: ProjectionEnginePort,
  recordId: RecordId,
): RelatedRecordsV1 | null {
  const record = projection.execute({ kind: "record-by-id", recordId });
  if (record === null) {
    return null;
  }

  const children = activeRelationships(projection, record.tableId)
    .filter(({ relationship }) => sameId(relationship.toTableId, record.tableId))
    .map(({ relationship, fromTableName }) => ({
      relationshipId: relationship.relationshipId,
      tableId: relationship.fromTableId,
      tableName: fromTableName,
      count: projection.execute({
        kind: "count-related-children",
        relationshipId: relationship.relationshipId,
        parentRecordId: record.recordId,
      }),
      first:
        projection.execute({
          kind: "related-children",
          relationshipId: relationship.relationshipId,
          parentRecordId: record.recordId,
          afterRecordPk: null,
          limit: RELATED_CHILDREN_PREVIEW,
        })?.children ?? [],
    }));

  return { parents: planRecordReferences(projection, record), children };
}

/** One page of a parent's children, continuing from a row key. */
export function planRelatedChildrenPage(
  projection: ProjectionEnginePort,
  request: {
    readonly relationshipId: RelationshipId;
    readonly parentRecordId: RecordId;
    readonly after: number | null;
    readonly limit?: number;
  },
): ProjectionRelatedChildrenPageV1 | null {
  return projection.execute({
    kind: "related-children",
    relationshipId: request.relationshipId,
    parentRecordId: request.parentRecordId,
    afterRecordPk: request.after,
    limit: boundedLimit(
      request.limit ?? DEFAULT_RELATED_PAGE_SIZE,
      MAX_RELATED_PAGE_SIZE,
      "a children page size",
    ),
  });
}

/**
 * Records a reference field may point at, searched by the parent table's text
 * (FTS). Null when the field is not the source of an active relationship.
 */
export function planReferenceCandidates(
  projection: ProjectionEnginePort,
  request: {
    readonly fieldId: FieldId;
    readonly text: string;
    readonly limit?: number;
  },
): readonly ProjectionLabeledRecordV1[] | null {
  const source = activeRelationships(projection, null).find(({ relationship }) =>
    sameId(relationship.fromFieldId, request.fieldId),
  );
  if (source === undefined) {
    return null;
  }
  return projection.execute({
    kind: "reference-candidates",
    relationshipId: source.relationship.relationshipId,
    text: request.text,
    limit: boundedLimit(
      request.limit ?? DEFAULT_CANDIDATE_LIMIT,
      MAX_CANDIDATE_LIMIT,
      "a candidate limit",
    ),
  });
}

/** The deleted record's original values (MOD-010); null while it is live. */
export function planDeletedRecord(
  projection: ProjectionEnginePort,
  recordId: RecordId,
): ProjectionDeletedRecordV1 | null {
  return projection.execute({ kind: "deleted-record", recordId });
}
