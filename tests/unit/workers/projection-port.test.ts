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
  it("agree on every hydration shape", () => {
    mutual<Port.ProjectionAppStateV1, Engine.ProjectionAppStateV1>(true);
    mutual<Port.ProjectionSheetSnapshotV1, Engine.ProjectionSheetSnapshotV1>(true);
    mutual<Port.ProjectionValidationRuleV1, Engine.ProjectionValidationRuleV1>(true);
    mutual<Port.ProjectionIssueInputV1, Engine.ValidationIssueV1Input>(true);
    mutual<Port.ProjectionRecordV1, Engine.ProjectionRecordV1>(true);
    mutual<Port.ProjectionRecordPageV1, Engine.ProjectionRecordPageV1>(true);
    mutual<Port.ProjectionCheckpointV1, Engine.ProjectionCheckpointV1>(true);
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
    expect(true).toBe(true);
  });

  it("keeps the query surface closed at eleven members", () => {
    // A twelfth kind on either side breaks the mutual assignability above; this
    // is the human-readable half of the same fact.
    const kinds: readonly Port.ProjectionQueryKindV1[] = [
      "app-state",
      "list-tables",
      "list-fields",
      "list-enum-options",
      "list-validation-rules",
      "count-records",
      "page-records",
      "search-records",
      "record-by-id",
      "page-change-history",
      "record-change-history",
    ];
    expect(new Set(kinds).size).toBe(11);
  });
});
