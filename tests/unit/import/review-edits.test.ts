import { describe, expect, it } from "vitest";
import {
  inferProposal,
  type ProposedAppV1,
} from "../../../src/import/inference/infer.js";
import {
  applyReviewEdit,
  type ReviewEditV1,
} from "../../../src/import/inference/review-edits.js";
import { parseFixture } from "./parse-harness.js";

const demoProposal = async (): Promise<ProposedAppV1> => {
  const { items } = await parseFixture(
    "delimited/field-log-messy.csv",
    "field-log-messy.csv",
  );
  return inferProposal(items, { fileName: "field-log-messy.csv" });
};

const applied = (
  proposal: ProposedAppV1,
  edit: ReviewEditV1,
): ProposedAppV1 => {
  const result = applyReviewEdit(proposal, edit);
  if (result.kind !== "applied") {
    throw new Error(`edit rejected: ${result.reason}`);
  }
  return result.proposal;
};

const dispositionOf = (proposal: ProposedAppV1, statementId: string) =>
  proposal.statements.find(
    (statement) => statement.statementId === statementId,
  )?.disposition;

describe("review edits", () => {
  it("renames the app, the table and a field, marking each statement edited", async () => {
    const base = await demoProposal();

    const renamed = applied(applied(applied(base, {
      kind: "rename-app",
      appName: "  Cedar & Finch Fieldbook  ",
    }), { kind: "rename-table", tableName: "Visits" }), {
      kind: "rename-field",
      columnIndex: 2,
      fieldName: "Location",
    });

    expect(renamed.appName).toBe("Cedar & Finch Fieldbook");
    expect(renamed.table.tableName).toBe("Visits");
    expect(renamed.table.fields[2]?.fieldName).toBe("Location");
    expect(renamed.table.fields[2]?.isNameGenerated).toBe(false);
    expect(dispositionOf(renamed, "app-name")).toBe("edited");
    expect(dispositionOf(renamed, "table-name")).toBe("edited");
    expect(dispositionOf(renamed, "field-name:2")).toBe("edited");
    // Untouched statements keep their disposition: only what changed is edited.
    expect(dispositionOf(renamed, "field-type:2")).toBe("accepted");

    // The original is untouched — the function is pure.
    expect(base.appName).toBe("Field Log Messy");
  });

  it("overrides a type and stops claiming a measurement it no longer has", async () => {
    const base = await demoProposal();
    expect(base.table.fields[2]?.type).toEqual({ kind: "enum" });
    expect(base.table.fields[2]?.enumOptions).toHaveLength(8);

    const overridden = applied(base, {
      kind: "override-type",
      columnIndex: 2,
      type: { kind: "text" },
    });

    expect(overridden.table.fields[2]).toMatchObject({
      type: { kind: "text" },
      sourceFormat: { kind: "text" },
      enumOptions: [],
      violations: null,
    });
    expect(dispositionOf(overridden, "field-type:2")).toBe("edited");
  });

  it("moves the header row, re-deriving names, discards and the exact row count", async () => {
    const base = await demoProposal();
    expect(base.headerRowIndex).toBe(3);
    expect(base.rowCount).toBe(40);

    const moved = applied(base, { kind: "set-header-row", rowIndex: 4 });

    expect(moved.headerRowIndex).toBe(4);
    // Row 4 was a data row and is now the heading, so one row less.
    expect(moved.rowCount).toBe(39);
    expect(moved.discardedRowCount).toBe(4);
    expect(moved.table.fields[0]?.fieldName).toBe("1001");
    expect(dispositionOf(moved, "header-row")).toBe("edited");

    const back = applied(moved, { kind: "set-header-row", rowIndex: 3 });
    expect(back.rowCount).toBe(40);
    expect(back.table.fields.map((field) => field.fieldName)).toEqual(
      base.table.fields.map((field) => field.fieldName),
    );

    // Declaring the file headerless puts every leading row back into the data.
    const headerless = applied(base, { kind: "set-header-row", rowIndex: null });
    expect(headerless.headerRowIndex).toBeNull();
    expect(headerless.rowCount).toBe(43);
    expect(headerless.discardedRowCount).toBe(0);
    expect(headerless.table.fields[0]?.fieldName).toBe("Column 1");
    expect(headerless.table.fields[0]?.isNameGenerated).toBe(true);
  });

  it("edits enum options, keeping the counts it already knows", async () => {
    const base = await demoProposal();

    const edited = applied(base, {
      kind: "edit-enum-options",
      columnIndex: 3,
      options: ["Scheduled", "In progress", "Waiting", "Complete", "Cancelled"],
    });

    expect(edited.table.fields[3]?.enumOptions).toEqual([
      { label: "Scheduled", occurrences: 10 },
      { label: "In progress", occurrences: 10 },
      { label: "Waiting", occurrences: 10 },
      { label: "Complete", occurrences: 10 },
      { label: "Cancelled", occurrences: 0 },
    ]);
    expect(dispositionOf(edited, "enum-options:3")).toBe("edited");
  });

  it("rejects the edits that cannot land, naming which one and changing nothing", async () => {
    const base = await demoProposal();

    const cases: readonly (readonly [ReviewEditV1, string])[] = [
      [{ kind: "rename-app", appName: "   " }, "empty-name"],
      [{ kind: "rename-table", tableName: "" }, "empty-name"],
      [
        { kind: "rename-app", appName: "Jose\u0301" },
        "name-not-nfc",
      ],
      [
        { kind: "rename-field", columnIndex: 99, fieldName: "X" },
        "unknown-column",
      ],
      [
        { kind: "rename-field", columnIndex: 0, fieldName: "Site" },
        "duplicate-name",
      ],
      [
        { kind: "override-type", columnIndex: -1, type: { kind: "text" } },
        "unknown-column",
      ],
      [{ kind: "set-header-row", rowIndex: 400 }, "row-outside-leading-rows"],
      [
        { kind: "edit-enum-options", columnIndex: 0, options: ["a"] },
        "not-an-enum-field",
      ],
      [
        { kind: "edit-enum-options", columnIndex: 3, options: [] },
        "no-enum-options",
      ],
      [
        { kind: "edit-enum-options", columnIndex: 3, options: ["a", "a"] },
        "duplicate-enum-option",
      ],
      [
        {
          kind: "edit-enum-options",
          columnIndex: 3,
          options: Array.from({ length: 13 }, (_unused, index) => `o${index}`),
        },
        "too-many-enum-options",
      ],
    ];

    for (const [edit, reason] of cases) {
      expect([edit.kind, applyReviewEdit(base, edit)], edit.kind).toEqual([
        edit.kind,
        { kind: "rejected", reason },
      ]);
    }
    expect(base.appName).toBe("Field Log Messy");
  });
});
