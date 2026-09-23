/**
 * The demo workbook's review, built the way the page receives it — never a
 * hand-authored proposal shape (SESSION-07 CP3). Not a test file: the vitest
 * include globs are extension-qualified.
 *
 * - The proposal is S02's pinned `fieldwork-q3.xlsx` proposal
 *   (`proposeFixture`, the pin's own harness) mapped through S06's wire
 *   mapping (`proposalWire`), exactly as `runInference` answers.
 * - A later state is S02's own `applyWorkbookReviewEdit` over that proposal,
 *   as the stage applies it, then the same wire mapping.
 * - The view model comes from driving the real import machine to `reviewing`
 *   with the real pre-flight report of the same workbook.
 */

import { createActor } from "xstate";
import { selectImportVm, type ImportReviewVm } from "../../../../src/application/view-models/import.js";
import { importMachine } from "../../../../src/application/workflows/import.machine.js";
import type { ImportServices } from "../../../../src/application/workflows/import-services.js";
import {
  applyWorkbookReviewEdit,
  type WorkbookReviewEditV1,
} from "../../../../src/import/inference/review-edits.js";
import type { WorkbookPreflightReportV1 } from "../../../../src/import/preflight/workbook.js";
import { proposalWire } from "../../../../src/workers/data/import-handlers.js";
import type { ProposedWorkbookWireV1 } from "../../../../src/workers/protocol/messages.js";
import { testFormulaIdentities } from "../../import/delimited-proposal.js";
import { DEMO, proposeFixture } from "../../import/inference/demo-harness.js";
import {
  cleanupReceipt,
  fakeImportServices,
  fixtureReport,
  resolves,
  stagePresent,
  workbookPreflightEvent,
  STAGE_ID,
} from "../../workflows/fakes.js";

export const ALL_SHEETS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const WITHOUT_ARCHIVE: readonly number[] = [0, 1, 2, 3, 4, 5];

/** The demo proposal (or another fixture's) after the given edits, as the wire carries it (CA-19). */
export async function demoProposal(
  selection: readonly number[] = ALL_SHEETS,
  edits: readonly WorkbookReviewEditV1[] = [],
  fixture: string = DEMO,
): Promise<ProposedWorkbookWireV1> {
  let proposal = await proposeFixture(fixture, selection);
  for (const edit of edits) {
    // As the stage applies it: every formula's outcome re-derived after the edit.
    const result = applyWorkbookReviewEdit(proposal, edit, testFormulaIdentities());
    if (result.kind !== "applied") throw new Error(`demo edit ${edit.kind} was refused: ${result.reason}`);
    proposal = result.proposal;
  }
  return proposalWire(proposal);
}

const reports = new Map<string, WorkbookPreflightReportV1>();

async function reportOf(fixture: string): Promise<WorkbookPreflightReportV1> {
  const report = reports.get(fixture) ?? (await fixtureReport(fixture));
  reports.set(fixture, report);
  return report;
}

const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * The review view model for `proposal`, reached through the real machine: the
 * demo's own report, the given selection, a completed stream, inference.
 */
export async function demoReviewVm(
  proposal: ProposedWorkbookWireV1,
  selection: readonly number[] = ALL_SHEETS,
  overrides: Partial<ImportServices> = {},
  fixture: string = DEMO,
): Promise<ImportReviewVm> {
  const report = await reportOf(fixture);
  const fake = fakeImportServices({
    beginStage: resolves({ kind: "beginImportStage" as const, stageId: STAGE_ID }),
    getStage: stagePresent(),
    runInference: resolves({ kind: "runInference" as const, proposal }),
    cancelStage: resolves({ kind: "cancelImportStage" as const, receipt: cleanupReceipt() }),
    ...overrides,
  });
  const actor = createActor(importMachine, { input: { services: fake.services } });
  actor.start();
  actor.send({ type: "CHOOSE_FILE", file: new Blob(["PK"]), fileName: fixture.slice(fixture.lastIndexOf("/") + 1) });
  fake.emit(workbookPreflightEvent(report));
  for (const { sheetIndex } of report.sheets) {
    if (!selection.includes(sheetIndex)) actor.send({ type: "TOGGLE_SHEET", sheetIndex });
  }
  actor.send({ type: "START" });
  await settled();
  fake.emit({ kind: "completed", rowCount: 2_169, batchesSent: 3 });
  for (let tick = 0; tick < 4; tick += 1) await settled();
  if (overrides.promoteImport !== undefined) {
    actor.send({ type: "CREATE_APP" });
    for (let tick = 0; tick < 4; tick += 1) await settled();
  }
  const vm = selectImportVm(actor.getSnapshot());
  actor.stop();
  if (vm.screen !== "SCR-023" || vm.step === "done") {
    throw new Error(`expected the review, got ${vm.screen}/${vm.step}`);
  }
  return vm;
}
