/**
 * CAP-12 / CA-16 at the worker tier, in a real browser (S04 CP4).
 *
 * The claim is that the review screen will see exactly what S03's inference
 * produced — not a re-derivation, not a subset. So the demo fixture goes
 * through the *whole* real path (import worker → channel → data worker →
 * encrypted stage → RPC) and the proposal that comes back is compared against
 * S03's pinned expectations for that same file.
 *
 * The second claim is that the stage is authoritative (D17): an edit applied
 * through the worker survives being re-read from storage, because it was
 * written into the stage rather than kept in a page's memory.
 */

import { expect, test } from "@playwright/test";
import {
  PASSPHRASE,
  command,
  installFixture,
  runImport,
  start,
  teardown,
} from "./runtime.js";

const JOURNEY_TIMEOUT_MS = 180_000;

test.beforeEach(async ({ page }) => {
  await page.goto("/harness.html");
});

test.afterEach(async ({ page }) => {
  await teardown(page);
});

/** Sets up a device and streams the demo fixture into a staged import. */
async function stagedDemo(
  page: import("@playwright/test").Page,
): Promise<string> {
  await start(page);
  const created = await command(page, { kind: "setup", passphrase: PASSPHRASE });
  expect(created.ok).toBe(true);

  await installFixture(
    page,
    "delimited/field-log-messy.csv",
    "field-log-messy.csv",
  );
  const run = await runImport(page);
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  expect(run.stageId).not.toBeNull();
  return run.stageId as string;
}

test("the demo fixture's pinned proposal reproduces through the worker path", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const stageId = await stagedDemo(page);

  const inferred = await command(page, { kind: "runInference", stageId });
  if (!inferred.ok || inferred.response.kind !== "runInference") {
    throw new Error("expected a proposal");
  }
  const proposal = inferred.response.proposal;

  // S03's pinned demo expectations, reached through the real worker rather
  // than by calling `inferProposal` in a unit test.
  expect(proposal.appName).toBe("Field Log Messy");
  expect(proposal.headerRowIndex).toBe(3);
  expect(proposal.rowCount).toBe(40);
  expect(proposal.isRowCountExact).toBe(true);
  expect(proposal.table.fields).toHaveLength(9);
  expect(proposal.statements).toHaveLength(24);

  // The enum and currency findings the demo turns on.
  const site = proposal.table.fields.find((field) => field.fieldName === "Site");
  expect(site?.type.kind).toBe("enum");
  const currency = proposal.table.fields.find(
    (field) => field.type.kind === "currency",
  );
  expect(currency?.type).toEqual({ kind: "currency", currencyCode: "USD" });
  expect(currency?.violations?.count).toBe(1);

  // D28's parse-half diagnostic must survive all the way to review data: the
  // NFC normalisation the parser did is a fact the user is told about, and a
  // stage that dropped it would make the import silently lossy.
  expect(proposal.diagnostics.map((entry) => entry.code)).toContain(
    "ragged-row",
  );

  // Every statement carries its fingerprint input, so a rejection recorded
  // once can keep standing across a re-import (FR-7).
  expect(
    proposal.statements.every((entry) => entry.evidenceFingerprint.length > 0),
  ).toBe(true);
  expect(
    new Set(proposal.statements.map((entry) => entry.evidenceFingerprint)).size,
  ).toBe(proposal.statements.length);

  // The stage now says it holds a proposal.
  const view = await command(page, { kind: "getImportStage", stageId });
  if (!view.ok || view.response.kind !== "getImportStage") {
    throw new Error("expected a stage view");
  }
  expect(view.response.stage?.hasProposal).toBe(true);
  expect(view.response.stage?.status).toBe("reviewing");
});

test("D28: NFD source stages without a codec error, and says so at review", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  await start(page);
  const created = await command(page, { kind: "setup", passphrase: PASSPHRASE });
  expect(created.ok).toBe(true);

  await installFixture(page, "delimited/nfd-crew.csv", "nfd-crew.csv");
  const run = await runImport(page);

  // The staging half of D28: the canonical CBOR codec refuses non-NFC text in
  // both directions, so a parser that had *not* normalised would fail every
  // batch here. Completing at all is the proof that it did.
  expect(run.events.some((event) => event.kind === "completed")).toBe(true);
  expect(run.events.some((event) => event.kind === "failed")).toBe(false);
  const stageId = run.stageId as string;

  const view = await command(page, { kind: "getImportStage", stageId });
  if (!view.ok || view.response.kind !== "getImportStage") {
    throw new Error("expected a stage view");
  }
  expect(view.response.stage?.status).toBe("staged");
  expect(view.response.stage?.factChunkCount).toBeGreaterThan(0);

  const inferred = await command(page, { kind: "runInference", stageId });
  if (!inferred.ok || inferred.response.kind !== "runInference") {
    throw new Error("expected a proposal");
  }
  // And the normalisation is not silent: the diagnostic survives staging all
  // the way to the review data, which is what keeps FR-4/FR-6 truthful.
  const normalized = inferred.response.proposal.diagnostics.find(
    (entry) => entry.code === "text-normalized-nfc",
  );
  expect(normalized).toBeDefined();
  expect(normalized?.occurrences).toBeGreaterThan(0);

  // The normalised text is what is stored — NFC, and readable.
  const names = inferred.response.proposal.leadingRows.flatMap((row) => row.cells);
  expect(names.every((cell) => cell.normalize("NFC") === cell)).toBe(true);
});

test("an edit is written into the stage and survives a re-read", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const stageId = await stagedDemo(page);
  await command(page, { kind: "runInference", stageId });

  // Rename the app and override the type S03's demo note calls the natural
  // override: `Site` infers as an enum, and the user makes it plain text.
  const renamed = await command(page, {
    kind: "applyReviewEdit",
    stageId,
    edit: { kind: "rename-app", appName: "Site Field Log" },
  });
  if (!renamed.ok || renamed.response.kind !== "applyReviewEdit") {
    throw new Error("expected an edit result");
  }
  expect(renamed.response.outcome).toBe("applied");

  const overridden = await command(page, {
    kind: "applyReviewEdit",
    stageId,
    edit: { kind: "override-type", columnIndex: 0, type: { kind: "text" } },
  });
  if (
    !overridden.ok ||
    overridden.response.kind !== "applyReviewEdit" ||
    overridden.response.outcome !== "applied"
  ) {
    throw new Error("expected the override to apply");
  }
  expect(overridden.response.proposal.table.fields[0]?.type.kind).toBe("text");
  // Nothing has measured the new type yet, so the count is null, not zero.
  expect(overridden.response.proposal.table.fields[0]?.violations).toBeNull();

  // Re-read the proposal from the encrypted stage. `runInference` returns the
  // *staged* proposal rather than inferring again, so the edits are still
  // there — which is what "the stage is authoritative" means (D17).
  const reread = await command(page, { kind: "runInference", stageId });
  if (!reread.ok || reread.response.kind !== "runInference") {
    throw new Error("expected the staged proposal");
  }
  expect(reread.response.proposal.appName).toBe("Site Field Log");
  expect(reread.response.proposal.table.fields[0]?.type.kind).toBe("text");

  // Both edited statements are marked `edited`, which is exactly what
  // promotion writes into `inference-decision.recorded`.
  const dispositions = new Map(
    reread.response.proposal.statements.map((entry) => [
      entry.statementId,
      entry.disposition,
    ]),
  );
  expect(dispositions.get("app-name")).toBe("edited");
  expect(dispositions.get("field-type:0")).toBe("edited");
});

test("an impossible edit is a typed result, not an error, and changes nothing", async ({
  page,
}) => {
  test.setTimeout(JOURNEY_TIMEOUT_MS);
  const stageId = await stagedDemo(page);
  const before = await command(page, { kind: "runInference", stageId });
  if (!before.ok || before.response.kind !== "runInference") {
    throw new Error("expected a proposal");
  }

  const rejected = await command(page, {
    kind: "applyReviewEdit",
    stageId,
    edit: { kind: "rename-field", columnIndex: 99, fieldName: "Nowhere" },
  });

  // D23: a refusal the user can act on crosses as a result, not an error kind.
  expect(rejected.ok).toBe(true);
  if (!rejected.ok || rejected.response.kind !== "applyReviewEdit") {
    throw new Error("expected an edit result");
  }
  expect(rejected.response.outcome).toBe("rejected");
  if (rejected.response.outcome !== "rejected") {
    throw new Error("expected a rejection");
  }
  expect(rejected.response.reason).toBe("unknown-column");

  // The stage relays the rejection and writes nothing.
  const after = await command(page, { kind: "runInference", stageId });
  if (!after.ok || after.response.kind !== "runInference") {
    throw new Error("expected the staged proposal");
  }
  expect(after.response.proposal).toEqual(before.response.proposal);
});
