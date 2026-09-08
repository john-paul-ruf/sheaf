/**
 * CAP-09–CAP-13 (SCR-016–023, MOD-004–008).
 *
 * These drive the real machine and project the real snapshot: a view model
 * that agreed with a hand-made context but not with the machine would be
 * exactly the drift these surfaces cannot afford.
 *
 * The assertions that matter: an estimate never arrives as exact (D24), a
 * nulled violation count never reads as "none" (S03), a section with nothing
 * in it says *which* kind of nothing (STA-025), and no state F02 cannot
 * produce is constructible.
 */

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { REVIEW_EDIT_REJECTIONS } from "../../../src/import/inference/review-edits.js";
import { importMachine } from "../../../src/application/workflows/import.machine.js";
import {
  REVIEW_EDIT_REJECTION_TOKENS,
  selectImportVm,
  toReviewEditRejectionVm,
  type DelimitedTargetVm,
  type ImportEndedVm,
  type ImportOverBudgetVm,
  type ImportRefusedVm,
  type ImportReviewVm,
  type ImportVm,
  type ReviewEditRejectionTokenV1,
} from "../../../src/application/view-models/import.js";
import type { ReviewEditRejectionV1 } from "../../../src/import/inference/review-edits.js";
import {
  cleanupReceipt,
  fakeImportServices,
  overBudgetRefusal,
  preflightEvent,
  progressEvent,
  resolves,
  stageAbsent,
  stagePresent,
  wireProposal,
  STAGE_ID,
  type FakeImportServices,
} from "../workflows/fakes.js";
import type { ProposedFieldWireV1 } from "../../../src/workers/protocol/messages.js";

const FILE = new Blob(["Site,Status\n"], { type: "text/csv" });
const FILE_NAME = "field-log-messy.csv";

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function services(overrides: Record<string, unknown> = {}): FakeImportServices {
  return fakeImportServices({
    beginStage: resolves({
      kind: "beginImportStage" as const,
      stageId: STAGE_ID,
    }),
    getStage: stagePresent(),
    runInference: resolves({
      kind: "runInference" as const,
      proposal: wireProposal(),
    }),
    applyReviewEdit: resolves({
      kind: "applyReviewEdit" as const,
      outcome: "applied" as const,
      proposal: wireProposal(),
    }),
    cancelStage: resolves({
      kind: "cancelImportStage" as const,
      receipt: cleanupReceipt(),
    }),
    ...overrides,
  });
}

function start(fake: FakeImportServices) {
  const actor = createActor(importMachine, {
    input: { services: fake.services },
  });
  actor.start();
  return actor;
}

const vmOf = (actor: ReturnType<typeof start>): ImportVm =>
  selectImportVm(actor.getSnapshot());

function field(overrides: Partial<ProposedFieldWireV1> = {}): ProposedFieldWireV1 {
  return {
    columnIndex: 0,
    fieldName: "Site",
    isNameGenerated: false,
    type: { kind: "enum" },
    sourceFormat: { kind: "enum" },
    enumOptions: [{ label: "North", occurrences: 12 }],
    violations: null,
    ...overrides,
  };
}

/** Drives to `reviewing` with the given proposal. */
async function toReview(proposal = wireProposal()) {
  const fake = services({
    runInference: resolves({ kind: "runInference" as const, proposal }),
    // The target-name edits land against this same proposal, so the stub
    // echoes it: a stub that answered with a different one would be testing
    // the fixture rather than the projection.
    applyReviewEdit: resolves({
      kind: "applyReviewEdit" as const,
      outcome: "applied" as const,
      proposal,
    }),
  });
  const actor = start(fake);
  actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
  fake.emit(preflightEvent());
  actor.send({ type: "CONTINUE" });
  actor.send({ type: "START" });
  await settled();
  fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
  await settled();
  await settled();
  await settled();
  return { actor, fake };
}

function reviewVm(vm: ImportVm): ImportReviewVm {
  if (vm.screen !== "SCR-023" || vm.step === "done") {
    throw new Error(`expected the review screen, got ${vm.screen}/${vm.step}`);
  }
  return vm;
}

describe("the upload landing (SCR-016)", () => {
  it("says which formats this release can actually take (D19)", () => {
    const vm = vmOf(start(services()));
    if (vm.screen !== "SCR-016") {
      throw new Error("expected the landing");
    }
    expect(vm.busy).toBe(false);
    expect(vm.formats).toEqual([
      {
        id: "value-only",
        label: "Value-only",
        extensions: ["csv", "tsv"],
        availability: "available",
      },
      {
        id: "spreadsheet-structure",
        label: "Spreadsheet structure",
        extensions: ["xlsx", "xlsb", "xls", "ods"],
        availability: "later-release",
      },
    ]);
  });

  it("goes busy while the parser sniffs and sizes", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(progressEvent({ phase: "sizing", currentAction: "sizing" }));

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-016") {
      throw new Error("expected the landing");
    }
    expect(vm.busy).toBe(true);
    expect(vm.phase).toBe("sizing");
  });
});

describe("the delimited target (SCR-017)", () => {
  function target(): DelimitedTargetVm {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    const vm = vmOf(actor);
    if (vm.screen !== "SCR-017") {
      throw new Error(`expected the target screen, got ${vm.screen}`);
    }
    return vm;
  }

  it("carries the estimate flag through to the copy (D24)", () => {
    expect(target().rowCount).toEqual({ kind: "estimated", value: 43 });
  });

  it("never renders the mock's exact 'N + header' phrasing", () => {
    const vm = target();
    expect(vm.announcement).toBe(
      "About 43 rows across 9 columns were detected.",
    );
    expect(vm.announcement).not.toContain("+ header");
  });

  it("offers into-existing-app disabled, with a reason (D18)", () => {
    expect(target().destinations).toEqual([
      { id: "new-app", label: "Create a new app", enabled: true },
      {
        id: "existing-app",
        label: "Add a table to an existing app",
        enabled: false,
        reason: "into-existing-app-not-available-in-this-release",
      },
    ]);
  });

  it("names an empty name as a problem and refuses to continue", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "SET_APP_NAME", text: "  " });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-017") {
      throw new Error("expected the target screen");
    }
    expect(vm.appNameProblem).toBe("required");
    expect(vm.canContinue).toBe(false);
  });

  it("states an extension/content contradiction (MOD-004)", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "book.xlsx" });
    const preflight = preflightEvent();
    if (preflight.kind !== "preflight") {
      throw new Error("fixture is not a pre-flight event");
    }
    fake.emit({
      ...preflight,
      declaredExtension: "xlsx",
      contradiction: {
        declaredExtension: "xlsx",
        expectedKind: "zip-container",
        detectedKind: "delimited",
      },
    });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-017") {
      throw new Error("expected the target screen");
    }
    expect(vm.contradiction).toEqual({
      declaredExtension: "xlsx",
      expectedKind: "zip-container",
      detectedKind: "delimited",
    });
  });
});

describe("the size answer (D20)", () => {
  it("confirms a fit with the measurement pre-flight already made", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "CONTINUE" });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-018") {
      throw new Error(`expected the fits screen, got ${vm.screen}`);
    }
    expect(vm.fits).toBe(true);
    expect(vm.rowCount.kind).toBe("estimated");
    expect(vm.sourceByteLength).toBe(4096);
  });

  it("renders the over-budget variant with real numbers and no sheet list", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "huge.csv" });
    fake.emit({ kind: "refused", refusal: overBudgetRefusal() });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-019") {
      throw new Error(`expected the over-budget screen, got ${vm.screen}`);
    }
    expect(vm).toMatchObject({
      exceeded: "estimated-cells",
      estimatedCellCount: 900_000,
      maxEstimatedCellCount: 250_000,
      remedy: "use-larger-device",
      libraryUnchanged: true,
    });

    type ForbiddenKey = Extract<
      keyof ImportOverBudgetVm,
      "sheets" | "selectedSheets" | "capacityDetailHref" | "budgets"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });
});

describe("the refusal (SCR-021)", () => {
  it("names the later-release family without inventing a remedy (D19)", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "book.xlsx" });
    fake.emit({
      kind: "refused",
      refusal: {
        kind: "workbook-format-later-release",
        fileName: "book.xlsx",
        remedy: "await-later-release",
        format: "ooxml",
      },
    });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-021") {
      throw new Error(`expected the refusal screen, got ${vm.screen}`);
    }
    expect(vm).toMatchObject({
      refusal: "workbook-format-later-release",
      remedy: "await-later-release",
      laterReleaseFormat: "ooxml",
      libraryUnchanged: true,
      fileName: "book.xlsx",
    });
  });

  it("has no field a partial-import state could be written into", () => {
    type ForbiddenKey = Extract<
      keyof ImportRefusedVm,
      "rowsImported" | "partialAppId" | "stageId"
    >;
    const noForbiddenKeys: ForbiddenKey extends never ? true : false = true;
    expect(noForbiddenKeys).toBe(true);
  });
});

describe("progress and its cancellation contract (SCR-020)", () => {
  it("reports durable rows and offers cancel with MOD-007's promise", async () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "START" });
    await settled();
    fake.emit(progressEvent({ rowsSoFar: 18, batchesAcked: 2 }));

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-020") {
      throw new Error(`expected the progress screen, got ${vm.screen}`);
    }
    expect(vm.rowsSoFar).toBe(18);
    expect(vm.batchesCommitted).toBe(2);
    expect(vm.cancellable).toBe(true);
    expect(vm.cancellationContract).toBe("removes-every-committed-batch");
  });
});

describe("the ended run (SCR-022)", () => {
  async function endedAfterCancel(
    overrides: Record<string, unknown> = {},
  ): Promise<ImportEndedVm> {
    const fake = services(overrides);
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "START" });
    await settled();
    actor.send({ type: "CANCEL" });
    fake.emit({ kind: "cancelled", batchesSent: 1 });
    await settled();

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-022") {
      throw new Error(`expected the ended screen, got ${vm.screen}`);
    }
    return vm;
  }

  it("claims nothing remains only once the receipt says so", async () => {
    const vm = await endedAfterCancel();
    expect(vm.outcome).toBe("cancelled");
    expect(vm.cleanup).toEqual({
      kind: "removed",
      deletedCount: 3,
      completed: true,
      reason: "import-cancelled",
    });
    expect(vm.announcement).toBe(
      "You cancelled the import. No partial app remains.",
    );
  });

  it("promises nothing while the cleanup is still running", async () => {
    const fake = services({ cancelStage: () => new Promise(() => undefined) });
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "START" });
    await settled();
    actor.send({ type: "CANCEL" });
    await settled();

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-022") {
      throw new Error("expected the ended screen");
    }
    expect(vm.busy).toBe(true);
    expect(vm.cleanup).toEqual({ kind: "unconfirmed" });
    expect(vm.announcement).not.toContain("No partial app remains");
  });

  it("says nothing was written when no stage was ever created", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit({ kind: "failed", reason: "malformed-request" });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-022") {
      throw new Error("expected the ended screen");
    }
    expect(vm.outcome).toBe("failed");
    expect(vm.cleanup).toEqual({ kind: "nothing-to-remove" });
    expect(vm.reason).toBe("malformed-request");
  });

  it("never names an integrity check for a stage that was swept (D-04)", async () => {
    const fake = services({ getStage: stageAbsent() });
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "START" });
    await settled();
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-022") {
      throw new Error(`expected the ended screen, got ${vm.screen}`);
    }
    expect(vm.reason).toBe("stage-missing");
    expect(vm.announcement).not.toMatch(/integrity/i);
    expect(vm.announcement).toBe(
      "The import did not complete. No partial app remains.",
    );
  });
});

describe("the review (SCR-023)", () => {
  it("projects statements with their evidence and edit ids, unreshaped", async () => {
    const proposal = wireProposal({
      table: { tableName: "Visits", fields: [field()] },
      statements: [
        {
          statementId: "st-1",
          subject: "field-type",
          editKind: "override-type",
          columnIndex: 0,
          evidence: [
            {
              kind: "distinct-values",
              distinct: 4,
              sampled: 40,
              options: ["North", "South"],
            },
          ],
          evidenceFingerprint: "fp-1",
          disposition: "accepted",
        },
      ],
    });
    const { actor } = await toReview(proposal);
    const vm = reviewVm(vmOf(actor));

    expect(vm.fields[0]?.statements).toEqual([
      {
        statementId: "st-1",
        subject: "field-type",
        editKind: "override-type",
        columnIndex: 0,
        evidence: [
          {
            kind: "distinct-values",
            distinct: 4,
            sampled: 40,
            options: ["North", "South"],
          },
        ],
        disposition: "accepted",
      },
    ]);
  });

  it("says 'not measured yet' where a header edit nulled the count", async () => {
    const proposal = wireProposal({
      table: {
        tableName: "Visits",
        fields: [field({ violations: null })],
      },
    });
    const { actor } = await toReview(proposal);
    const vm = reviewVm(vmOf(actor));

    expect(vm.fields[0]?.violations).toEqual({ kind: "not-measured-yet" });
    expect(vm.isNeedsAttentionExact).toBe(false);
    expect(vm.needsAttentionCount).toBe(0);
  });

  it("derives needs-attention from measured violations only (CA-16)", async () => {
    const proposal = wireProposal({
      table: {
        tableName: "Visits",
        fields: [
          field({
            columnIndex: 0,
            violations: {
              count: 2,
              examples: [{ rowIndex: 21, sourceText: "TBD" }],
            },
          }),
          field({
            columnIndex: 1,
            fieldName: "Status",
            violations: { count: 0, examples: [] },
          }),
        ],
      },
    });
    const { actor } = await toReview(proposal);
    const vm = reviewVm(vmOf(actor));

    expect(vm.needsAttentionCount).toBe(2);
    expect(vm.isNeedsAttentionExact).toBe(true);
  });

  it("states which kind of nothing each empty section is (STA-025)", async () => {
    const proposal = wireProposal({
      table: { tableName: "Visits", fields: [field()] },
    });
    const { actor } = await toReview(proposal);
    const vm = reviewVm(vmOf(actor));

    expect(vm.sections).toEqual([
      { id: "tables-and-rows", label: "Tables & rows", count: 1, emptiness: null },
      {
        id: "fields-and-choices",
        label: "Fields & choices",
        count: 1,
        emptiness: null,
      },
      {
        id: "connections",
        label: "Connections",
        count: 0,
        emptiness: "not-applicable-value-only",
      },
      {
        id: "live-calculations",
        label: "Live calculations",
        count: 0,
        emptiness: "not-applicable-value-only",
      },
      {
        id: "sheets-and-snapshots",
        label: "Sheets & snapshots",
        count: 0,
        emptiness: "not-applicable-value-only",
      },
    ]);
  });

  it("reports the proposal's row count as exact, never as an estimate (D24)", async () => {
    const { actor } = await toReview(
      wireProposal({ table: { tableName: "Visits", fields: [field()] } }),
    );
    expect(reviewVm(vmOf(actor)).table?.rowCount).toEqual({
      kind: "exact",
      value: 40,
    });
  });

  it("composes truthful copy for a file with no columns, and offers no create", async () => {
    const { actor } = await toReview(
      wireProposal({ table: { tableName: "Empty", fields: [] }, rowCount: 0 }),
    );
    const vm = reviewVm(vmOf(actor));

    expect(vm.fields).toEqual([]);
    expect(vm.confirm.canCreate).toBe(false);
    expect(vm.confirm.blocker).toBe("no-fields-found");
    expect(vm.announcement).toBe(
      "Sheaf found no columns in this file, so there is nothing to create an app from.",
    );
  });

  it("offers the create with the mock's assurance when there is something to create", async () => {
    const { actor } = await toReview(
      wireProposal({ table: { tableName: "Visits", fields: [field()] } }),
    );
    const vm = reviewVm(vmOf(actor));

    expect(vm.confirm.canCreate).toBe(true);
    expect(vm.confirm.blocker).toBeNull();
    expect(vm.confirm.assurance).toBe("No inference stands until you confirm.");
  });

  it("renders a rejected edit from the closed list (CA-16)", async () => {
    const fake = services({
      runInference: resolves({
        kind: "runInference" as const,
        proposal: wireProposal({
          table: { tableName: "Visits", fields: [field()] },
        }),
      }),
      applyReviewEdit: resolves({
        kind: "applyReviewEdit" as const,
        outcome: "rejected" as const,
        reason: "duplicate-name",
      }),
    });
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "START" });
    await settled();
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    actor.send({
      type: "APPLY_EDIT",
      edit: { kind: "rename-field", columnIndex: 0, fieldName: "Site" },
    });
    await settled();
    await settled();

    expect(reviewVm(vmOf(actor)).editRejection).toBe("duplicate-name");
  });
});

describe("the review-edit rejection list", () => {
  it("is exactly S03's closed list, in both directions", () => {
    expect([...REVIEW_EDIT_REJECTION_TOKENS]).toEqual([
      ...REVIEW_EDIT_REJECTIONS,
    ]);

    // Assignability both ways: a member added on either side, or a spelling
    // that drifts, is a compile error here rather than a wrong sentence in a
    // surface. `never` is what makes the check non-vacuous.
    type MissingHere = Exclude<
      ReviewEditRejectionV1,
      ReviewEditRejectionTokenV1
    >;
    type ExtraHere = Exclude<
      ReviewEditRejectionTokenV1,
      ReviewEditRejectionV1
    >;
    const noneMissing: MissingHere extends never ? true : false = true;
    const noneExtra: ExtraHere extends never ? true : false = true;
    expect(noneMissing && noneExtra).toBe(true);
  });

  it("names an unrecognised reason rather than guessing one", () => {
    expect(toReviewEditRejectionVm("duplicate-name")).toBe("duplicate-name");
    expect(toReviewEditRejectionVm("something-new")).toBe(
      "unrecognised-rejection",
    );
  });
});
