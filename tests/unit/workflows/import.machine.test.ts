/**
 * CAP-09–CAP-13 (SCR-016–023, MOD-004–008; FR-1/2/3/4).
 *
 * The assertions that matter here are the ones that keep a surface honest:
 * a cancel does not become "cancelled" until the cleanup receipt arrives, a
 * vanished stage never surfaces as an integrity failure (Roshi D-04), and no
 * terminal state leaves the parser running.
 */

import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import {
  beginStageInput,
  importMachine,
  isChosenName,
  PARSER_STOP_TIMEOUT_MS,
} from "../../../src/application/workflows/import.machine.js";
import type { ImportServices } from "../../../src/application/workflows/import-services.js";
import {
  cleanupReceipt,
  fakeImportServices,
  overBudgetRefusal,
  preflightEvent,
  progressEvent,
  rejects,
  resolves,
  stageAbsent,
  stagePresent,
  wireProposal,
  workerError,
  STAGE_ID,
  type FakeImportServices,
} from "./fakes.js";

const FILE = new Blob(["Site,Status\n"], { type: "text/csv" });
const FILE_NAME = "field-log-messy.csv";

function start(fake: FakeImportServices) {
  const actor = createActor(importMachine, {
    input: { services: fake.services },
  });
  actor.start();
  return actor;
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Every wiring a happy path needs; suites override the leg they are testing. */
function happyServices(overrides: Partial<ImportServices> = {}) {
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
      proposal: wireProposal({ appName: "Field Log" }),
    }),
    promoteImport: resolves({
      kind: "promoteImport" as const,
      outcome: "promoted" as const,
      appId: "app-01H8XG9K7Q",
      rowCount: 40,
      tableCount: 1,
      flaggedRecordCount: 1,
    }),
    cancelStage: resolves({
      kind: "cancelImportStage" as const,
      receipt: cleanupReceipt(),
    }),
    ...overrides,
  });
}

/** Drives the flow to `parsing`, which is where every interesting leg starts. */
async function toParsing(fake: FakeImportServices) {
  const actor = start(fake);
  actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
  fake.emit(preflightEvent());
  actor.send({ type: "SET_APP_NAME", text: "Field Log" });
  actor.send({ type: "SET_TABLE_NAME", text: "Visits" });
  actor.send({ type: "CONTINUE" });
  actor.send({ type: "START" });
  await settled();
  return actor;
}

describe("the import machine", () => {
  it("carries a file from detection to a durable app", async () => {
    const fake = happyServices();
    const actor = await toParsing(fake);
    expect(actor.getSnapshot().matches("parsing")).toBe(true);

    fake.emit(progressEvent({ rowsSoFar: 24, batchesAcked: 1 }));
    expect(actor.getSnapshot().context.progress.rowsSoFar).toBe(24);

    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    const reviewing = actor.getSnapshot();
    expect(reviewing.matches({ reviewing: "deciding" })).toBe(true);
    expect(reviewing.context.parsedRowCount).toBe(40);
    expect(reviewing.context.proposal?.appName).toBe("Field Log");

    actor.send({ type: "CREATE_APP" });
    await settled();
    await settled();

    const done = actor.getSnapshot();
    expect(done.matches("done")).toBe(true);
    expect(done.context.promoted).toEqual({
      appId: "app-01H8XG9K7Q",
      rowCount: 40,
      tableCount: 1,
      flaggedRecordCount: 1,
    });
    expect(fake.terminateCount()).toBeGreaterThanOrEqual(1);
  });

  it("hands the data worker the facts pre-flight measured, marked estimated", async () => {
    const fake = happyServices();
    await toParsing(fake);
    const begin = fake.calls.find((call) => call.name === "beginStage");
    expect(begin?.input).toMatchObject({
      fileName: FILE_NAME,
      detected: { kind: "delimited", delimiter: ",", encoding: "utf-8" },
      preflight: { estimatedRowCount: 43, columnCount: 9, isEstimate: true },
    });
  });

  it("tells the parser to stream only after the stage exists", async () => {
    const fake = happyServices();
    await toParsing(fake);
    const order = fake
      .names()
      .filter((name) => name === "beginStage" || name === "proceed");
    expect(order).toEqual(["beginStage", "proceed"]);
  });

  it("refuses a workbook format without ever creating a stage", () => {
    const fake = fakeImportServices();
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

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("refused")).toBe(true);
    expect(snapshot.context.stageId).toBeUndefined();
    expect(fake.names()).not.toContain("beginStage");
    expect(fake.terminateCount()).toBeGreaterThanOrEqual(1);
  });

  it("routes an over-budget refusal to its own state (D20)", () => {
    const fake = fakeImportServices();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "huge.csv" });
    fake.emit({ kind: "refused", refusal: overBudgetRefusal() });

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("overBudget")).toBe(true);
    expect(snapshot.context.refusal).toMatchObject({
      exceeded: "estimated-cells",
      maxEstimatedCellCount: 250_000,
    });
  });

  it("will not begin a stage until both names are chosen", () => {
    const fake = happyServices();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit(preflightEvent());
    actor.send({ type: "SET_APP_NAME", text: "   " });
    actor.send({ type: "CONTINUE" });
    expect(actor.getSnapshot().matches("delimitedTarget")).toBe(true);
  });

  // --- cancel: the receipt is the promise --------------------------------

  it("stays in cancelling until the cleanup receipt arrives", async () => {
    let release: ((value: {
      kind: "cancelImportStage";
      receipt: ReturnType<typeof cleanupReceipt>;
    }) => void) | undefined;
    const fake = happyServices({
      cancelStage: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const actor = await toParsing(fake);
    // A new run terminates the previous parser, so the count is measured from
    // here: what matters is that *cancelling* terminates nothing on its own.
    const terminatedBefore = fake.terminateCount();

    actor.send({ type: "CANCEL" });
    await settled();
    // The cleanup follows the parser's terminal report, not the instruction
    // to stop: batches already sent are still in flight until it arrives.
    fake.emit({ kind: "cancelled", batchesSent: 1 });
    await settled();

    expect(actor.getSnapshot().matches("cancelling")).toBe(true);
    expect(actor.getSnapshot().context.cleanupReceipt).toBeUndefined();
    // The parser is told to stop first, so no further row is staged.
    expect(fake.names()).toContain("cancelParse");
    expect(fake.terminateCount()).toBe(terminatedBefore);

    release?.({
      kind: "cancelImportStage",
      receipt: cleanupReceipt({ deletedCount: 2 }),
    });
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("cancelled")).toBe(true);
    expect(snapshot.context.cleanupReceipt).toEqual({
      reason: "import-cancelled",
      deletedCount: 2,
      completed: true,
    });
    expect(fake.terminateCount()).toBe(terminatedBefore + 1);
  });

  it("accepts a receipt that deleted nothing as a truthful receipt", async () => {
    const fake = happyServices({
      cancelStage: resolves({
        kind: "cancelImportStage" as const,
        receipt: cleanupReceipt({ deletedCount: 0 }),
      }),
    });
    const actor = await toParsing(fake);
    actor.send({ type: "CANCEL" });
    fake.emit({ kind: "cancelled", batchesSent: 1 });
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("cancelled")).toBe(true);
    expect(snapshot.context.cleanupReceipt?.completed).toBe(true);
  });

  it("never claims cancelled when cleanup could not be confirmed", async () => {
    const fake = happyServices({
      cancelStage: rejects(workerError("timeout")),
    });
    const actor = await toParsing(fake);
    actor.send({ type: "CANCEL" });
    fake.emit({ kind: "cancelled", batchesSent: 1 });
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("failed")).toBe(true);
    expect(snapshot.context.failure).toBe("cleanup-unconfirmed");
    expect(snapshot.context.cleanupReceipt).toBeUndefined();
  });

  it("treats a parser that stopped without a summary as a cancel", async () => {
    const fake = happyServices();
    const actor = await toParsing(fake);
    fake.emit({ kind: "cancelled", batchesSent: 2 });
    await settled();
    expect(actor.getSnapshot().matches("cancelled")).toBe(true);
  });

  // --- failure: cleaned up, and said so ----------------------------------

  it("cleans the stage up before it reports a parse failure", async () => {
    const fake = happyServices();
    const actor = await toParsing(fake);
    fake.emit({ kind: "failed", reason: "parse-failed" });
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("failed")).toBe(true);
    expect(snapshot.context.failure).toBe("parse-failed");
    expect(snapshot.context.cleanupReceipt?.completed).toBe(true);
    expect(fake.names()).toContain("cancelStage");
  });

  it("fails with no receipt when no stage was ever created", () => {
    const fake = fakeImportServices();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    fake.emit({ kind: "failed", reason: "malformed-request" });

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("failed")).toBe(true);
    expect(snapshot.context.cleanupReceipt).toBeUndefined();
    expect(fake.names()).not.toContain("cancelStage");
  });

  it("fails when the promotion request itself is refused", async () => {
    const fake = happyServices({
      promoteImport: rejects(workerError("locked")),
    });
    const actor = await toParsing(fake);
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    actor.send({ type: "CREATE_APP" });
    await settled();
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("failed")).toBe(true);
    expect(snapshot.context.failure).toBe("service-error");
    expect(snapshot.context.error).toEqual({ kind: "locked" });
    expect(snapshot.context.cleanupReceipt?.completed).toBe(true);
  });

  it("returns a typed promotion rejection to review, keeping the stage", async () => {
    const fake = happyServices({
      promoteImport: resolves({
        kind: "promoteImport" as const,
        outcome: "rejected" as const,
        reason: "validation-failed",
        issues: [
          {
            fieldId: "field-04",
            kind: "wrong-type",
            severity: "blocking" as const,
            messageKey: "value.not-a-number",
          },
        ],
      }),
    });
    const actor = await toParsing(fake);
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    actor.send({ type: "CREATE_APP" });
    await settled();
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches({ reviewing: "deciding" })).toBe(true);
    expect(snapshot.context.promotionRejection?.issues).toHaveLength(1);
    expect(snapshot.context.stageId).toBe(STAGE_ID);
    expect(fake.names()).not.toContain("cancelStage");
  });

  // --- the M37 seam: a vanished stage is never an integrity failure -------

  it("reports a vanished stage as stage-missing, not integrity (D-04)", async () => {
    const fake = happyServices({ getStage: stageAbsent() });
    const actor = await toParsing(fake);
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("failed")).toBe(true);
    expect(snapshot.context.failure).toBe("stage-missing");
    expect(snapshot.context.error).toBeUndefined();
    // The gate is what stopped it: inference was never asked for.
    expect(fake.names()).not.toContain("runInference");
  });

  it("gates the review edit and the promotion on the stage too", async () => {
    for (const drive of [
      (actor: ReturnType<typeof start>) =>
        actor.send({
          type: "APPLY_EDIT",
          edit: { kind: "rename-field", columnIndex: 1, fieldName: "Site" },
        }),
      (actor: ReturnType<typeof start>) => actor.send({ type: "CREATE_APP" }),
    ]) {
      let present = true;
      const fake = happyServices({
        getStage: () =>
          present
            ? stagePresent()()
            : Promise.resolve({
                kind: "getImportStage" as const,
                stage: null,
              }),
      });
      const actor = await toParsing(fake);
      fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
      await settled();
      await settled();
      await settled();
      expect(actor.getSnapshot().matches({ reviewing: "deciding" })).toBe(true);

      // The target-name edits already landed against the live stage; what the
      // gate must prevent is any *further* mutating call once it is gone.
      const mutationsBefore = fake
        .names()
        .filter(
          (name) => name === "applyReviewEdit" || name === "promoteImport",
        ).length;

      present = false;
      drive(actor);
      await settled();
      await settled();

      const snapshot = actor.getSnapshot();
      expect(snapshot.matches("failed")).toBe(true);
      expect(snapshot.context.failure).toBe("stage-missing");
      expect(
        fake
          .names()
          .filter(
            (name) => name === "applyReviewEdit" || name === "promoteImport",
          ).length,
      ).toBe(mutationsBefore);
    }
  });

  // --- review ------------------------------------------------------------

  it("applies the names typed at the target screen as review edits", async () => {
    const fake = happyServices();
    const actor = await toParsing(fake);
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    const edits = fake.calls
      .filter((call) => call.name === "applyReviewEdit")
      .map((call) => (call.input as { edit: unknown }).edit);
    expect(edits).toEqual([
      { kind: "rename-app", appName: "Field Log" },
      { kind: "rename-table", tableName: "Visits" },
    ]);
    expect(actor.getSnapshot().matches({ reviewing: "deciding" })).toBe(true);
  });

  it("keeps a rejected edit as a reason and changes nothing (CA-16)", async () => {
    const fake = happyServices({
      applyReviewEdit: resolves({
        kind: "applyReviewEdit" as const,
        outcome: "rejected" as const,
        reason: "unknown-column",
      }),
    });
    const actor = await toParsing(fake);
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();

    const before = actor.getSnapshot().context.proposal;
    actor.send({
      type: "APPLY_EDIT",
      edit: { kind: "rename-field", columnIndex: 99, fieldName: "Nope" },
    });
    await settled();
    await settled();

    const snapshot = actor.getSnapshot();
    expect(snapshot.context.editRejection).toBe("unknown-column");
    expect(snapshot.context.proposal).toBe(before);
    expect(snapshot.matches({ reviewing: "deciding" })).toBe(true);
  });

  // --- worker lifetime ---------------------------------------------------

  /**
   * The count is taken *immediately before* the transition into the terminal
   * state, never from zero: choosing a file also ends the previous run's
   * parser, so a from-zero assertion passes even when a terminal state
   * terminates nothing. Deleting any `entry: "terminateWorker"` must fail here.
   */
  it("terminates the parser on entering every terminal state", async () => {
    const terminal: readonly {
      name: string;
      /** Drives the run to one step short of terminal, then transitions. */
      run: (fake: FakeImportServices) => Promise<() => Promise<void>>;
    }[] = [
      {
        name: "refused",
        run: async (fake) => {
          const actor = start(fake);
          actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "a.pdf" });
          await settled();
          return async () => {
            fake.emit({
              kind: "refused",
              refusal: {
                kind: "pdf-file",
                fileName: "a.pdf",
                remedy: "pdf-export-from-source",
              },
            });
            await settled();
          };
        },
      },
      {
        name: "overBudget",
        run: async (fake) => {
          const actor = start(fake);
          actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "huge.csv" });
          await settled();
          return async () => {
            fake.emit({ kind: "refused", refusal: overBudgetRefusal() });
            await settled();
          };
        },
      },
      {
        name: "cancelled",
        run: async (fake) => {
          const actor = await toParsing(fake);
          return async () => {
            actor.send({ type: "CANCEL" });
            fake.emit({ kind: "cancelled", batchesSent: 1 });
            await settled();
          };
        },
      },
      {
        name: "failed",
        run: async (fake) => {
          await toParsing(fake);
          return async () => {
            fake.emit({ kind: "failed", reason: "stage-rejected" });
            await settled();
          };
        },
      },
      {
        name: "done",
        run: async (fake) => {
          const actor = await toParsing(fake);
          fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
          await settled();
          await settled();
          await settled();
          return async () => {
            actor.send({ type: "CREATE_APP" });
            await settled();
            await settled();
          };
        },
      },
    ];

    for (const { name, run } of terminal) {
      const fake = happyServices();
      const enter = await run(fake);
      const before = fake.terminateCount();
      await enter();
      expect(fake.terminateCount(), name).toBe(before + 1);
    }
  });

  it("restarts cleanly from an ended run", () => {
    const fake = happyServices();
    const actor = start(fake);
    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: "a.pdf" });
    fake.emit({
      kind: "refused",
      refusal: {
        kind: "pdf-file",
        fileName: "a.pdf",
        remedy: "pdf-export-from-source",
      },
    });
    expect(actor.getSnapshot().matches("refused")).toBe(true);

    actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
    const snapshot = actor.getSnapshot();
    expect(snapshot.matches("detecting")).toBe(true);
    expect(snapshot.context.refusal).toBeUndefined();
    expect(snapshot.context.fileName).toBe(FILE_NAME);
  });
});

/**
 * The cancel ordering, as its own suite (SESSION-07 lease r2).
 *
 * The defect this pins was found by the CP4 e2e, not by a unit: cancelling
 * mid-parse rejected `cancelImportStage` with `revision-conflict` on every
 * run, so MOD-007's "no partial app remains" was never printed. The cause was
 * an ordering one — the cleanup followed the *instruction* to stop the parser
 * rather than the parser's report that it had — and ordering is exactly what a
 * machine test can hold.
 *
 * The negative control is the first case: with no terminal event, `cleanStage`
 * must not have been called at all. Without it the other two would pass
 * against the old machine as well.
 */
describe("a cancel waits for the parser before it cleans up", () => {
  it("does not touch the stage while the parser has not reported", async () => {
    const fake = happyServices();
    const actor = await toParsing(fake);

    actor.send({ type: "CANCEL" });
    await settled();

    // The parser was told to stop...
    expect(fake.names()).toContain("cancelParse");
    // ...and nothing has been removed, because batches may still be landing.
    expect(fake.names()).not.toContain("cancelStage");
    expect(actor.getSnapshot().matches({ cancelling: "stopping" })).toBe(true);
    expect(actor.getSnapshot().context.cleanupReceipt).toBeUndefined();
  });

  it.each([
    { kind: "cancelled", batchesSent: 3 },
    { kind: "completed", rowCount: 40, batchesSent: 3 },
    { kind: "failed", reason: "parse-failed" },
  ] as const)(
    "cleans up once the parser reports $kind",
    async (terminal) => {
      const fake = happyServices();
      const actor = await toParsing(fake);

      actor.send({ type: "CANCEL" });
      await settled();
      expect(fake.names()).not.toContain("cancelStage");

      fake.emit(terminal);
      await settled();

      expect(fake.names()).toContain("cancelStage");
      const snapshot = actor.getSnapshot();
      expect(snapshot.matches("cancelled")).toBe(true);
      expect(snapshot.context.cleanupReceipt?.completed).toBe(true);
    },
  );

  it("cleans up anyway when the parser never reports at all", async () => {
    vi.useFakeTimers();
    try {
      const fake = happyServices();
      const actor = start(fake);
      actor.send({ type: "CHOOSE_FILE", file: FILE, fileName: FILE_NAME });
      fake.emit(preflightEvent());
      actor.send({ type: "SET_APP_NAME", text: "Field Log" });
      actor.send({ type: "SET_TABLE_NAME", text: "Visits" });
      actor.send({ type: "CONTINUE" });
      actor.send({ type: "START" });
      await vi.advanceTimersByTimeAsync(0);

      actor.send({ type: "CANCEL" });
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.names()).not.toContain("cancelStage");

      // One tick short of the bound, the machine is still waiting.
      await vi.advanceTimersByTimeAsync(PARSER_STOP_TIMEOUT_MS - 1);
      expect(fake.names()).not.toContain("cancelStage");

      await vi.advanceTimersByTimeAsync(1);
      expect(fake.names()).toContain("cancelStage");
      expect(actor.getSnapshot().matches("cancelled")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for nothing when the parser has already finished", async () => {
    const fake = happyServices();
    const actor = await toParsing(fake);
    fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
    await settled();
    await settled();
    await settled();
    expect(actor.getSnapshot().matches({ reviewing: "deciding" })).toBe(true);

    actor.send({ type: "CANCEL" });
    await settled();

    // `reviewing` is only reachable through `completed`, so there is no
    // in-flight batch to wait for and the bound is never entered.
    expect(fake.names()).toContain("cancelStage");
    expect(actor.getSnapshot().matches("cancelled")).toBe(true);
  });
});

describe("import helpers", () => {
  it("counts whitespace as no name chosen", () => {
    expect(isChosenName(" \t\n")).toBe(false);
    expect(isChosenName(" Field Log ")).toBe(true);
  });

  it("refuses to stage a format pre-flight cannot have proceeded on", () => {
    const facts = preflightEvent();
    if (facts.kind !== "preflight") {
      throw new Error("fixture is not a pre-flight event");
    }
    expect(
      beginStageInput("x.csv", {
        ...facts,
        detected: { kind: "pdf" },
      }),
    ).toBeNull();
  });
});
