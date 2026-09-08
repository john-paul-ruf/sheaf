import { describe, expect, it } from "vitest";
import {
  inferProposal,
  PROPOSAL_LEADING_ROWS,
  type ProposedAppV1,
} from "../../../src/import/inference/infer.js";
import {
  sourceTextToCellValue,
  type SourceTypingV1,
} from "../../../src/import/inference/values.js";
import { generateLargeDelimited } from "../../fixtures/workbooks/delimited/generate-large.js";
import { parseFixture, parseText } from "./parse-harness.js";

const proposalOf = async (
  fixture: string,
  fileName: string,
): Promise<ProposedAppV1> => {
  const { items } = await parseFixture(`delimited/${fixture}`, fileName);
  return inferProposal(items, { fileName });
};

const typingOf = (
  proposal: ProposedAppV1,
  columnIndex: number,
): SourceTypingV1 => {
  const field = proposal.table.fields[columnIndex];
  if (field === undefined) {
    throw new Error(`no column ${columnIndex}`);
  }
  return {
    type: field.type,
    sourceFormat: field.sourceFormat,
    enumOptions: field.enumOptions.map((option) => option.label),
  };
};

const ids = (proposal: ProposedAppV1) =>
  proposal.statements.map((statement) => [
    statement.statementId,
    statement.editKind,
    statement.disposition,
  ]);

const statement = (proposal: ProposedAppV1, statementId: string) => {
  const found = proposal.statements.find(
    (candidate) => candidate.statementId === statementId,
  );
  if (found === undefined) {
    throw new Error(`no statement ${statementId}`);
  }
  return found;
};

describe("CA-16 — the demo fixture's proposal is pinned", () => {
  it("proposes exactly this app for field-log-messy.csv", async () => {
    const proposal = await proposalOf(
      "field-log-messy.csv",
      "field-log-messy.csv",
    );

    expect({
      appName: proposal.appName,
      tableName: proposal.table.tableName,
      headerRowIndex: proposal.headerRowIndex,
      rowCount: proposal.rowCount,
      isRowCountExact: proposal.isRowCountExact,
      discardedRowCount: proposal.discardedRowCount,
      discardedRows: proposal.discardedRows,
      leadingRowCount: proposal.leadingRows.length,
      fields: proposal.table.fields,
      diagnostics: proposal.diagnostics,
    }).toEqual({
      appName: "Field Log Messy",
      tableName: "Field Log Messy",
      headerRowIndex: 3,
      rowCount: 40,
      isRowCountExact: true,
      discardedRowCount: 3,
      discardedRows: [
        {
          rowIndex: 0,
          reason: "above-header",
          cells: ["Cedar & Finch Field Log"],
        },
        { rowIndex: 1, reason: "above-header", cells: ["Exported 2026-03-14"] },
        { rowIndex: 2, reason: "above-header", cells: [""] },
      ],
      leadingRowCount: PROPOSAL_LEADING_ROWS,
      fields: [
        {
          columnIndex: 0,
          fieldName: "Visit ID",
          isNameGenerated: false,
          type: { kind: "number" },
          sourceFormat: { kind: "decimal", currencySymbol: null },
          enumOptions: [],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 1,
          fieldName: "Visit date",
          isNameGenerated: false,
          type: { kind: "date" },
          sourceFormat: { kind: "iso-date" },
          enumOptions: [],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 2,
          fieldName: "Site",
          isNameGenerated: false,
          type: { kind: "enum" },
          sourceFormat: { kind: "enum" },
          enumOptions: [
            { label: "Alder Court", occurrences: 5 },
            { label: "Bramble Yard", occurrences: 5 },
            { label: "Cedar Mill", occurrences: 5 },
            { label: "Dunmore Lot", occurrences: 5 },
            { label: "Eastgate Works", occurrences: 5 },
            { label: "Fennel Row", occurrences: 5 },
            { label: "Granary Lane", occurrences: 5 },
            { label: "Ridgeway Depot", occurrences: 5 },
          ],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 3,
          fieldName: "Status",
          isNameGenerated: false,
          type: { kind: "enum" },
          sourceFormat: { kind: "enum" },
          enumOptions: [
            { label: "Complete", occurrences: 10 },
            { label: "In progress", occurrences: 10 },
            { label: "Scheduled", occurrences: 10 },
            { label: "Waiting", occurrences: 10 },
          ],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 4,
          fieldName: "Quoted amount",
          isNameGenerated: false,
          type: { kind: "currency", currencyCode: "USD" },
          sourceFormat: { kind: "decimal", currencySymbol: "$" },
          enumOptions: [],
          violations: {
            count: 1,
            examples: [{ rowIndex: 21, sourceText: "TBD" }],
          },
        },
        {
          columnIndex: 5,
          fieldName: "Follow up",
          isNameGenerated: false,
          type: { kind: "boolean" },
          sourceFormat: { kind: "boolean" },
          enumOptions: [],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 6,
          fieldName: "Contact phone",
          isNameGenerated: false,
          type: { kind: "phone" },
          sourceFormat: { kind: "text" },
          enumOptions: [],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 7,
          fieldName: "Contact email",
          isNameGenerated: false,
          type: { kind: "email" },
          sourceFormat: { kind: "text" },
          enumOptions: [],
          violations: { count: 0, examples: [] },
        },
        {
          columnIndex: 8,
          fieldName: "Site page",
          isNameGenerated: false,
          type: { kind: "url" },
          sourceFormat: { kind: "text" },
          enumOptions: [],
          violations: { count: 0, examples: [] },
        },
      ],
      diagnostics: [
        {
          code: "ragged-row",
          severity: "warning",
          firstRowIndex: 3,
          firstColumnIndex: null,
          occurrences: 1,
        },
      ],
    });
  });

  it("gives every statement its evidence, its edit, and a fingerprint", async () => {
    const proposal = await proposalOf(
      "field-log-messy.csv",
      "field-log-messy.csv",
    );

    expect(ids(proposal)).toEqual([
      ["app-name", "rename-app", "accepted"],
      ["table-name", "rename-table", "accepted"],
      ["header-row", "set-header-row", "accepted"],
      ["discarded-rows", "set-header-row", "accepted"],
      ["field-name:0", "rename-field", "accepted"],
      ["field-type:0", "override-type", "accepted"],
      ["field-name:1", "rename-field", "accepted"],
      ["field-type:1", "override-type", "accepted"],
      ["field-name:2", "rename-field", "accepted"],
      ["field-type:2", "override-type", "accepted"],
      ["enum-options:2", "edit-enum-options", "accepted"],
      ["field-name:3", "rename-field", "accepted"],
      ["field-type:3", "override-type", "accepted"],
      ["enum-options:3", "edit-enum-options", "accepted"],
      ["field-name:4", "rename-field", "accepted"],
      ["field-type:4", "override-type", "accepted"],
      ["field-name:5", "rename-field", "accepted"],
      ["field-type:5", "override-type", "accepted"],
      ["field-name:6", "rename-field", "accepted"],
      ["field-type:6", "override-type", "accepted"],
      ["field-name:7", "rename-field", "accepted"],
      ["field-type:7", "override-type", "accepted"],
      ["field-name:8", "rename-field", "accepted"],
      ["field-type:8", "override-type", "accepted"],
    ]);

    expect(statement(proposal, "discarded-rows").evidence).toEqual([
      { kind: "row-shape", rowIndex: 0, cellCount: 1, valueCount: 1 },
      { kind: "row-shape", rowIndex: 1, cellCount: 1, valueCount: 1 },
      { kind: "row-shape", rowIndex: 2, cellCount: 1, valueCount: 0 },
    ]);

    // Currency, with the one value that does not fit named beside it (FR-6).
    expect(statement(proposal, "field-type:4").evidence).toEqual([
      {
        kind: "value-pattern",
        pattern: "currency-amount",
        detail: "$",
        matched: 39,
        sampled: 40,
        examples: ["$1,250.00", "$430.50", "$2,900.00"],
      },
      {
        kind: "value-conflict",
        count: 1,
        examples: [{ rowIndex: 21, sourceText: "TBD" }],
      },
    ]);

    expect(statement(proposal, "field-type:1").evidence).toEqual([
      {
        kind: "value-pattern",
        pattern: "iso-date",
        detail: null,
        matched: 40,
        sampled: 40,
        examples: ["2026-03-02", "2026-03-03", "2026-03-04"],
      },
    ]);
    expect(statement(proposal, "field-type:5").evidence).toEqual([
      {
        kind: "value-pattern",
        pattern: "boolean-word",
        detail: null,
        matched: 40,
        sampled: 40,
        examples: ["yes", "no", "yes"],
      },
    ]);
    expect(statement(proposal, "field-type:6").evidence[0]).toMatchObject({
      pattern: "telephone-number",
      matched: 40,
    });
    expect(statement(proposal, "field-type:7").evidence[0]).toMatchObject({
      pattern: "email-address",
      matched: 40,
    });
    expect(statement(proposal, "field-type:8").evidence[0]).toMatchObject({
      pattern: "web-url",
      matched: 40,
    });

    for (const entry of proposal.statements) {
      expect(entry.evidenceFingerprint.length, entry.statementId).toBeGreaterThan(
        0,
      );
      expect(JSON.parse(entry.evidenceFingerprint)).toContain(
        "sheaf.inference.v1",
      );
    }
  });

  it("preserves the value that does not fit instead of coercing it", async () => {
    const proposal = await proposalOf(
      "field-log-messy.csv",
      "field-log-messy.csv",
    );
    const amount = typingOf(proposal, 4);

    expect(sourceTextToCellValue("$1,250.00", amount)).toEqual({
      kind: "value",
      value: { kind: "decimal", decimal: "1250.00" },
    });
    expect(sourceTextToCellValue("TBD", amount)).toEqual({
      kind: "value",
      value: { kind: "invalid-preserved", sourceText: "TBD" },
    });
    // Not zero, not blank, not missing — the three things it must never become.
    expect(sourceTextToCellValue("TBD", amount)).not.toEqual({
      kind: "value",
      value: { kind: "decimal", decimal: "0" },
    });

    const status = typingOf(proposal, 3);
    expect(sourceTextToCellValue("Waiting", status)).toEqual({
      kind: "enum-option",
      label: "Waiting",
    });
    expect(sourceTextToCellValue("Unknown", status)).toEqual({
      kind: "value",
      value: { kind: "invalid-preserved", sourceText: "Unknown" },
    });
  });

  it("counts exactly the values conversion refuses", async () => {
    const proposal = await proposalOf(
      "field-log-messy.csv",
      "field-log-messy.csv",
    );
    const { rows } = await parseFixture(
      "delimited/field-log-messy.csv",
      "field-log-messy.csv",
    );
    const dataRows = rows.slice((proposal.headerRowIndex ?? -1) + 1);

    for (const field of proposal.table.fields) {
      const typing = typingOf(proposal, field.columnIndex);
      const refused = dataRows.filter((row) => {
        const text = row[field.columnIndex] ?? "";
        if (text === "") {
          return false;
        }
        const cell = sourceTextToCellValue(text, typing);
        return (
          cell.kind === "value" && cell.value.kind === "invalid-preserved"
        );
      }).length;

      expect([field.fieldName, refused]).toEqual([
        field.fieldName,
        field.violations?.count ?? refused,
      ]);
    }
  });
});

describe("inference over the rest of the corpus", () => {
  it("generates column names and says why when there is no header", async () => {
    const proposal = await proposalOf(
      "headerless-readings.csv",
      "headerless-readings.csv",
    );

    expect(proposal.headerRowIndex).toBeNull();
    expect(
      proposal.table.fields.map((field) => [
        field.fieldName,
        field.isNameGenerated,
      ]),
    ).toEqual([
      ["Column 1", true],
      ["Column 2", true],
      ["Column 3", true],
    ]);
    expect(proposal.rowCount).toBe(6);
    expect(proposal.discardedRowCount).toBe(0);
    // The statement says the first row already holds values, which is why no
    // heading was found — evidence, not an apology.
    expect(statement(proposal, "header-row").evidence).toEqual([
      { kind: "row-shape", rowIndex: 0, cellCount: 3, valueCount: 3 },
    ]);
  });

  it("widens the table to the widest row so no ragged cell is dropped", async () => {
    const proposal = await proposalOf("ragged-rows.csv", "ragged-rows.csv");

    expect(proposal.table.fields.map((field) => field.fieldName)).toEqual([
      "Site",
      "Crew",
      "Hours",
      "Signed off",
      "Column 5",
      "Column 6",
    ]);
    expect(proposal.rowCount).toBe(4);
  });

  it("proposes nothing at all for an empty file rather than an empty app", async () => {
    const proposal = await proposalOf("empty.csv", "empty.csv");

    expect(proposal.table.fields).toEqual([]);
    expect(proposal.rowCount).toBe(0);
    expect(proposal.headerRowIndex).toBeNull();
  });

  it("never proposes a reference type — F02 has no producer for one (D25)", async () => {
    for (const name of [
      "field-log-messy.csv",
      "quoted-notes.csv",
      "crew-roster.tsv",
      "site-visits-utf16.csv",
      "suppliers-latin1.csv",
      "nfd-crew.csv",
      "headerless-readings.csv",
      "single-column.csv",
      "ragged-rows.csv",
      "cr-only-legacy.csv",
      "large-sample.csv",
    ]) {
      const proposal = await proposalOf(name, name);
      for (const field of proposal.table.fields) {
        expect([name, field.type.kind]).not.toEqual([name, "reference"]);
      }
    }
  });

  it("refuses to propose from a stream that never finished", async () => {
    const { items } = await parseFixture(
      "delimited/field-log-messy.csv",
      "field-log-messy.csv",
    );
    const withoutSummary = items.filter((item) => item.kind === "batch");

    expect(() =>
      inferProposal(withoutSummary, { fileName: "field-log-messy.csv" }),
    ).toThrow(/completed fact stream/);
  });
});

describe("evidence fingerprints", () => {
  it("survive the same file growing, so a recorded decision keeps standing", async () => {
    const short = generateLargeDelimited(40);
    const grown = generateLargeDelimited(400);

    const before = inferProposal((await parseText(short)).items, {
      fileName: "field-history.csv",
    });
    const after = inferProposal((await parseText(grown)).items, {
      fileName: "field-history.csv",
    });

    expect(after.rowCount).toBeGreaterThan(before.rowCount);
    expect(
      after.statements.map((entry) => entry.evidenceFingerprint),
    ).toEqual(before.statements.map((entry) => entry.evidenceFingerprint));
  });

  it("differ when the decision itself differs", async () => {
    const proposal = await proposalOf(
      "field-log-messy.csv",
      "field-log-messy.csv",
    );
    const prints = new Set(
      proposal.statements.map((entry) => entry.evidenceFingerprint),
    );

    expect(prints.size).toBe(proposal.statements.length);
    expect(statement(proposal, "field-type:1").evidenceFingerprint).not.toBe(
      statement(proposal, "field-type:5").evidenceFingerprint,
    );
  });
});
