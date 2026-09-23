import { describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";
import {
  selectImportVm,
  type ImportReviewVm,
} from "../../../../src/application/view-models/import.js";
import { importMachine } from "../../../../src/application/workflows/import.machine.js";
import { ROUTE_HREFS } from "../../../../src/routes/guards.js";
import {
  ReviewScreen,
  describeNeedsAttention,
  describeStatement,
} from "../../../../src/ui/import/review-screen.js";
import type { ReviewEditIntentV1 } from "../../../../src/ui/import/review-edit-dialog.js";
import type {
  InferenceStatementWireV1,
  ProposedAppWireV1,
  ProposedFieldWireV1,
} from "../../../../src/workers/protocol/messages.js";
import "../../../../src/ui/theme/base.css";
import {
  cleanupReceipt,
  fakeImportServices,
  preflightEvent,
  resolves,
  stagePresent,
  workbookWire,
  STAGE_ID,
} from "../../workflows/fakes.js";
import {
  TARGET_MIN,
  interact,
  query,
  queryAll,
  render,
  typeInto,
} from "../render.js";
import { ALL_SHEETS, WITHOUT_ARCHIVE, demoProposal, demoReviewVm } from "./demo-review.js";

/**
 * SCR-023 as rendered (CAP-12, CAP-22; CA-16, CA-19; FR-4–FR-9).
 *
 * Two fixtures, both reaching the view model through the real machine:
 *
 * - **delimited** — S03's F02 shapes (an enum column, a currency column
 *   with a preserved violation, rows above the header) under the keys S02
 *   gives a delimited file; the review must read exactly as F02's did;
 * - **workbook** — S02's pinned demo proposal through S06's wire mapping,
 *   never a hand-authored shape (`demo-review.ts`).
 */

const nav = ROUTE_HREFS;
const noop = (): void => undefined;

const settled = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>("button").find((button) => button.textContent === name);

// --- the delimited fixture (F02's review, unchanged in content) ------------

function statement(overrides: Partial<InferenceStatementWireV1> = {}): InferenceStatementWireV1 {
  return {
    statementId: "s-1",
    subject: "field-type",
    editKind: "override-type",
    columnIndex: 0,
    evidence: [{ kind: "distinct-values", distinct: 3, sampled: 40, options: ["North", "South", "East"] }],
    evidenceFingerprint: "fp-1",
    disposition: "accepted",
    ...overrides,
  };
}

const siteField: ProposedFieldWireV1 = {
  columnIndex: 0,
  fieldName: "Site",
  isNameGenerated: false,
  type: { kind: "enum" },
  sourceFormat: { kind: "enum" },
  enumOptions: [
    { label: "North", occurrences: 18 },
    { label: "South", occurrences: 14 },
    { label: "East", occurrences: 8 },
  ],
  violations: { count: 0, examples: [] },
};

const amountField: ProposedFieldWireV1 = {
  columnIndex: 1,
  fieldName: "Quoted amount",
  isNameGenerated: false,
  type: { kind: "currency", currencyCode: "USD" },
  sourceFormat: { kind: "decimal", currencySymbol: "$" },
  enumOptions: [],
  violations: { count: 1, examples: [{ rowIndex: 20, sourceText: "TBD" }] },
};

function f02Proposal(overrides: Partial<ProposedAppWireV1> = {}): ProposedAppWireV1 {
  return {
    fileName: "field-log-messy.csv",
    appName: "Field Log Messy",
    table: { tableName: "Field Log Messy", fields: [siteField, amountField] },
    headerRowIndex: 2,
    leadingRows: [
      { rowIndex: 0, cells: ["Field log", ""] },
      { rowIndex: 1, cells: ["Sep 2025", ""] },
      { rowIndex: 2, cells: ["Site", "Quoted amount"] },
    ],
    discardedRows: [
      { rowIndex: 0, reason: "above-header", cells: ["Field log", ""] },
      { rowIndex: 1, reason: "above-header", cells: ["Sep 2025", ""] },
    ],
    discardedRowCount: 2,
    rowCount: 40,
    isRowCountExact: true,
    statements: [
      statement({
        statementId: "s-header",
        subject: "header-row",
        editKind: "set-header-row",
        columnIndex: null,
        evidence: [{ kind: "header-text", rowIndex: 2, text: "Site" }],
      }),
      statement({
        statementId: "s-discarded",
        subject: "discarded-rows",
        editKind: null,
        columnIndex: null,
        evidence: [{ kind: "row-shape", rowIndex: 0, cellCount: 9, valueCount: 1 }],
      }),
      statement(),
      statement({
        statementId: "s-2",
        columnIndex: 1,
        evidence: [{ kind: "value-conflict", count: 1, examples: [{ rowIndex: 20, sourceText: "TBD" }] }],
      }),
    ],
    diagnostics: [{ code: "ragged-row", severity: "warning", firstRowIndex: 12, firstColumnIndex: null, occurrences: 1 }],
    ...overrides,
  };
}

/** The delimited review, reached through the real machine (SCR-017 → review). */
async function delimitedVm(proposal: ProposedAppWireV1 = f02Proposal()): Promise<ImportReviewVm> {
  const wire = workbookWire(proposal);
  const fake = fakeImportServices({
    beginStage: resolves({ kind: "beginImportStage" as const, stageId: STAGE_ID }),
    getStage: stagePresent(),
    runInference: resolves({ kind: "runInference" as const, proposal: wire }),
    applyReviewEdit: resolves({ kind: "applyReviewEdit" as const, outcome: "applied" as const, proposal: wire }),
    cancelStage: resolves({ kind: "cancelImportStage" as const, receipt: cleanupReceipt() }),
  });
  const actor = createActor(importMachine, { input: { services: fake.services } });
  actor.start();
  actor.send({ type: "CHOOSE_FILE", file: new Blob(["Site\n"]), fileName: "field-log-messy.csv" });
  fake.emit(preflightEvent());
  actor.send({ type: "CONTINUE" });
  actor.send({ type: "START" });
  await settled();
  fake.emit({ kind: "completed", rowCount: 40, batchesSent: 1 });
  for (let tick = 0; tick < 4; tick += 1) await settled();
  const vm = selectImportVm(actor.getSnapshot());
  actor.stop();
  if (vm.screen !== "SCR-023" || vm.step === "done") throw new Error(`expected the review, got ${vm.screen}`);
  return vm;
}

/** Opens the Edit that belongs to one statement, not whichever comes first. */
async function openEdit(statementId: string): Promise<void> {
  await interact(() => {
    queryAll(`[data-statement="${statementId}"] button`)
      .find((button) => button.textContent === "Edit")
      ?.click();
  });
}

function screen(vm: ImportReviewVm, overrides: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  return (
    <ReviewScreen
      nav={nav}
      onApplyEdit={noop}
      onCancel={noop}
      onCreateApp={noop}
      vm={vm}
      {...overrides}
    />
  );
}

describe("SCR-023 delimited — one route, anchored sections, nothing auto-accepted", () => {
  it("renders every section and says which kind of empty each one is", async () => {
    await render(screen(await delimitedVm()));
    expect(query('[data-screen="SCR-023"]')).toBeTruthy();

    for (const id of [
      "tables-and-rows",
      "fields-and-choices",
      "connections",
      "live-calculations",
      "sheets-and-snapshots",
    ]) {
      expect(query(`[data-section="${id}"]`)).toBeTruthy();
    }

    // STA-025: "nothing of this kind to look for" is not "we found none".
    expect(document.body.textContent).toContain(
      "CSV and TSV carry values, not workbook structure, so there was nothing of this kind to look for.",
    );
    expect(document.body.textContent).not.toContain("Sheaf looked and found none");
  });

  it("is the only accept, and it names the app it will create", async () => {
    const onCreateApp = vi.fn();
    await render(screen(await delimitedVm(), { onCreateApp }));
    expect(document.body.textContent).toContain("No inference stands until you confirm.");
    await interact(() => {
      buttonNamed("Create Field Log Messy")?.click();
    });
    expect(onCreateApp).toHaveBeenCalledTimes(1);
  });

  it("disables the accept with the empty-file reason, not with silence", async () => {
    const vm = await delimitedVm(f02Proposal({ table: { tableName: "Empty", fields: [] }, statements: [] }));
    await render(screen(vm));
    const create = queryAll("button").find((button) => button.textContent?.startsWith("Create "));
    expect(create?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain(
      "Sheaf found no columns in this file, so there is nothing to create an app from.",
    );
  });

  it("says 'Not measured yet' after a header-row edit, never 'none'", async () => {
    const vm = await delimitedVm(
      f02Proposal({ table: { tableName: "Field Log Messy", fields: [{ ...siteField, violations: null }, amountField] } }),
    );
    expect(vm.isNeedsAttentionExact).toBe(false);
    await render(screen(vm));
    const cell = queryAll("[data-violations]").find(
      (node) => node.getAttribute("data-violations") === "not-measured-yet",
    );
    expect(cell?.textContent).toBe("Not measured yet");
    expect(describeNeedsAttention(vm)).toContain(
      "some fields have not been measured since you moved the header row",
    );
  });

  it("states needs-attention from measured values only", async () => {
    const vm = await delimitedVm();
    expect(describeNeedsAttention(vm)).toBe("1 original value does not match its field.");
    expect(describeNeedsAttention({ ...vm, needsAttentionCount: 0 })).toBe("Nothing needs your attention.");
  });

  it("shows a tag beside each statement and the detail behind it (SHT-013)", async () => {
    await render(screen(await delimitedVm()));
    expect(document.body.textContent).toContain("Repeated values");
    expect(document.body.textContent).toContain("Values that do not match");
    await interact(() => {
      buttonNamed("Why?")?.click();
    });
    const sheet = query('[role="dialog"]');
    expect(sheet.textContent).toContain("Why Sheaf thinks so");
    expect(sheet.textContent).toContain("Row 3 reads “Site”.");
  });

  it("composes each statement exactly as F02 did", async () => {
    const vm = await delimitedVm();
    const [table] = vm.tables;
    if (table === undefined) throw new Error("expected a table");
    expect(describeStatement(table.statements[0]!, vm)).toBe("“Field Log Messy” starts on row 3.");
    expect(describeStatement(table.statements[1]!, vm)).toBe(
      "2 rows will not become records. They are kept and stay readable.",
    );
    expect(describeStatement(table.fields[1]!.statements[0]!, vm)).toBe(
      "“Quoted amount” looks like currency in USD.",
    );
  });

  it("renames a field and emits exactly that edit, addressed by keys (CA-19)", async () => {
    const onApplyEdit = vi.fn<(edit: ReviewEditIntentV1) => void>();
    const vm = await delimitedVm(
      f02Proposal({ statements: [statement({ statementId: "s-name", subject: "field-name", editKind: "rename-field" })] }),
    );
    await render(screen(vm, { onApplyEdit }));
    await openEdit("s-name");
    await typeInto(query<HTMLInputElement>('[role="dialog"] input'), "Location");
    await interact(() => {
      buttonNamed("Save change")?.click();
    });
    expect(onApplyEdit).toHaveBeenCalledWith({
      kind: "rename-field",
      tableKey: "s0.r0",
      columnKey: "s0.r0.c0",
      fieldName: "Location",
    });
  });

  it("offers currency only where a currency code already exists", async () => {
    await render(screen(await delimitedVm()));
    await openEdit("s-1");
    await interact(() => {
      queryAll('[role="dialog"] button')
        .find((button) => button.textContent?.includes("A choice from a list"))
        ?.click();
    });
    const options = queryAll('[role="option"]').map((option) => option.textContent);
    expect(options).toContain("Text");
    expect(options).not.toContain("Currency");
    expect(options).not.toContain("A connection to another table");
  });

  it("renders the closed rejection reason when the stage refuses an edit", async () => {
    const vm = await delimitedVm();
    await render(screen({ ...vm, editRejection: "duplicate-name" }));
    expect(document.body.textContent).toContain("That change was not made.");
    expect(document.body.textContent).toContain("Another field already has that name.");
  });

  it("holds the edit affordances while the stage is applying one", async () => {
    const vm = await delimitedVm();
    await render(screen({ ...vm, step: "applyingEdit" }));
    const edits = queryAll("button").filter((button) => button.textContent === "Edit");
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) expect(edit.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain("Sheaf is applying your last change.");
  });

  it("keeps the discarded rows readable, and names what the parser noticed", async () => {
    await render(screen(await delimitedVm()));
    expect(document.body.textContent).toContain("View preserved rows");
    expect(document.body.textContent).toContain("Field log");
    expect(document.body.textContent).toContain("Some rows have more or fewer cells than the rest.");
    expect(document.body.textContent).toContain("First seen at row 13.");
  });

  it("gives every action the minimum hit area", async () => {
    await render(screen(await delimitedVm()));
    const buttons = queryAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(getComputedStyle(button).minHeight).toBe(TARGET_MIN);
  });
});

// --- the demo workbook (S02's pin through S06's wire mapping) --------------

describe("SCR-023 workbook — Tables & rows", () => {
  it("lists every table once, a joined region inside its table, with exact records", async () => {
    const vm = await demoReviewVm(await demoProposal());
    expect(vm.tables.map((table) => [table.tableName, table.rowCount])).toEqual([
      ["Jobs", { kind: "exact", value: 60 }],
      ["Customers", { kind: "exact", value: 12 }],
      ["Crew", { kind: "exact", value: 34 }],
      ["Visits", { kind: "exact", value: 40 }],
      ["Materials", { kind: "exact", value: 8 }],
      ["Archive 2018", { kind: "exact", value: 2_000 }],
    ]);
    await render(screen(vm));
    const tables = query('[data-section="tables-and-rows"]').textContent;
    expect(tables).toContain("Workbook declared table");
    expect(tables).toContain("“Crew” looks like one list, even with a blank row.");
    expect(tables).toContain("Matching headings");
    expect(tables).toContain("“Crew” starts on row 4.");
    expect(tables).toContain("3 rows will not become records. They are kept and stay readable.");
    expect(tables).toContain("“Job ID” identifies each record in “Jobs”.");
    expect(tables).toContain("Records in “Customers” are named by “Name”.");
    expect(tables).toContain("View preserved rows");
  });

  it("rejects the spacer merge as a stored choice through the stage's own edit", async () => {
    const onApplyEdit = vi.fn<(edit: ReviewEditIntentV1) => void>();
    await render(screen(await demoReviewVm(await demoProposal()), { onApplyEdit }));
    await openEdit("table-merge:s2.r1");
    await interact(() => {
      buttonNamed("Reject this")?.click();
    });
    expect(onApplyEdit).toHaveBeenCalledWith({ kind: "reject-statement", statementId: "table-merge:s2.r1" });
  });
});

describe("SCR-023 workbook — Fields & choices", () => {
  it("names each field's evidence in review.html's words, grouped by table", async () => {
    await render(screen(await demoReviewVm(await demoProposal())));
    const fields = query('[data-section="fields-and-choices"]').textContent;
    expect(fields).toContain("Excel validation rule");
    expect(fields).toContain("Workbook number format");
    expect(fields).toContain("“Status” looks like a choice with 4 options.");
    expect(fields).toContain("“Quoted amount” looks like currency in USD.");
    expect(fields).toContain("“Customer ID” looks like a connection to another table.");
    expect(queryAll('[data-section="fields-and-choices"] h3').map((heading) => heading.textContent)).toContain("Customers");
  });
});

describe("SCR-023 workbook — Connections", () => {
  it("states each connection plainly, with its signal and endpoints", async () => {
    await render(screen(await demoReviewVm(await demoProposal())));
    const links = query('[data-section="connections"]').textContent;
    expect(links).toContain("Each record in “Jobs” belongs to one record in “Customers”.");
    expect(links).toContain(
      "Each “Customers” record will list its “Jobs” records, and each “Jobs” record will show its “Name” instead of the raw “Customer ID”.",
    );
    expect(links).toContain("Your VLOOKUP formula");
    expect(links).toContain("Jobs → Customers");
    expect(links).toContain("1 “Customer ID” key matches no record in “Customers”. They are kept and flagged.");
    expect(links).toContain("Each record in “Visits” belongs to one record in “Jobs”.");
    expect(links).toContain("Matching IDs");
  });

  it("changes a connection through SHT-013's edit: reject Visits → Jobs", async () => {
    const onApplyEdit = vi.fn<(edit: ReviewEditIntentV1) => void>();
    await render(screen(await demoReviewVm(await demoProposal()), { onApplyEdit }));
    await interact(() => {
      queryAll('[data-connection="rel:s3.t0.c1"] button')
        .find((button) => button.textContent === "Change connection")
        ?.click();
    });
    await interact(() => {
      queryAll('[role="dialog"] button')
        .find((button) => button.textContent?.includes("Keep:"))
        ?.click();
    });
    const options = queryAll('[role="option"]').map((option) => option.textContent);
    // Retarget is offered only where S02 found evidence for it.
    expect(options).toEqual([
      "Keep: “Visits” belongs to “Jobs”",
      "Do not connect these lists",
      "Connect to “Archive 2018” instead",
    ]);
    await interact(() => {
      queryAll('[role="option"]')
        .find((option) => option.textContent === "Do not connect these lists")
        ?.click();
    });
    await interact(() => {
      buttonNamed("Save change")?.click();
    });
    expect(onApplyEdit).toHaveBeenCalledWith({ kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" });
  });

  it("keeps a rejected connection on the page as a stored choice, never a vanished card", async () => {
    const rejected = await demoProposal(ALL_SHEETS, [{ kind: "reject-relationship", relationshipKey: "rel:s3.t0.c1" }]);
    const vm = await demoReviewVm(rejected);
    await render(screen(vm));
    const card = query('[data-connection="rel:s3.t0.c1"]');
    expect(card.getAttribute("data-applied")).toBe("false");
    expect(card.textContent).toContain("You chose not to connect “Visits” to “Jobs”.");
    expect(card.textContent).toContain("You rejected this");
    expect(card.textContent).toContain("Change connection");
    // Still counted: the section says what is there, rejections included.
    expect(vm.sections.find((section) => section.id === "connections")?.count).toBe(2);
  });
});

describe("SCR-023 workbook — Live calculations (CAP-38, D51, D62)", () => {
  const LIVE = "ooxml/formulas-live.xlsx";
  const liveVm = async (edits: Parameters<typeof demoProposal>[1] = []) =>
    demoReviewVm(await demoProposal([0, 1, 2], edits, LIVE), [0, 1, 2], {}, LIVE);
  const article = (formulaKey: string): string => query(`[data-calculation="${formulaKey}"]`).textContent;

  it("F04: formulas now live — the demo's six, each with its evidence and a reject", async () => {
    const vm = await demoReviewVm(await demoProposal());
    expect(vm.sections.find((section) => section.id === "live-calculations")?.count).toBe(6);
    expect(vm.formulaRegionCount).toBe(0);
    await render(screen(vm));
    const section = query('[data-section="live-calculations"]').textContent;
    expect(section).toContain("Live calculations");
    expect(section).toContain("6 formulas keep working");
    expect(article("s0.t0.c6")).toContain("“Balance” is a live calculation.");
    expect(article("s0.t0.c6")).toContain(
      "All 60 rows hold the same formula, so every row will recalculate immediately when its inputs change, including rows you add later.",
    );
    expect(article("s0.t0.c6")).toContain("From Jobs!G2:G61: =E2-F2");
    expect(article("s0.t0.c6")).toContain("Filled-down formula");
    expect(article("s0.t0.c6")).toContain("Live computed value");
    expect(article("s0.t0.c2")).toContain("It reads “Customers” through its connection.");
    expect(article("s5.R3C2")).toContain("“Open jobs” is a live summary value.");
    expect(article("s5.R3C2")).toContain("Summary formula");
    expect(section).not.toContain("Needs attention");
    for (const calculation of queryAll("[data-calculation]")) {
      const labels = [...calculation.querySelectorAll("button")].map((button) => button.textContent);
      expect(labels).toEqual(["Reject…", "Why?"]);
    }
  });

  it("states every disposition truthfully: live, clock-live, frozen, unsupported, not filled down, a total", async () => {
    await render(screen(await liveVm()));
    const section = query('[data-section="live-calculations"]').textContent;
    // Two of the ten are kept as imported values.
    expect(section).toContain("8 formulas keep working");
    expect(article("s0.t0.c4")).toContain("It reads today's date, so it is recalculated rather than stored.");
    expect(article("s0.t0.c5")).toContain("“Lucky” is frozen at import.");
    expect(article("s0.t0.c5")).toContain("each imported row keeps the value the workbook calculated, frozen");
    expect(article("s0.t0.c6")).toContain("OFFSET is not supported yet.");
    expect(article("s0.t0.c6")).toContain(
      "Existing imported results stay visible. New rows will leave this value empty and flagged—not silently set it to zero.",
    );
    expect(article("s0.t0.c6")).toContain("Original formula preserved");
    expect(article("s0.t0.c6")).toContain("Needs attention");
    expect(article("s0.t0.c7")).toContain("“Mixed” cannot be calculated.");
    expect(article("s0.t0.c7")).toContain("Only 4 of 5 rows hold the same formula; row 6 differs.");
    expect(article("s0.t0.c1.R7")).toContain("“Total Quoted” is a live total of “Jobs”.");
    expect(article("s0.t0.c1.R7")).toContain("Totals row formula");
    expect(section).toContain("2 formula regions keep the workbook's values");
  });

  it("rejects a live formula through SHT-013's edit", async () => {
    const onApplyEdit = vi.fn<(edit: ReviewEditIntentV1) => void>();
    await render(screen(await demoReviewVm(await demoProposal()), { onApplyEdit }));
    await interact(() => {
      [...query('[data-calculation="s0.t0.c6"]').querySelectorAll("button")].find((button) => button.textContent === "Reject…")?.click();
    });
    expect(query('[role="dialog"]').textContent).toContain("“Balance” is a live calculation. Reject it and Sheaf will not use it");
    await interact(() => {
      buttonNamed("Reject this")?.click();
    });
    expect(onApplyEdit).toHaveBeenCalledWith({ kind: "reject-statement", statementId: "formula:s0.t0.c6" });
  });

  it("keeps a declined formula's values as a stored choice, and restores it", async () => {
    const onApplyEdit = vi.fn<(edit: ReviewEditIntentV1) => void>();
    const declined = await demoReviewVm(await demoProposal(ALL_SHEETS, [{ kind: "reject-statement", statementId: "formula:s0.t0.c6" }]));
    expect(declined.formulaRegionCount).toBe(1);
    await render(screen(declined, { onApplyEdit }));
    expect(article("s0.t0.c6")).toContain("“Balance” keeps its imported values.");
    expect(article("s0.t0.c6")).toContain("You rejected this");
    expect(query('[data-section="live-calculations"]').textContent).toContain("5 formulas keep working");
    await interact(() => {
      [...query('[data-calculation="s0.t0.c6"]').querySelectorAll("button")].find((button) => button.textContent === "Restore…")?.click();
    });
    await interact(() => {
      buttonNamed("Restore this")?.click();
    });
    expect(onApplyEdit).toHaveBeenCalledWith({ kind: "restore-statement", statementId: "formula:s0.t0.c6" });
  });

  it("turns a lookup unsupported when its connection is rejected (D49)", async () => {
    await render(
      screen(await demoReviewVm(await demoProposal(ALL_SHEETS, [{ kind: "reject-relationship", relationshipKey: "rel:s0.t0.c1" }]))),
    );
    expect(article("s0.t0.c2")).toContain("“Customer” cannot be calculated.");
    expect(article("s0.t0.c2")).toContain("Its lookup does not go through a connection Sheaf is creating.");
  });

  it("states a workbook comparison validation as a rule, with the other statements (CA-27)", async () => {
    await render(screen(await liveVm()));
    expect(query('[data-section="fields-and-choices"]').textContent).toContain(
      "“Quoted” must be at least 0 (the workbook declared this).",
    );
  });
});

describe("SCR-023 workbook — Sheets & snapshots", () => {
  it("F04: Overview becomes the app dashboard — its chart rebuilt and pinned, its values live (D55, D65)", async () => {
    await render(screen(await demoReviewVm(await demoProposal())));
    const sheets = query('[data-section="sheets-and-snapshots"]').textContent;
    expect(sheets).toContain("Nothing was silently dropped");
    expect(sheets).toContain("7 of 7 preserved");
    expect(sheets).toContain("“Overview” becomes your app dashboard");
    expect(sheets).toContain("1 chart and 4 summary values rebuilt");
    expect(sheets).toContain("“Quoted by status” is rebuilt as a live chart from “Jobs”, pinned to the app's home.");
    expect(sheets).toContain("Workbook chart");
    expect(sheets).toContain("“Materials” supplies choice values");
    expect(sheets).toContain("“Jobs” becomes a working table");
    // STA-012: type, location, reason.
    expect(sheets).toContain("2 drawing objects kept in “Overview” (Overview!D20:F24, Overview!H20:J24).");
    expect(sheets).toContain("Preserved in the snapshot; Sheaf cannot make it interactive.");
    expect(sheets).not.toContain("later release");
  });

  it("shows the chart's grouping as its evidence (D62)", async () => {
    await render(screen(await demoReviewVm(await demoProposal())));
    await interact(() => {
      [...query('[data-statement="chart:s5.chart0"]').querySelectorAll("button")].find((button) => button.textContent === "Why?")?.click();
    });
    expect(query('[role="dialog"]').textContent).toContain(
      "Excel plotted each row; Sheaf groups rows with the same “Status” and adds “Quoted amount”.",
    );
  });

  it("keeps a declined chart as a snapshot, saying why", async () => {
    await render(screen(await demoReviewVm(await demoProposal(ALL_SHEETS, [{ kind: "reject-statement", statementId: "chart:s5.chart0" }]))));
    const sheets = query('[data-section="sheets-and-snapshots"]').textContent;
    expect(sheets).toContain("“Quoted by status” stays a snapshot of the workbook's chart.");
    expect(sheets).toContain("1 chart kept in “Overview” (Overview!D2:K18). Kept as a snapshot. Sheaf could not rebuild it as a live chart.");
    // Its four summary values still reach the home screen.
    expect(sheets).toContain("4 summary values rebuilt");
  });

  it("D43 watchpoint — excluded-sheet rows: an unselected sheet is excluded by the user's choice (D39)", async () => {
    await render(screen(await demoReviewVm(await demoProposal(WITHOUT_ARCHIVE), WITHOUT_ARCHIVE)));
    const archive = query('[data-sheet="s6"]').textContent;
    expect(archive).toContain("“Archive 2018” is excluded by your choice");
    expect(archive).toContain("It was not imported, and it remains in the source workbook Sheaf keeps.");
    expect(archive).toContain("Excluded");
  });
});

describe("SCR-023 workbook — Needs attention and the accept", () => {
  it("counts measured violations and broken references, and names the app it creates", async () => {
    const vm = await demoReviewVm(await demoProposal());
    expect(vm.brokenReferenceCount).toBe(1);
    expect(describeNeedsAttention(vm)).toBe(
      "4 original values do not match their fields, and 1 reference matches no record.",
    );
    await render(screen(vm));
    expect(buttonNamed("Create Fieldwork Q3")).toBeTruthy();
    for (const button of queryAll("button")) expect(getComputedStyle(button).minHeight).toBe(TARGET_MIN);
  });

  it("renders a refused promotion's issues per field, and nothing was written", async () => {
    const vm = await demoReviewVm(await demoProposal(), ALL_SHEETS, {
      promoteImport: resolves({
        kind: "promoteImport" as const,
        outcome: "rejected" as const,
        reason: "record-invalid",
        issues: [
          { fieldId: "field-a", kind: "wrong-type", severity: "blocking" as const, messageKey: "validation.wrong-type" },
          { fieldId: "field-a", kind: "wrong-type", severity: "blocking" as const, messageKey: "validation.wrong-type" },
          { fieldId: "field-b", kind: "required", severity: "blocking" as const, messageKey: "validation.required" },
        ],
      }),
    });
    await render(screen(vm));
    expect(document.body.textContent).toContain("The app was not created.");
    const issues = queryAll("[data-promotion-issues] li").map((item) => item.textContent);
    expect(issues).toEqual([
      "One field, 2 values: This value is not the kind this field holds.",
      "One field, 1 value: This field needs a value before the record can be saved.",
    ]);
  });

  it("names each refused field as reviewed, by its table, when the worker names its column", async () => {
    const proposal = await demoProposal();
    const columnOf = (tableName: string, fieldName: string): string => {
      const found = proposal.tables
        .find((table) => table.tableName === tableName)
        ?.fields.find((field) => field.fieldName === fieldName);
      if (found === undefined) throw new Error(`the demo has no ${tableName}.${fieldName}`);
      return found.columnKey;
    };
    const issue = { kind: "type", severity: "blocking" as const, messageKey: "validation.wrong-type" };
    const vm = await demoReviewVm(proposal, ALL_SHEETS, {
      promoteImport: resolves({
        kind: "promoteImport" as const,
        outcome: "rejected" as const,
        reason: "record-invalid",
        issues: [
          { ...issue, fieldId: "field-a", columnKey: columnOf("Jobs", "Customer ID") },
          { ...issue, fieldId: "field-a", columnKey: columnOf("Jobs", "Customer ID") },
          { ...issue, fieldId: "field-b", columnKey: columnOf("Customers", "Customer ID") },
          { ...issue, fieldId: null, columnKey: null },
        ],
      }),
    });
    await render(screen(vm));
    const issues = queryAll("[data-promotion-issues] li").map((item) => item.textContent);
    expect(issues).toEqual([
      "“Customer ID” in “Jobs”, 2 values: This value is not the kind this field holds.",
      "“Customer ID” in “Customers”, 1 value: This value is not the kind this field holds.",
      "A whole record: This value is not the kind this field holds.",
    ]);
  });

  it("D43 watchpoint — append-too-large reason: says nothing was written and the way that works", async () => {
    const vm = await demoReviewVm(await demoProposal());
    await render(screen({ ...vm, promotionRejection: "append-too-large" }));
    expect(document.body.textContent).toContain("The table was not added.");
    expect(document.body.textContent).toContain(
      "This file has more rows than one addition to an app can hold, so nothing was written and this review is unchanged. It can be imported as a new app instead.",
    );
  });
});
