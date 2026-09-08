/** Baseline append-only domain event and event-segment contract. */

export const EVENT_FORMAT_VERSION = 1;

export const EVENT_KINDS_V1 = Object.freeze([
  "app.created",
  "app.renamed",
  "table.created",
  "table.changed",
  "field.created",
  "field.changed",
  "enum.changed",
  "relationship.changed",
  "relationship.removed",
  "rule.changed",
  "rule.removed",
  "formula.changed",
  "formula.removed",
  "record.created",
  "record.patched",
  "record.deleted",
  "record.restored",
  "chart.saved",
  "chart.deleted",
  "theme.changed",
  "inference-decision.recorded",
  "import.accepted",
  "reupload.accepted",
  "durable-home.assigned",
  "conflict.detected",
  "conflict.resolved",
  "merge.applied",
  "app.deletion-marked",
] as const);

export type EventKindV1 = (typeof EVENT_KINDS_V1)[number];
export type EventClassV1 =
  | "authored"
  | "import"
  | "reconciliation"
  | "system";

export interface FrontierEntryV1 {
  readonly deviceId: Uint8Array;
  readonly commitSequence: bigint;
}

export interface HybridTimeV1 {
  readonly wallTimeMs: bigint;
  readonly logicalCounter: number;
}

export interface EventSubjectV1 {
  readonly appId: Uint8Array;
  readonly tableId?: Uint8Array;
  readonly recordId?: Uint8Array;
  readonly fieldId?: Uint8Array;
  readonly objectId?: Uint8Array;
}

export interface EventProvenanceV1 {
  readonly source:
    | "user"
    | "initial-import"
    | "workbook-reupload"
    | "remote-device"
    | "conflict-resolution"
    | "compaction";
  readonly sourceId?: Uint8Array;
  readonly sourceTimestampMs?: bigint;
  readonly evidence?: unknown;
}

export interface DomainEventV1 {
  readonly eventId: Uint8Array;
  readonly eventIndex: number;
  readonly kind: EventKindV1;
  readonly subject: EventSubjectV1;
  readonly payload: unknown;
  readonly provenance: EventProvenanceV1;
}

/** One acknowledged command or reconciliation decision is one atomic commit. */
export interface EventCommitV1 {
  readonly eventFormatVersion: 1;
  readonly commitId: Uint8Array;
  readonly appId: Uint8Array;
  readonly deviceId: Uint8Array;
  readonly deviceCommitSequence: bigint;
  readonly previousDeviceCommitSha256: Uint8Array | null;
  readonly basisFrontier: readonly FrontierEntryV1[];
  readonly hybridTime: HybridTimeV1;
  readonly eventClass: EventClassV1;
  readonly schemaRevisionBefore: bigint;
  readonly schemaRevisionAfter: bigint;
  readonly events: readonly DomainEventV1[];
  readonly commitSha256: Uint8Array;
}

export interface EventSegmentV1 {
  readonly eventFormatVersion: 1;
  readonly segmentId: Uint8Array;
  readonly appId: Uint8Array;
  readonly commits: readonly EventCommitV1[];
  readonly resultingFrontier: readonly FrontierEntryV1[];
  readonly semanticSha256: Uint8Array;
}

/** V1 has no predecessor; semantic validation occurs after this version gate. */
export function migrateEvent<T extends EventCommitV1 | EventSegmentV1>(
  value: T,
): T {
  if (value.eventFormatVersion !== EVENT_FORMAT_VERSION) {
    throw new Error("Unsupported event format version");
  }
  return value;
}
