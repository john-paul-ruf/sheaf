/**
 * What a workbook import leaves behind besides tables: its sheets, the content
 * that stays inert, the review decisions, and the import's own lineage
 * (database.md § `sheet_snapshots`, `inert_content`, `inference_decisions`,
 * `import_lineages`; D37, D40, D46).
 *
 * Every shape here is durable only inside the encrypted checkpoint manifest or
 * an event payload (invariant 4); the projection rows migration 005 defines are
 * their unlocked, ephemeral reading. The closed lists are 005's `CHECK` lists
 * where 005 closes the column, and this module's own where 005 leaves the
 * column open (`item_kind`, `reason_key`) — `tests/unit/domain/snapshots.test.ts`
 * pins the former against the migration.
 */

import type {
  CommitId,
  DecisionId,
  EventId,
  InertItemId,
  LineageId,
  SheetId,
} from "./ids.js";
import type { InferenceDispositionV1, Sha256V1 } from "./events.js";

/** One or more roles a sheet plays (`sheet_snapshots.classification_cbor`). */
export const SHEET_CLASSIFICATIONS = Object.freeze([
  "table",
  "lookup",
  "summary",
  "chart",
  "snapshot",
] as const);

export type SheetClassificationV1 = (typeof SHEET_CLASSIFICATIONS)[number];

/**
 * One imported sheet and the safe snapshot that preserves it. The table built
 * from it (if any) names it by `sheetId`; `table.created` carries the whole
 * descriptor so an appended table's sheet row can be built from the tail.
 */
export interface SheetDescriptorV1 {
  readonly sheetId: SheetId;
  /** The original sheet label. */
  readonly displayName: string;
  readonly sheetOrdinal: number;
  /** Never empty: every imported sheet plays at least one role. */
  readonly classification: readonly SheetClassificationV1[];
  /** Storage-id text of the encrypted snapshot manifest root. */
  readonly snapshotManifestStorageId: string;
  /** Null when the source never declared it — never shown as zero. */
  readonly declaredRowCount: number | null;
  readonly declaredColumnCount: number | null;
  /** The source/snapshot generation this sheet was written at. */
  readonly snapshotRevision: bigint;
}

/** A rectangle of cells, zero-based and inclusive on both corners. */
export interface CellRangeV1 {
  readonly firstRow: number;
  readonly firstColumn: number;
  readonly lastRow: number;
  readonly lastColumn: number;
}

/**
 * D40's closed kind list. Cell styling and conditional formatting are one item
 * per sheet, never one per cell, so the inventory stays bounded.
 */
export const INERT_ITEM_KINDS = Object.freeze([
  "formula",
  "chart",
  "pivot-table",
  "drawing",
  "image",
  "comment",
  "external-link",
  "hyperlink",
  "embedded-object",
  "form-control",
  "data-connection",
  "conditional-formatting",
  "cell-styling",
  "sparkline",
  "script",
  "unsupported-validation",
] as const);

export type InertItemKindV1 = (typeof INERT_ITEM_KINDS)[number];

/**
 * Why an item is not interactive. Keys, never sentences: wording is M37's. The
 * list is closed so a surface can say something true for every member.
 *
 * - `formula-not-live-yet` — preserved text and cached value; evaluated from
 *   F04 (D33).
 * - `chart-not-live-yet` — charts and pivots are kept as snapshots and rebuilt
 *   live in F04 (D45).
 * - `object-not-rendered` — drawings, images, embedded objects, form controls,
 *   sparklines: kept in the source, never rendered (invariant 8).
 * - `link-not-followed` — external links, hyperlinks, data connections are
 *   never fetched (invariant 12).
 * - `script-never-runs` — macros and scripts never execute (invariant 8).
 * - `formatting-not-reproduced` — styling and conditional formatting.
 * - `validation-not-expressible` — a validation the rule IR cannot state.
 * - `kept-in-source` — anything else preserved only in the original source.
 */
export const INERT_REASON_KEYS = Object.freeze([
  "formula-not-live-yet",
  "chart-not-live-yet",
  "object-not-rendered",
  "link-not-followed",
  "script-never-runs",
  "formatting-not-reproduced",
  "validation-not-expressible",
  "kept-in-source",
] as const);

export type InertReasonKeyV1 = (typeof INERT_REASON_KEYS)[number];

/** One piece of imported content that is kept, listed, and never executed. */
export interface InertItemV1 {
  readonly inertItemId: InertItemId;
  readonly sheetId: SheetId;
  readonly kind: InertItemKindV1;
  /** A user-understandable sheet/range/part location, e.g. `Overview!B2:F9`. */
  readonly location: string;
  readonly reasonKey: InertReasonKeyV1;
  /** Where the item sits in the sheet's snapshot, when it has a cell range. */
  readonly anchor: CellRangeV1 | null;
  /** Storage-id text of a separately preserved original object, if any. */
  readonly preservedManifestStorageId: string | null;
}

/** migration 005's `inference_decisions.decision_kind` CHECK, verbatim. */
export const DECISION_KINDS = Object.freeze([
  "header",
  "discarded-row",
  "table-split",
  "table-merge",
  "column-type",
  "enum",
  "relationship",
  "formula",
  "sheet-classification",
  "record-rule",
] as const);

export type DecisionKindV1 = (typeof DECISION_KINDS)[number];

/**
 * One review decision, as the checkpoint keeps it. `decisionKind` is null for a
 * statement subject 005 has no kind for (an app or table name, say): such a
 * decision is durable evidence but is **not projectable** — hydration inserts
 * only rows with a kind, so `(decision_kind, fingerprint)` stays unique by
 * construction. The subject→kind mapping is M21's (`decisionKindOf`).
 */
export interface InferenceDecisionRecordV1 {
  readonly decisionId: DecisionId;
  /** The inference statement subject, as M21 names it. */
  readonly subject: string;
  readonly decisionKind: DecisionKindV1 | null;
  /** Names *what* was decided, never *how much* (32 bytes). */
  readonly evidenceFingerprint: Sha256V1;
  readonly disposition: InferenceDispositionV1;
  /** Canonically encodable; shape is the producer's. */
  readonly statement: unknown;
  readonly evidence: unknown;
  /** The `inference-decision.recorded` event that is its authority. */
  readonly recordedEventId: EventId;
}

export const IMPORT_KINDS = Object.freeze(["initial", "reupload"] as const);

export type ImportKindV1 = (typeof IMPORT_KINDS)[number];

/** One accepted import of a source into this app (`import_lineages`). */
export interface ImportLineageV1 {
  readonly lineageId: LineageId;
  readonly importKind: ImportKindV1;
  readonly importOrdinal: number;
  /** The decrypted file name, shown as evidence. */
  readonly sourceDisplayName: string;
  /** M22's `chunkedSha256` over the source (D46); 32 bytes. */
  readonly sourceSha256: Sha256V1;
  readonly acceptedAtMs: number;
  /**
   * Canonically encodable and never empty: an initial import records
   * `{ kind: "initial" }`; F06's re-upload records its key/match decisions.
   */
  readonly identityDecisions: unknown;
  readonly acceptedCommitId: CommitId;
}
