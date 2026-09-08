/**
 * M12 — the in-memory relational projection of one unlocked app.
 *
 * This is the whole surface a composition root binds to. Everything else in the
 * module tree is internal: the SQL templates, the statement cache, the row
 * mapping, and the order keys are not reachable from here, so no consumer can
 * assemble a statement of its own or write a lane by hand.
 *
 * The engine runs in the data worker only. It opens `:memory:`, holds plaintext,
 * persists nothing, and is destroyed by disposing it or by terminating the
 * worker on lock (invariant 3). It never opens IndexedDB and never decrypts —
 * a caller hands it decoded checkpoint pages, and later decoded commits.
 */

export { openProjection, disposeProjection } from "./engine.js";
export type {
  OpenProjectionInitV1,
  ProjectionHandleV1,
} from "./engine.js";

export { hydrateApp } from "./hydrate.js";
export { applyEvents } from "./apply-events.js";
export { executeQuery } from "./query-exec.js";

export {
  DECIMAL_ORDER_KEY_BYTES,
  DECIMAL_ORDER_KEY_VERSION,
  TEXT_SORT_KEY_VERSION,
} from "./sort-keys.js";

export type {
  ChangeHistoryCursorV1,
  ChangeSubjectKindV1,
  ProjectionAppStateV1,
  ProjectionCellRowV1,
  ProjectionChangeEventV1,
  ProjectionChangeHistoryPageV1,
  ProjectionChangeSummaryV1,
  ProjectionCheckpointV1,
  ProjectionCommitV1,
  ProjectionIssueRowV1,
  ProjectionQueryKindV1,
  ProjectionQueryResultsV1,
  ProjectionQueryV1,
  ProjectionRecordDetailV1,
  ProjectionRecordPageResultV1,
  ProjectionRecordPageV1,
  ProjectionRecordSummaryV1,
  ProjectionRecordV1,
  ProjectionSheetSnapshotV1,
  ProjectionTableSummaryV1,
  ProjectionValidationRuleV1,
  SheetClassificationV1,
  Sha256Fn,
  ValidationIssueV1Input,
} from "./types.js";
