import type { DurableHomeAssignedPayloadV1 } from "../../domain/model/events.js";
import { IntegrityError } from "../../domain/model/errors.js";
import type { AppChainStateV1, CommitPlanV1 } from "../ports/event-repository.js";
import { buildAuthoredCommit, type BuildCommitDependenciesV1 } from "./build-commit.js";

/** Scratch-to-home is one authored commit and never changes the app schema. */
export function buildHomeAssignment(deps: BuildCommitDependenciesV1, chain: AppChainStateV1,
  currentHomeId: string | null, assignment: DurableHomeAssignedPayloadV1): CommitPlanV1 {
  if (currentHomeId !== null) throw new IntegrityError("only a scratch app may receive a home");
  return buildAuthoredCommit(deps, chain, [{ subject: {}, event: { kind: "durable-home.assigned", payload: assignment } }]);
}
