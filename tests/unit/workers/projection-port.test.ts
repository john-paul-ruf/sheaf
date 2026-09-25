/**
 * M07's `ProjectionEnginePort` and M12's engine describe the same vocabulary
 * (CA-13).
 *
 * Commands and queries may not import `src/persistence/`, so the port restates
 * the projection's session types structurally. The cost of a restatement is
 * drift, and this is where it is paid: every shape is asserted assignable in
 * **both** directions, so a change to either side that the other did not follow
 * is a compile error in this file rather than a wrong answer in the worker.
 *
 * The worker is where the two meet — `app-session.ts` hands M12's engine out
 * behind M07's port with no conversion at all — so the assertion lives here
 * rather than under `tests/unit/queries/`, which may not import the engine.
 */

import { describe, expect, it } from "vitest";

import type * as Port from "../../../src/application/ports/projection.js";
import type * as Events from "../../../src/application/ports/event-repository.js";
import type { authoredState } from "../../../src/persistence/projection/authored-state.js";
import type * as Engine from "../../../src/persistence/projection/types.js";

/** `true` only when `Left` and `Right` are assignable to each other. */
type Mutual<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

/**
 * The argument is **required** and its type is the proof: passing `true` only
 * type-checks when `Mutual<Left, Right>` is `true`. A default would make every
 * call vacuous, which is the one way an assertion like this can look green and
 * mean nothing.
 */
function mutual<Left, Right>(_proof: Mutual<Left, Right>): void {
  void _proof;
}

describe("the projection port and the projection engine", () => {
  it("keeps the separate authored-state cursor structurally assignable both ways", () => {
    type EngineCursor = {
      authoredState(signal: Parameters<typeof authoredState>[1]): ReturnType<typeof authoredState>;
    };
    mutual<Port.ProjectionAuthoredStatePort, EngineCursor>(true);
    expect(true).toBe(true);
  });
  it("agree on every hydration shape", () => {
    mutual<Port.ProjectionAppStateV1, Engine.ProjectionAppStateV1>(true);
    mutual<Port.ProjectionSheetSnapshotV1, Engine.ProjectionSheetSnapshotV1>(true);
    mutual<Port.ProjectionValidationRuleV1, Engine.ProjectionValidationRuleV1>(true);
    mutual<Port.ProjectionFormulaV1, Engine.ProjectionFormulaV1>(true);
    // M01 states the F04 payloads generically (it may not name M02/M03); both
    // layers instantiate them, and the two instantiations must be one type.
    mutual<Events.DomainEventV1, Engine.DomainEventV1>(true);
    mutual<Events.RecordRuleIRV1, Engine.RecordRuleIRV1>(true);
    mutual<Port.ProjectionComputedCellV1, Engine.ProjectionComputedCellV1>(true);
    mutual<Port.ProjectionScalarResultV1, Engine.ProjectionScalarResultV1>(true);
    mutual<Port.ProjectionApplyReceiptV1, Engine.ProjectionApplyReceiptV1>(true);
    mutual<Port.ProjectionIssueInputV1, Engine.ValidationIssueV1Input>(true);
    mutual<Port.ProjectionRecordV1, Engine.ProjectionRecordV1>(true);
    mutual<Port.ProjectionRecordPageV1, Engine.ProjectionRecordPageV1>(true);
    mutual<Port.ProjectionCheckpointV1, Engine.ProjectionCheckpointV1>(true);
    mutual<Port.ProjectionInertItemV1, Engine.ProjectionInertItemV1>(true);
    mutual<
      Port.ProjectionInferenceDecisionV1,
      Engine.ProjectionInferenceDecisionV1
    >(true);
    mutual<Port.ProjectionCommitV1, Engine.ProjectionCommitV1>(true);
    expect(true).toBe(true);
  });

  it("agree on every query and every result", () => {
    mutual<Port.ProjectionQueryV1, Engine.ProjectionQueryV1>(true);
    mutual<Port.ProjectionQueryKindV1, Engine.ProjectionQueryKindV1>(true);
    mutual<Port.ProjectionQueryResultsV1, Engine.ProjectionQueryResultsV1>(true);
    mutual<Port.ProjectionTableSummaryV1, Engine.ProjectionTableSummaryV1>(true);
    mutual<Port.ProjectionCellRowV1, Engine.ProjectionCellRowV1>(true);
    mutual<Port.ProjectionIssueRowV1, Engine.ProjectionIssueRowV1>(true);
    mutual<Port.ProjectionRecordSummaryV1, Engine.ProjectionRecordSummaryV1>(true);
    mutual<Port.ProjectionRecordDetailV1, Engine.ProjectionRecordDetailV1>(true);
    mutual<
      Port.ProjectionRecordPageResultV1,
      Engine.ProjectionRecordPageResultV1
    >(true);
    mutual<Port.ProjectionChangeSummaryV1, Engine.ProjectionChangeSummaryV1>(true);
    mutual<Port.ProjectionChangeEventV1, Engine.ProjectionChangeEventV1>(true);
    mutual<Port.ProjectionHistoryCursorV1, Engine.ChangeHistoryCursorV1>(true);
    mutual<
      Port.ProjectionChangeHistoryPageV1,
      Engine.ProjectionChangeHistoryPageV1
    >(true);
    mutual<Port.ProjectionSubjectKindV1, Engine.ChangeSubjectKindV1>(true);
    mutual<Port.ProjectionRelationshipV1, Engine.ProjectionRelationshipV1>(true);
    mutual<Port.ProjectionRelatedParentV1, Engine.ProjectionRelatedParentV1>(true);
    mutual<Port.ProjectionLabeledRecordV1, Engine.ProjectionLabeledRecordV1>(true);
    mutual<
      Port.ProjectionRelatedChildrenPageV1,
      Engine.ProjectionRelatedChildrenPageV1
    >(true);
    mutual<Port.ProjectionDeletedRecordV1, Engine.ProjectionDeletedRecordV1>(true);
    mutual<Port.ProjectionSheetListingV1, Engine.ProjectionSheetListingV1>(true);
    expect(true).toBe(true);
  });

  it("keeps the query surface closed, member by member", () => {
    // A `Record` over the kind union is exhaustive both ways: a kind added on
    // either side without being listed here, or listed here without existing,
    // is a compile error.
    const kinds: Readonly<Record<Port.ProjectionQueryKindV1, true>> = {
      "app-state": true,
      "list-tables": true,
      "list-fields": true,
      "list-enum-options": true,
      "list-validation-rules": true,
      "count-records": true,
      "page-records": true,
      "search-records": true,
      "record-by-id": true,
      "page-change-history": true,
      "record-change-history": true,
      "record-is-live": true,
      "list-relationships": true,
      "related-parent": true,
      "related-children": true,
      "count-related-children": true,
      "reference-candidates": true,
      "deleted-record": true,
      "list-sheet-snapshots": true,
      "list-inert-items": true,
      "list-inference-decisions": true,
      "list-formulas": true,
      "scalar-results": true,
      "list-charts": true,
      "chart-dataset": true,
      "query-records": true,
    };
    expect(Object.keys(kinds)).toHaveLength(26);
  });
});
