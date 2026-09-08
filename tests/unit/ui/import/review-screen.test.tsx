import { describe, expect, it, vi } from "vitest";
import type {
  ImportReviewVm,
  ReviewFieldVm,
  ReviewStatementVm,
} from "../../../../src/application/view-models/import.js";
import { ROUTE_HREFS } from "../../../../src/routes/guards.js";
import {
  ReviewScreen,
  describeNeedsAttention,
  describeStatement,
} from "../../../../src/ui/import/review-screen.js";
import type { ReviewEditIntentV1 } from "../../../../src/ui/import/review-edit-dialog.js";
import "../../../../src/ui/theme/base.css";
import {
  TARGET_MIN,
  interact,
  query,
  queryAll,
  render,
  typeInto,
} from "../render.js";

/**
 * SCR-023 as rendered (CAP-12, CA-16, FR-4/FR-6/FR-8).
 *
 * The fixture mirrors S03's pinned demo proposal — an enum column, a currency
 * column with a preserved violation, a generated field name, discarded rows
 * above the header — because those are the shapes the surface has to be
 * truthful about.
 */

const nav = ROUTE_HREFS;
const noop = (): void => undefined;

function statement(
  overrides: Partial<ReviewStatementVm> = {},
): ReviewStatementVm {
  return {
    statementId: "s-1",
    subject: "field-type",
    editKind: "override-type",
    columnIndex: 0,
    evidence: [
      {
        kind: "distinct-values",
        distinct: 3,
        sampled: 40,
        options: ["North", "South", "East"],
      },
    ],
    disposition: "accepted",
    ...overrides,
  };
}

function siteField(overrides: Partial<ReviewFieldVm> = {}): ReviewFieldVm {
  return {
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
    violations: { kind: "measured", value: { count: 0, examples: [] } },
    statements: [statement()],
    ...overrides,
  };
}

const amountField: ReviewFieldVm = {
  columnIndex: 1,
  fieldName: "Quoted amount",
  isNameGenerated: false,
  type: { kind: "currency", currencyCode: "USD" },
  sourceFormat: { kind: "decimal", currencySymbol: "$" },
  enumOptions: [],
  violations: {
    kind: "measured",
    value: { count: 1, examples: [{ rowIndex: 20, sourceText: "TBD" }] },
  },
  statements: [
    statement({
      statementId: "s-2",
      columnIndex: 1,
      evidence: [
        {
          kind: "value-conflict",
          count: 1,
          examples: [{ rowIndex: 20, sourceText: "TBD" }],
        },
      ],
    }),
  ],
};

function reviewVm(overrides: Partial<ImportReviewVm> = {}): ImportReviewVm {
  return {
    screen: "SCR-023",
    step: "reviewing",
    fileName: "field-log-messy.csv",
    appName: "Field Log Messy",
    table: {
      tableName: "Field Log Messy",
      headerRowIndex: 2,
      rowCount: { kind: "exact", value: 40 },
      discardedRowCount: 2,
      discardedRows: [
        { rowIndex: 0, reason: "above-header", cells: ["Field log", ""] },
        { rowIndex: 1, reason: "above-header", cells: ["Sep 2025", ""] },
      ],
      leadingRows: [
        { rowIndex: 0, cells: ["Field log", ""] },
        { rowIndex: 1, cells: ["Sep 2025", ""] },
        { rowIndex: 2, cells: ["Site", "Quoted amount"] },
      ],
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
          evidence: [
            { kind: "row-shape", rowIndex: 0, cellCount: 9, valueCount: 1 },
          ],
        }),
      ],
    },
    fields: [siteField(), amountField],
    sections: [
      { id: "tables-and-rows", label: "Tables & rows", count: 1, emptiness: null },
      {
        id: "fields-and-choices",
        label: "Fields & choices",
        count: 2,
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
    ],
    diagnostics: [
      {
        code: "ragged-row",
        severity: "warning",
        firstRowIndex: 12,
        firstColumnIndex: null,
        occurrences: 1,
      },
    ],
    needsAttentionCount: 1,
    isNeedsAttentionExact: true,
    editRejection: null,
    promotionIssues: [],
    confirm: {
      appName: "Field Log Messy",
      canCreate: true,
      blocker: null,
      busy: false,
      assurance: "No inference stands until you confirm.",
    },
    announcement: "2 fields were found. 1 values need your attention.",
    ...overrides,
  };
}

/** Opens the Edit that belongs to one statement, not whichever comes first. */
async function openEdit(statementId: string): Promise<void> {
  await interact(() => {
    queryAll(`[data-statement="${statementId}"] button`)
      .find((button) => button.textContent === "Edit")
      ?.click();
  });
}

function screen(overrides: Partial<Parameters<typeof ReviewScreen>[0]> = {}) {
  return (
    <ReviewScreen
      nav={nav}
      onApplyEdit={noop}
      onCancel={noop}
      onCreateApp={noop}
      vm={reviewVm()}
      {...overrides}
    />
  );
}

describe("SCR-023 — one route, anchored sections, nothing auto-accepted", () => {
  it("renders every section and says which kind of empty each one is", async () => {
    await render(screen());
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
    await render(screen({ onCreateApp }));

    expect(document.body.textContent).toContain(
      "No inference stands until you confirm.",
    );
    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Create Field Log Messy")
        ?.click();
    });
    expect(onCreateApp).toHaveBeenCalledTimes(1);
  });

  it("disables the accept with the empty-file reason, not with silence", async () => {
    await render(
      screen({
        vm: reviewVm({
          fields: [],
          confirm: {
            appName: "Empty",
            canCreate: false,
            blocker: "no-fields-found",
            busy: false,
            assurance: "No inference stands until you confirm.",
          },
          sections: reviewVm().sections.map((section) =>
            section.id === "fields-and-choices"
              ? { ...section, count: 0, emptiness: "none-found" }
              : section,
          ),
        }),
      }),
    );
    const create = queryAll("button").find((button) =>
      button.textContent?.startsWith("Create "),
    );
    expect(create?.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toContain(
      "Sheaf found no columns in this file, so there is nothing to create an app from.",
    );
  });
});

describe("SCR-023 — a nulled measurement is not a measurement of zero", () => {
  it("says 'Not measured yet' after a header-row edit, never 'none'", async () => {
    await render(
      screen({
        vm: reviewVm({
          fields: [
            siteField({ violations: { kind: "not-measured-yet" } }),
            amountField,
          ],
          isNeedsAttentionExact: false,
        }),
      }),
    );

    const cell = queryAll('[data-violations]').find(
      (node) => node.getAttribute("data-violations") === "not-measured-yet",
    );
    expect(cell?.textContent).toBe("Not measured yet");
    expect(cell?.textContent).not.toBe("0");
  });

  it("says the needs-attention total is no longer the whole story", () => {
    expect(
      describeNeedsAttention(reviewVm({ isNeedsAttentionExact: true })),
    ).toBe("1 original value does not match its field.");
    expect(
      describeNeedsAttention(reviewVm({ isNeedsAttentionExact: false })),
    ).toContain("some fields have not been measured since you moved the header row");
    expect(
      describeNeedsAttention(
        reviewVm({ needsAttentionCount: 0, isNeedsAttentionExact: true }),
      ),
    ).toBe("Nothing needs your attention.");
  });
});

describe("SCR-023 — every statement carries its evidence (SHT-013)", () => {
  it("shows a tag beside each statement and the detail behind it", async () => {
    await render(screen());

    expect(document.body.textContent).toContain("Repeated values");
    expect(document.body.textContent).toContain("Values that do not match");

    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Why?")
        ?.click();
    });

    const sheet = query('[role="dialog"]');
    expect(sheet.textContent).toContain("Why Sheaf thinks so");
    expect(sheet.textContent).toContain("Row 3 reads “Site”.");
  });

  it("composes each statement from its subject and the real facts", () => {
    const vm = reviewVm();
    const table = vm.table;
    if (table === null) throw new Error("expected a table");

    expect(describeStatement(table.statements[0] as ReviewStatementVm, vm)).toBe(
      "“Field Log Messy” starts on row 3.",
    );
    expect(describeStatement(table.statements[1] as ReviewStatementVm, vm)).toBe(
      "2 rows will not become records. They are kept and stay readable.",
    );
    expect(
      describeStatement(
        statement({ subject: "field-type", columnIndex: 1 }),
        vm,
      ),
    ).toBe("“Quoted amount” looks like currency in USD.");
  });

  it("prints a rejection as a stored choice, not as a dismissal", async () => {
    await render(
      screen({
        vm: reviewVm({
          fields: [
            siteField({
              statements: [statement({ disposition: "rejected" })],
            }),
            amountField,
          ],
        }),
      }),
    );
    expect(document.body.textContent).toContain("You rejected this");
  });
});

describe("SCR-023 — edits are controlled and go through the machine", () => {
  it("renames a field and emits exactly that edit", async () => {
    const onApplyEdit = vi.fn<(edit: ReviewEditIntentV1) => void>();
    await render(
      screen({
        onApplyEdit,
        vm: reviewVm({
          fields: [
            siteField({
              statements: [
                statement({ subject: "field-name", editKind: "rename-field" }),
              ],
            }),
            amountField,
          ],
        }),
      }),
    );

    await openEdit("s-1");
    await typeInto(query<HTMLInputElement>("input"), "Location");
    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent === "Save change")
        ?.click();
    });

    expect(onApplyEdit).toHaveBeenCalledWith({
      kind: "rename-field",
      columnIndex: 0,
      fieldName: "Location",
    });
  });

  it("offers currency only where a currency code already exists", async () => {
    await render(screen());

    // `Site` is an enum: there is no currency code to make one up from.
    await openEdit("s-1");
    await interact(() => {
      queryAll("button")
        .find((button) => button.textContent?.includes("A choice from a list"))
        ?.click();
    });
    const enumOptions = queryAll('[role="option"]').map(
      (option) => option.textContent,
    );
    expect(enumOptions).toContain("Text");
    expect(enumOptions).not.toContain("Currency");
  });

  it("keeps currency available for a field that already has a code", async () => {
    await render(screen());

    // `Quoted amount` is currency in USD, so changing back to it is truthful.
    await openEdit("s-2");
    await interact(() => {
      queryAll('[role="dialog"] button')
        .find((button) => button.textContent?.includes("Currency"))
        ?.click();
    });
    expect(
      queryAll('[role="option"]').map((option) => option.textContent),
    ).toContain("Currency");
  });

  it("renders the closed rejection reason when the stage refuses an edit", async () => {
    await render(
      screen({ vm: reviewVm({ editRejection: "duplicate-name" }) }),
    );
    expect(document.body.textContent).toContain("That change was not made.");
    expect(document.body.textContent).toContain(
      "Another field already has that name.",
    );
  });

  it("holds the edit affordances while the stage is applying one", async () => {
    await render(screen({ vm: reviewVm({ step: "applyingEdit" }) }));
    const edits = queryAll("button").filter(
      (button) => button.textContent === "Edit",
    );
    expect(edits.length).toBeGreaterThan(0);
    for (const edit of edits) {
      expect(edit.hasAttribute("disabled")).toBe(true);
    }
    expect(document.body.textContent).toContain(
      "Sheaf is applying your last change.",
    );
  });
});

describe("SCR-023 — a refused promotion comes back here", () => {
  it("says the app was not created and that nothing was written", async () => {
    await render(
      screen({
        vm: reviewVm({
          promotionIssues: [
            {
              fieldId: null,
              kind: "wrong-type",
              severity: "blocking",
              messageKey: "value.wrong-type",
              messageParameters: {},
            },
          ],
        }),
      }),
    );
    expect(document.body.textContent).toContain("The app was not created.");
    expect(document.body.textContent).toContain(
      "Nothing was written, and this review is unchanged.",
    );
  });

  it("shows the create as busy while the promotion runs (CTL-022/088)", async () => {
    await render(
      screen({
        vm: reviewVm({
          step: "promoting",
          confirm: {
            appName: "Field Log Messy",
            canCreate: false,
            blocker: null,
            busy: true,
            assurance: "No inference stands until you confirm.",
          },
        }),
      }),
    );
    expect(queryAll('[role="progressbar"]').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain(
      "Creating Field Log Messy on this device.",
    );
  });
});

describe("SCR-023 — the discarded rows stay readable, and the reading is stated", () => {
  it("lists the rows that will not become records", async () => {
    await render(screen());
    expect(document.body.textContent).toContain(
      "View the 2 rows that will not become records",
    );
    expect(document.body.textContent).toContain("Field log");
  });

  it("names what the parser noticed, including a ragged row", async () => {
    await render(screen());
    expect(document.body.textContent).toContain(
      "Some rows have more or fewer cells than the rest.",
    );
    expect(document.body.textContent).toContain("First seen at row 13.");
  });

  it("gives every action the minimum hit area", async () => {
    await render(screen());
    const buttons = queryAll("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(getComputedStyle(button).minHeight).toBe(TARGET_MIN);
    }
  });
});
