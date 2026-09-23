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
import { WORKBOOK_REVIEW_EDIT_REJECTIONS } from "../../../src/import/inference/review-edits.js";
import {
  PROMOTION_REJECTIONS,
  type PromotionRejectionV1,
} from "../../../src/import/staging/promotion.js";
import { importMachine } from "../../../src/application/workflows/import.machine.js";
import {
  REVIEW_EDIT_REJECTION_TOKENS,
  PROMOTION_REJECTION_TOKENS,
  toPromotionRejectionVm,
  type PromotionRejectionTokenV1,
  selectImportVm,
  toReviewEditRejectionVm,
  type DelimitedTargetVm,
  type ImportEndedVm,
  type ImportOverBudgetVm,
  type ImportRefusedVm,
  type ImportReviewVm,
  type ImportVm,
  type ReviewEditRejectionTokenV1,
  type SheetEstimateVm,
  type WorkbookPreflightVm,
} from "../../../src/application/view-models/import.js";
import type { WorkbookReviewEditRejectionV1 as ReviewEditRejectionV1 } from "../../../src/import/inference/review-edits.js";
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
  fixtureReport,
  inventoriedSheet,
  libraryApp,
  noParts,
  workbookPreflightEvent,
  workbookReport,
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
  it("offers both format groups as read, in upload.html's order (D19 retired)", () => {
    const vm = vmOf(start(services()));
    if (vm.screen !== "SCR-016") {
      throw new Error("expected the landing");
    }
    expect(vm.busy).toBe(false);
    expect(vm.formats).toEqual([
      {
        id: "spreadsheet-structure",
        label: "Spreadsheet structure",
        extensions: ["xlsx", "xlsb", "xls", "ods"],
      },
      {
        id: "value-only",
        label: "Value-only",
        extensions: ["csv", "tsv"],
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

  it("offers into-existing-app off on an empty library, and says so (D38)", async () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    // Still listing: the option waits, and says what it is waiting for.
    const listing = vmOf(actor);
    if (listing.screen !== "SCR-017") throw new Error("expected the target screen");
    expect(listing.destinations[1]).toMatchObject({ enabled: false, reason: "listing-local-apps" });

    await settled();
    const vm = vmOf(actor);
    if (vm.screen !== "SCR-017") throw new Error("expected the target screen");
    expect(vm.destinations).toEqual([
      { id: "new-app", label: "Create a new app", enabled: true, isSelected: true },
      {
        id: "existing-app",
        label: "Add a table to an existing app",
        enabled: false,
        isSelected: false,
        reason: "no-local-apps",
      },
    ]);
    expect(vm.appChoices).toEqual([]);
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
    if (vm.screen !== "SCR-018" || vm.step !== "fits") {
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
    if (vm.screen !== "SCR-019" || vm.step !== "overBudget") {
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
  it("never renders D19's later-release card now the page accepts workbooks (D42)", () => {
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
    if (vm.screen !== "SCR-022") {
      throw new Error(`expected the run to end, got ${vm.screen}`);
    }
    expect(vm.reason).toBe("service-error");
    expect(vm.cleanup).toEqual({ kind: "nothing-to-remove" });
  });

  it("names an unsafe container's reason from the refusal's own token (D42, D43)", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "zip-bomb.xlsx" });
    fake.emit({
      kind: "refused",
      refusal: { kind: "binary-unreadable", fileName: "zip-bomb.xlsx", remedy: "choose-another-file", detail: "expansion-limit" },
    });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-021") throw new Error(`expected the refusal screen, got ${vm.screen}`);
    expect(vm).toMatchObject({ refusal: "binary-unreadable", unreadableDetail: "expansion-limit", libraryUnchanged: true });
  });

  it("refuses a macro workbook whole, naming the file (MOD-005)", () => {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "payroll.xlsm" });
    fake.emit({
      kind: "refused",
      refusal: { kind: "macro-content", fileName: "payroll.xlsm", remedy: "reupload-macro-free-copy" },
    });

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-021") throw new Error(`expected the refusal screen, got ${vm.screen}`);
    expect(vm).toMatchObject({ refusal: "macro-content", fileName: "payroll.xlsm", unreadableDetail: null, libraryUnchanged: true });
    expect(fake.names()).not.toContain("beginStage");
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

    expect(vm.tables[0]?.fields[0]?.statements).toEqual([
      {
        statementId: "st-1",
        subject: "field-type",
        editKind: "override-type",
        // S02's key for the statement's column, carried unreshaped (CA-19).
        targetKey: "s0.r0.c0",
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

    expect(vm.tables[0]?.fields[0]?.violations).toEqual({ kind: "not-measured-yet" });
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
    expect(reviewVm(vmOf(actor)).tables[0]?.rowCount).toEqual({
      kind: "exact",
      value: 40,
    });
  });

  it("composes truthful copy for a file with no columns, and offers no create", async () => {
    const { actor } = await toReview(
      wireProposal({ table: { tableName: "Empty", fields: [] }, rowCount: 0 }),
    );
    const vm = reviewVm(vmOf(actor));

    expect(vm.tables.flatMap((table) => table.fields)).toEqual([]);
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
      edit: { kind: "rename-field", tableKey: "s0.r0", columnKey: "s0.r0.c0", fieldName: "Site" },
    });
    await settled();
    await settled();

    expect(reviewVm(vmOf(actor)).editRejection).toBe("duplicate-name");
  });
});

describe("the review-edit rejection list", () => {
  it("is exactly S02's closed workbook list, in both directions", () => {
    expect([...REVIEW_EDIT_REJECTION_TOKENS]).toEqual([
      ...WORKBOOK_REVIEW_EDIT_REJECTIONS,
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

describe("the promotion rejection list (D42)", () => {
  it("is exactly M23's closed list, append-too-large included, in both directions", () => {
    expect([...PROMOTION_REJECTION_TOKENS]).toEqual([...PROMOTION_REJECTIONS]);
    type MissingHere = Exclude<PromotionRejectionV1, PromotionRejectionTokenV1>;
    type ExtraHere = Exclude<PromotionRejectionTokenV1, PromotionRejectionV1>;
    const noneMissing: MissingHere extends never ? true : false = true;
    const noneExtra: ExtraHere extends never ? true : false = true;
    expect(noneMissing && noneExtra).toBe(true);
    expect(toPromotionRejectionVm("append-too-large")).toBe("append-too-large");
    expect(toPromotionRejectionVm("something-else")).toBe("unrecognised-rejection");
  });

  it("carries an append that did not fit to review as its token", async () => {
    const fake = services({
      runInference: resolves({
        kind: "runInference" as const,
        proposal: wireProposal({ table: { tableName: "Visits", fields: [field()] } }),
      }),
      promoteImport: resolves({
        kind: "promoteImport" as const,
        outcome: "rejected" as const,
        reason: "append-too-large",
        issues: [],
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
    actor.send({ type: "CREATE_APP" });
    await settled();
    await settled();

    const vm = reviewVm(vmOf(actor));
    expect(vm.promotionRejection).toBe("append-too-large");
    expect(vm.promotionIssues).toEqual([]);
  });

  it("names each refused field by its reviewed column: the reviewed name and its table", async () => {
    const issue = { kind: "type", severity: "blocking" as const, messageKey: "validation.wrong-type" };
    const proposal = wireProposal({
      table: { tableName: "Visits", fields: [field(), field({ columnIndex: 1, fieldName: "Crew lead" })] },
    });
    const fake = services({
      runInference: resolves({ kind: "runInference" as const, proposal }),
      // The target-name edits land against this same proposal (see `toReview`).
      applyReviewEdit: resolves({ kind: "applyReviewEdit" as const, outcome: "applied" as const, proposal }),
      promoteImport: resolves({
        kind: "promoteImport" as const,
        outcome: "rejected" as const,
        reason: "record-invalid",
        issues: [
          { ...issue, fieldId: "minted-b", columnKey: "s0.r0.c1" },
          { ...issue, fieldId: "minted-b", columnKey: "s0.r0.c1" },
          // A column the review does not have, and an F02-era issue with no column.
          { ...issue, fieldId: "minted-x", columnKey: "s9.r0.c9" },
          { ...issue, fieldId: "minted-y" },
          { ...issue, fieldId: null, columnKey: null },
        ],
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
    expect(reviewVm(vmOf(actor)).tables[0]?.fields.map((entry) => entry.columnKey)).toEqual(["s0.r0.c0", "s0.r0.c1"]);
    actor.send({ type: "CREATE_APP" });
    await settled();
    await settled();

    const groups = reviewVm(vmOf(actor)).promotionIssues;
    expect(groups.map(({ columnKey, fieldName, tableName, count }) => ({ columnKey, fieldName, tableName, count }))).toEqual([
      { columnKey: "s0.r0.c1", fieldName: "Crew lead", tableName: "Visits", count: 2 },
      { columnKey: "s9.r0.c9", fieldName: null, tableName: null, count: 1 },
      { columnKey: null, fieldName: null, tableName: null, count: 1 },
      { columnKey: null, fieldName: null, tableName: null, count: 1 },
    ]);
  });
});

// --- F03: the workbook branch and the append destination (S07 CP1) --------

describe("the existing-app destination (SCR-017, D38)", () => {
  async function targetWith(apps: Parameters<typeof libraryApp>[] = [], rows = 43) {
    const fake = services({
      listLibrary: resolves({ kind: "listLibrary" as const, apps: apps.map((args) => libraryApp(...args)) }),
    });
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    const event = preflightEvent();
    if (event.kind !== "preflight") throw new Error("fixture is not a pre-flight event");
    fake.emit({ ...event, report: { ...event.report, estimatedRowCount: rows } });
    await settled();
    return actor;
  }

  const target = (actor: Awaited<ReturnType<typeof targetWith>>): DelimitedTargetVm => {
    const vm = vmOf(actor);
    if (vm.screen !== "SCR-017") throw new Error(`expected the target screen, got ${vm.screen}`);
    return vm;
  };

  it("lists the library's apps as choices once there is one to add to", async () => {
    const actor = await targetWith([["app-1", "Fieldwork Q3", { tableCount: 7 }]]);
    const vm = target(actor);
    expect(vm.destinations[1]).toEqual({
      id: "existing-app",
      label: "Add a table to an existing app",
      enabled: true,
      isSelected: false,
    });
    expect(vm.appChoices).toEqual([{ appId: "app-1", displayName: "Fieldwork Q3", tableCount: 7, isSelected: false }]);

    actor.send({ type: "SET_DESTINATION", destination: { kind: "existing-app", appId: "app-1" } });
    const chosen = target(actor);
    expect(chosen.destination).toBe("existing-app");
    expect(chosen.appChoices[0]?.isSelected).toBe(true);
    // An append names a table, not an app.
    expect(chosen.needsAppName).toBe(false);
    expect(chosen.appNameProblem).toBeNull();
  });

  it("turns the append off when the estimate cannot fit one commit, stating the numbers", async () => {
    const actor = await targetWith([["app-1", "Fieldwork Q3"]], 10_050);
    const vm = target(actor);
    expect(vm.destinations[1]).toMatchObject({ enabled: false, reason: "too-large-to-append" });
    expect(vm.appendEstimate).toEqual({
      estimatedEvents: 10_050 + 9 + 2,
      estimatedRows: { kind: "estimated", value: 10_050 },
      eventCap: 10_000,
    });
    expect(vm.appChoices).toEqual([]);
  });

  it("says the apps could not be listed rather than that there are none", async () => {
    const fake = services({ listLibrary: () => Promise.reject(new Error("locked")) });
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    await settled();
    expect(target(actor).destinations[1]).toMatchObject({ enabled: false, reason: "local-apps-not-listed" });
  });
});

describe("the workbook pre-flight (SCR-018 / SCR-019, CA-18)", () => {
  function sizing(report = workbookReport()) {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: report.fileName });
    fake.emit(workbookPreflightEvent(report));
    return { actor, fake };
  }

  const preflightVm = (actor: ReturnType<typeof start>): WorkbookPreflightVm => {
    const vm = vmOf(actor);
    if (vm.step !== "workbookFits" && vm.step !== "workbookSubset" && vm.step !== "workbookHandoff") {
      throw new Error(`expected the workbook pre-flight, got ${vm.screen}/${vm.step}`);
    }
    return vm;
  };

  it("draws the demo workbook's checklist from its real metadata", async () => {
    const report = await fixtureReport("ooxml/fieldwork-q3.xlsx");
    const { actor } = sizing(report);
    const vm = preflightVm(actor);
    expect(vm.screen).toBe("SCR-018");
    expect(vm.sheets.map((sheet) => [sheet.name, sheet.shape, sheet.badge])).toEqual([
      ["Jobs", "declared-table", "use"],
      ["Customers", "declared-table", "use"],
      ["Crew", "table-region", "inspect"],
      ["Visits", "declared-table", "use"],
      ["Materials", "table-region", "inspect"],
      ["Overview", "charts-and-summary", "dashboard"],
      ["Archive 2018", "table-region", "inspect"],
    ]);
    expect(vm.selection).toMatchObject({ selectedCount: 7, sheetCount: 7, blocker: null });
    expect(vm.drawingNotices).toEqual([{ sheetName: "Overview", drawingCount: 2 }]);
    expect(vm.handoff).toBeNull();

    // Leaving Archive 2018 out marks it excluded, and the count follows.
    actor.send({ type: "TOGGLE_SHEET", sheetIndex: 6 });
    const deselected = preflightVm(actor);
    expect(deselected.sheets[6]).toMatchObject({ isSelected: false, badge: "excluded" });
    expect(deselected.selection.selectedCount).toBe(6);
    expect(deselected.announcement).toBe("This workbook fits this device. 6 of 7 sheets are selected.");
  });

  it("keeps a null count 'not declared', never 0, and every count an estimate (D24)", () => {
    const report = workbookReport({
      sheets: [inventoriedSheet(0, "Summary", { estimatedRowCount: null, estimatedCellCount: null })],
    });
    const vm = preflightVm(sizing(report).actor);
    expect(vm.sheets[0]?.rows).toEqual({ kind: "not-declared" });
    expect(vm.sheets[0]?.cells).toEqual({ kind: "not-declared" });
    expect(vm.selection.estimatedRows).toEqual({ kind: "not-declared" });

    // Type-level negatives: an estimate has no exact member, and "not
    // declared" carries no number that a surface could print as 0.
    // @ts-expect-error — a sheet estimate can only be written as "about"
    const exactCount: SheetEstimateVm = { kind: "exact", value: 12 };
    // @ts-expect-error — an undeclared count has no value to render
    const zeroForUnknown: SheetEstimateVm = { kind: "not-declared", value: 0 };
    expect([exactCount, zeroForUnknown]).toHaveLength(2);
  });

  it("refuses to start an empty selection, and says why", () => {
    const { actor } = sizing();
    actor.send({ type: "CLEAR_ALL" });
    const vm = preflightVm(actor);
    expect(vm.selection.blocker).toBe("nothing-selected");
    expect(vm.canStart).toBe(false);
  });

  it("offers the subset's selection over budget as a reason, not a start (D31)", () => {
    const report = workbookReport({
      sheets: [
        inventoriedSheet(0, "This week", { estimatedCellCount: 1_000 }),
        inventoriedSheet(1, "Archive", { estimatedCellCount: 300_005 }),
        inventoriedSheet(2, "Crew", { estimatedCellCount: 250 }),
      ],
      route: "subset",
      defaultSelection: [0],
    });
    const { actor } = sizing(report);
    const subset = preflightVm(actor);
    expect(subset.screen).toBe("SCR-019");
    expect(subset.canStart).toBe(true);
    expect(subset.handoff?.instructions).toBe(
      [
        "Import everything on desktop: “fieldwork-q3.xlsx”.",
        "No work is transferred automatically. Open this same source file in Sheaf on a device with a larger local budget.",
        "Desktop solves importing only.",
      ].join("\n"),
    );

    actor.send({ type: "TOGGLE_SHEET", sheetIndex: 1 });
    const over = preflightVm(actor);
    expect(over.selection).toMatchObject({ blocker: "over-budget", estimatedCells: 301_005, maxEstimatedCells: 250_000 });
    expect(over.canStart).toBe(false);
  });

  it("offers only the handoff when no sheet fits, and announces the copy result", () => {
    const report = workbookReport({
      sheets: [inventoriedSheet(0, "Archive", { estimatedCellCount: 300_005 })],
      route: "handoff",
      defaultSelection: [],
    });
    const { actor } = sizing(report);
    const handoff = preflightVm(actor);
    expect(handoff.step).toBe("workbookHandoff");
    expect(handoff.canStart).toBe(false);
    expect(handoff.handoff?.copy).toBeNull();

    actor.send({ type: "COPY_HANDOFF", result: "unavailable" });
    const copied = preflightVm(actor);
    expect(copied.handoff?.copy).toBe("unavailable");
    expect(copied.announcement).toContain("did not allow copying");
  });

  it("states a format-level contradiction from the report (MOD-004)", () => {
    const report = workbookReport({ formatContradiction: { declaredExtension: "xlsx", detectedFormat: "xlsb" }, format: "xlsb" });
    expect(preflightVm(sizing(report).actor).contradiction).toEqual({ declaredExtension: "xlsx", detectedFormat: "xlsb" });
  });

  it("flags a hidden sheet, and counts drawings only on selected sheets", () => {
    const report = workbookReport({
      sheets: [
        inventoriedSheet(0, "Visible"),
        inventoriedSheet(1, "Lookups", { visibility: "hidden", preservedPartCounts: { ...noParts(), drawing: 3 } }),
      ],
      defaultSelection: [0],
    });
    const vm = preflightVm(sizing(report).actor);
    expect(vm.sheets[1]).toMatchObject({ isHidden: true, badge: "excluded" });
    expect(vm.drawingNotices).toEqual([]);
  });
});

describe("a workbook streaming and failing (SCR-020, SCR-022/MOD-008, CA-24)", () => {
  async function streaming() {
    const fake = services();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "fieldwork-q3.xlsx" });
    fake.emit(workbookPreflightEvent());
    actor.send({ type: "TOGGLE_SHEET", sheetIndex: 1 });
    actor.send({ type: "START" });
    await settled();
    return { actor, fake };
  }

  it("names the sheet being read, k of n, with rows committed and no percentage", async () => {
    const { actor, fake } = await streaming();
    fake.emit(progressEvent({ rowsSoFar: 120, batchesAcked: 3, sheetOrdinal: 2, sheetCount: 2, sheetName: "Overview" }));
    const vm = vmOf(actor);
    if (vm.screen !== "SCR-020") throw new Error(`expected progress, got ${vm.screen}`);
    expect(vm.sheet).toEqual({ ordinal: 2, count: 2, name: "Overview" });
    expect(vm.rowsSoFar).toBe(120);
    expect(vm.announcement).toBe("Importing fieldwork-q3.xlsx. Sheet 2 of 2: Overview. 120 rows are durable so far.");
    type ForbiddenKey = Extract<keyof typeof vm, "percent" | "percentage" | "totalRows">;
    const noPercentage: ForbiddenKey extends never ? true : false = true;
    expect(noPercentage).toBe(true);
  });

  it("names the failed stage, the sheet from the selection, and the raw diagnostic", async () => {
    const { actor, fake } = await streaming();
    fake.emit({
      kind: "failed",
      reason: "parse-failed",
      detail: { stage: "sheet-stream", sheetOrdinal: 2, diagnostic: "truncated-container" },
    });
    await settled();
    const vm = vmOf(actor);
    if (vm.screen !== "SCR-022") throw new Error(`expected the ended screen, got ${vm.screen}`);
    expect(vm.detail).toEqual({
      stage: "sheet-stream",
      diagnostic: "truncated-container",
      // Ordinal 2 of the selection [0, 2] is sheet index 2.
      sheet: { ordinal: 2, count: 2, name: "Overview" },
    });
    expect(vm.cleanup.kind).toBe("removed");
  });
});

describe("the landing (CAP-23, CAP-26)", () => {
  it("lands an append on the table its commit created, found by reading the app either side", async () => {
    const promote = resolves({
      kind: "promoteImport" as const,
      outcome: "promoted" as const,
      appId: "app-1",
      rowCount: 4,
      tableCount: 1,
      flaggedRecordCount: 0,
    });
    let tables = ["table-a"];
    const fake = services({
      runInference: resolves({
        kind: "runInference" as const,
        proposal: wireProposal({ table: { tableName: "Crew", fields: [field()] } }),
      }),
      applyReviewEdit: resolves({
        kind: "applyReviewEdit" as const,
        outcome: "applied" as const,
        proposal: wireProposal({ table: { tableName: "Crew", fields: [field()] } }),
      }),
      listLibrary: resolves({ kind: "listLibrary" as const, apps: [libraryApp("app-1", "Fieldwork Q3")] }),
      listTables: () =>
        Promise.resolve({
          kind: "listTables" as const,
          tables: tables.map((tableId, tableOrdinal) => ({
            tableId,
            displayName: tableId,
            tableOrdinal,
            recordCount: 1,
            isRecordCountExact: true as const,
            fields: [],
          })),
        }),
      promoteImport: async () => {
        tables = [...tables, "table-b"];
        return promote();
      },
    });
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "crew-roster.tsv" });
    fake.emit(preflightEvent());
    await settled();
    actor.send({ type: "SET_DESTINATION", destination: { kind: "existing-app", appId: "app-1" } });
    actor.send({ type: "CONTINUE" });
    actor.send({ type: "START" });
    await settled();
    fake.emit({ kind: "completed", rowCount: 4, batchesSent: 1 });
    await settled();
    await settled();
    await settled();
    actor.send({ type: "CREATE_APP" });
    for (let tick = 0; tick < 6; tick += 1) await settled();

    const vm = vmOf(actor);
    if (vm.screen !== "SCR-023" || vm.step !== "done") throw new Error(`expected done, got ${vm.screen}`);
    expect(vm.landing).toEqual({ kind: "appended-table", appId: "app-1", tableId: "table-b" });
  });
});

describe("the review's live structure (CAP-38, CA-27, CA-31; S07)", () => {
  it("names each formula, chart and rule by the reviewed names, with the statement behind it", async () => {
    const { demoProposal, demoReviewVm } = await import("../ui/import/demo-review.js");
    const vm = await demoReviewVm(await demoProposal());
    expect(vm.calculations.map((calculation) => [calculation.formulaKey, calculation.target, calculation.name, calculation.tableName, calculation.disposition])).toEqual([
      ["s0.t0.c2", "computed-column", "Customer", "Jobs", "live"],
      ["s0.t0.c6", "computed-column", "Balance", "Jobs", "live"],
      ["s5.R3C2", "dashboard-value", "Open jobs", null, "live"],
      ["s5.R4C2", "dashboard-value", "Quoted total", null, "live"],
      ["s5.R5C2", "dashboard-value", "Paid total", null, "live"],
      ["s5.R6C2", "dashboard-value", "Balance", null, "live"],
    ]);
    expect(vm.calculations.every((calculation) => calculation.statement?.editKind === "reject-statement")).toBe(true);
    expect(vm.charts).toEqual([
      expect.objectContaining({ chartKey: "s5.chart0", name: "Quoted by status", isActive: true, isPinned: true }),
    ]);
    // A formula's statement is read under Live calculations, not with its field.
    const balance = vm.tables[0]?.fields.find((field) => field.fieldName === "Balance");
    expect(balance?.statements.map((statement) => statement.subject)).toEqual(["field-name", "field-type"]);
    expect(vm.sheets.find((sheet) => sheet.name === "Overview")?.statements.map((statement) => statement.subject)).toEqual([
      "sheet-classification",
      "sheet-classification",
      "chart",
    ]);
  });

  it("lists a workbook comparison validation as a rule on its field (CA-27)", async () => {
    const { demoProposal, demoReviewVm } = await import("../ui/import/demo-review.js");
    const live = "ooxml/formulas-live.xlsx";
    const vm = await demoReviewVm(await demoProposal([0, 1, 2], [], live), [0, 1, 2], {}, live);
    expect(vm.rules).toEqual([
      {
        ruleKey: "rule:s0.t0.c1",
        tableName: "Jobs",
        fieldName: "Quoted",
        condition: { kind: "compare", columnKey: "s0.t0.c1", op: "ge", value: { kind: "decimal", decimal: "0" }, measure: null },
        isActive: true,
      },
    ]);
    const quoted = vm.tables[0]?.fields.find((field) => field.fieldName === "Quoted");
    expect(quoted?.statements.map((statement) => statement.subject)).toContain("record-rule");
  });
});
