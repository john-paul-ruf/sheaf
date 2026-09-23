import { describe, expect, it, vi } from "vitest";
import {
  selectRecordDetailVm,
  selectRecordFormVm,
  selectRecordsListVm,
  selectReferencePickerVm,
  selectTableSwitcherVm,
  type ReferencePickerVm,
} from "../../../../src/application/view-models/records.js";
import type {
  AppFieldViewV1,
  AppTableViewV1,
  RecordDetailViewV1,
  RecordReferenceViewV1,
  RelatedRecordsViewV1,
} from "../../../../src/workers/protocol/messages.js";
import type { AppIdentity, AppNavigation } from "../../../../src/ui/records/app-frame.js";
import { RecordDetailScreen } from "../../../../src/ui/records/record-detail-screen.js";
import {
  RecordFormScreen,
  type AuthoredEntryIntentV1,
} from "../../../../src/ui/records/record-form-screen.js";
import { RecordsScreen } from "../../../../src/ui/records/records-screen.js";
import { ReferencePickerSheet } from "../../../../src/ui/records/reference-picker-sheet.js";
import { RepairReferenceDialog } from "../../../../src/ui/records/repair-reference-dialog.js";
import { TableSwitcherSheet } from "../../../../src/ui/records/table-switcher-sheet.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render, settle, typeInto } from "../render.js";
import { session } from "./fixtures.js";

/**
 * CAP-24's surface states, rendered (SCR-027/028/029, SHT-002, SHT-003,
 * MOD-011, STA-011): a resolved reference reads as its parent's label and
 * opens it; a broken one says "Missing related record" with its original key
 * behind a disclosure; repairing authors the chosen id; leaving it flagged
 * writes nothing; the picker's empties stay distinct.
 *
 * The shapes are the demo workbook's (`fieldwork-q3.xlsx`): Jobs holds a
 * Customer ID reference into Customers, and J-1016's key `C-013` matched no
 * customer at import.
 */

const APP_ID = "app-q3";

function field(fieldId: string, displayName: string, fieldOrdinal: number, type: AppFieldViewV1["type"]): AppFieldViewV1 {
  return { fieldId, displayName, fieldOrdinal, type, isRequired: false, isActive: true, enumOptions: [] };
}

const JOBS: AppTableViewV1 = {
  tableId: "t-jobs",
  displayName: "Jobs",
  tableOrdinal: 0,
  recordCount: 60,
  isRecordCountExact: true,
  fields: [
    field("f-job", "Job ID", 0, { kind: "text" }),
    field("f-customer", "Customer ID", 1, { kind: "reference" }),
    field("f-status", "Status", 2, { kind: "text" }),
  ],
};

const CUSTOMERS: AppTableViewV1 = {
  tableId: "t-customers",
  displayName: "Customers",
  tableOrdinal: 1,
  recordCount: 12,
  isRecordCountExact: true,
  fields: [field("f-cid", "Customer ID", 0, { kind: "text" }), field("f-name", "Name", 1, { kind: "text" })],
};

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  tables: [JOBS, CUSTOMERS].map((table) => ({
    tableId: table.tableId,
    displayName: table.displayName,
    href: `#/app/${APP_ID}/t/${table.tableId}`,
  })),
};

const identity: AppIdentity = { appId: APP_ID, displayName: "Fieldwork Q3", theme: session().theme };

const recordHref = (tableId: string, recordId: string): string => `#/app/${APP_ID}/t/${tableId}/r/${recordId}`;

const RESOLVED: RecordReferenceViewV1 = {
  fieldId: "f-customer",
  relationshipId: "rel-customer",
  status: "resolved",
  recordId: "r-c8",
  tableId: "t-customers",
  label: "Harbor View Inn",
};

const BROKEN: RecordReferenceViewV1 = {
  fieldId: "f-customer",
  relationshipId: "rel-customer",
  status: "broken",
  originalKey: "C-013",
};

function job(recordId: string, key: string, customer: RecordDetailViewV1["values"][number]["value"], references: readonly RecordReferenceViewV1[]): RecordDetailViewV1 {
  return {
    recordId,
    tableId: "t-jobs",
    recordRevision: 1,
    cursor: 1,
    values: [
      { fieldId: "f-job", value: { kind: "text", text: key } },
      { fieldId: "f-customer", value: customer },
      { fieldId: "f-status", value: { kind: "text", text: "Scheduled" } },
    ],
    blockingIssueCount: 0,
    warningIssueCount: references.some((reference) => reference.status === "broken") ? 1 : 0,
    createdCommitId: "c-1",
    updatedCommitId: "c-1",
    issues: [],
    indexedFieldIds: [],
    references,
  };
}

function renderDetail(
  record: RecordDetailViewV1,
  related: RelatedRecordsViewV1,
  table = JOBS,
  handlers: { onRepair?: (fieldId: string) => void; onShowChildren?: (id: string) => void } = {},
): Promise<unknown> {
  return render(
    <RecordDetailScreen
      app={identity}
      editHref="#/edit"
      nav={nav}
      onOpenActions={vi.fn()}
      recordHref={recordHref}
      recordsHref="#/records"
      vm={selectRecordDetailVm(table, record, { related, tables: [JOBS, CUSTOMERS] })}
      {...handlers}
    />,
  );
}

describe("SCR-027 relationships", () => {
  it("resolved: the parent's label, its table, and the way to it", async () => {
    await renderDetail(job("r-j1", "J-1001", { kind: "reference", recordId: "r-c8" }, [RESOLVED]), {
      parents: [RESOLVED],
      children: [],
    });
    const card = query('[data-belongs-to="f-customer"]');
    expect(card.textContent).toContain("Belongs to");
    expect(card.textContent).toContain("Harbor View Inn");
    expect(card.textContent).toContain("Customers · Customer ID");
    expect(card.querySelector("a")?.getAttribute("href")).toBe(recordHref("t-customers", "r-c8"));
    // The field itself reads as the label, never as an id.
    expect(query('[data-field="f-customer"]').textContent).toContain("Harbor View Inn");
    expect(query('[data-field="f-customer"]').textContent).not.toContain("r-c8");
    expect(queryAll("[data-missing]")).toHaveLength(0);
  });

  it("has many: an exact count, the first children, and a way to page the rest", async () => {
    const onShowChildren = vi.fn();
    await renderDetail(
      {
        ...job("r-c8", "C-008", { kind: "text", text: "unused" }, []),
        tableId: "t-customers",
        values: [
          { fieldId: "f-cid", value: { kind: "text", text: "C-008" } },
          { fieldId: "f-name", value: { kind: "text", text: "Harbor View Inn" } },
        ],
      },
      {
        parents: [],
        children: [
          {
            relationshipId: "rel-customer",
            tableId: "t-jobs",
            tableName: "Jobs",
            count: 7,
            first: [
              { recordId: "r-j1", label: "J-1001" },
              { recordId: "r-j13", label: "J-1013" },
            ],
          },
        ],
      },
      CUSTOMERS,
      { onShowChildren },
    );
    const group = query('[data-has-many="rel-customer"]');
    expect(group.textContent).toContain("Has many");
    expect(group.textContent).toContain("7 in Jobs");
    expect([...group.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      recordHref("t-jobs", "r-j1"),
      recordHref("t-jobs", "r-j13"),
    ]);
    const showAll = [...group.querySelectorAll("button")].find((button) => button.textContent === "Show all 7 in Jobs");
    await interact(() => {
      showAll?.click();
    });
    expect(onShowChildren).toHaveBeenCalledWith("rel-customer");
  });

  it("broken: named, with the original key behind a disclosure, and a repair (STA-011)", async () => {
    const onRepair = vi.fn();
    await renderDetail(
      job("r-j16", "J-1016", { kind: "invalid", sourceText: "C-013" }, [BROKEN]),
      { parents: [BROKEN], children: [] },
      JOBS,
      { onRepair },
    );
    const missing = query('[data-missing="f-customer"]');
    expect(missing.textContent).toContain("Missing related record");
    expect(missing.textContent).toContain("Customer ID");
    const disclosure = missing.querySelector("details");
    expect(disclosure?.querySelector("summary")?.textContent).toBe("Show original key");
    expect(disclosure?.textContent).toContain("C-013");
    // The value never becomes blank: the field itself says what it is.
    expect(query('[data-field="f-customer"]').textContent).toContain(
      "Missing related record · original key C-013",
    );
    const repair = [...missing.querySelectorAll("button")].find((button) => button.textContent === "Repair reference");
    await interact(() => {
      repair?.click();
    });
    expect(onRepair).toHaveBeenCalledWith("f-customer");
  });
});

function pickerSearch(answers: Record<string, readonly { recordId: string; label: string }[] | null>) {
  return vi.fn(
    (queryText: string): Promise<ReferencePickerVm> =>
      Promise.resolve(
        selectReferencePickerVm({
          fieldName: "Customer ID",
          query: queryText,
          current: null,
          candidates: queryText in answers ? (answers[queryText] ?? null) : [],
        }),
      ),
  );
}

describe("MOD-011 repair", () => {
  const missing = {
    kind: "broken" as const,
    originalKey: "C-013",
    relationName: "Customer ID",
    fieldId: "f-customer",
    relationshipId: "rel-customer",
  };

  it("repaired: searches the related table and authors the chosen record", async () => {
    const onRepair = vi.fn();
    const search = pickerSearch({ "": [{ recordId: "r-c8", label: "Harbor View Inn" }] });
    await render(
      <RepairReferenceDialog busy={false} missing={missing} onLeaveFlagged={vi.fn()} onRepair={onRepair} search={search} />,
    );
    await settle();
    const dialog = query("[role='dialog']");
    expect(dialog.textContent).toContain("Repair broken reference");
    expect(dialog.textContent).toContain("Original key");
    expect(dialog.textContent).toContain("C-013");
    const option = [...dialog.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Harbor View Inn"));
    await interact(() => {
      option?.click();
    });
    const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Point it at “Harbor View Inn”");
    await interact(() => {
      confirm?.click();
    });
    expect(onRepair).toHaveBeenCalledWith({ recordId: "r-c8", label: "Harbor View Inn" });
  });

  it("left flagged: a real choice that writes nothing", async () => {
    const onRepair = vi.fn();
    const onLeaveFlagged = vi.fn();
    await render(
      <RepairReferenceDialog
        busy={false}
        missing={missing}
        onLeaveFlagged={onLeaveFlagged}
        onRepair={onRepair}
        search={pickerSearch({})}
      />,
    );
    await settle();
    const leave = queryAll("button").find((button) => button.textContent === "Leave flagged");
    await interact(() => {
      leave?.click();
    });
    expect(onLeaveFlagged).toHaveBeenCalledTimes(1);
    expect(onRepair).not.toHaveBeenCalled();
    // Nothing to repair with until a record is chosen.
    const repair = queryAll("button").find((button) => button.textContent === "Repair reference");
    expect(repair?.hasAttribute("disabled")).toBe(true);
  });
});

describe("SHT-002 the reference picker", () => {
  it("empty and no-results stay different sentences", async () => {
    const search = pickerSearch({ "": [], zzz: [] });
    await render(
      <ReferencePickerSheet
        currentRecordId={null}
        currentText={null}
        fieldName="Customer ID"
        isOpen
        onApply={vi.fn()}
        onClose={vi.fn()}
        search={search}
      />,
    );
    await settle();
    expect(query("[role='dialog']").textContent).toContain("There are no records to choose for Customer ID.");
    const input = query<HTMLInputElement>("[role='dialog'] input");
    await typeInto(input, "zzz");
    await settle();
    expect(query("[role='dialog']").textContent).toContain("No record matches “zzz”.");
    expect(search).toHaveBeenLastCalledWith("zzz");
  });

  it("a field that is not a relationship's source says so", async () => {
    await render(
      <ReferencePickerSheet
        currentRecordId={null}
        currentText={null}
        fieldName="Customer ID"
        isOpen
        onApply={vi.fn()}
        onClose={vi.fn()}
        search={pickerSearch({ "": null })}
      />,
    );
    await settle();
    expect(query("[role='dialog']").textContent).toContain(
      "Customer ID is not connected to another table, so there is nothing to choose.",
    );
  });
});

describe("SCR-028 a reference field", () => {
  it("opens SHT-002 and authors the chosen record id through the create command", async () => {
    const onSave = vi.fn<(entries: readonly AuthoredEntryIntentV1[]) => void>();
    await render(
      <RecordFormScreen
        app={identity}
        cancelHref="#/cancel"
        nav={nav}
        onSave={onSave}
        referenceSearch={() => pickerSearch({ "": [{ recordId: "r-c8", label: "Harbor View Inn" }] })}
        vm={selectRecordFormVm({ table: JOBS })}
      />,
    );
    const trigger = query('[data-control="reference-picker"]');
    expect(trigger.textContent).toBe("Choose a record");
    await interact(() => {
      trigger.click();
    });
    await settle();
    const option = queryAll("[role='dialog'] button").find((button) => button.textContent?.startsWith("Harbor View Inn"));
    await interact(() => {
      option?.click();
    });
    const apply = queryAll("[role='dialog'] button").find((button) => button.textContent === "Apply choice");
    await interact(() => {
      apply?.click();
    });
    await settle();
    expect(query('[data-control="reference-picker"]').textContent).toBe("Harbor View Inn");
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenCalledWith([
      { fieldId: "f-customer", value: { kind: "reference", recordId: "r-c8" } },
    ]);
  });

  it("renders an unknown-id refusal as the field's own error", async () => {
    await render(
      <RecordFormScreen
        app={identity}
        cancelHref="#/cancel"
        nav={nav}
        onSave={vi.fn()}
        referenceSearch={() => pickerSearch({})}
        vm={selectRecordFormVm({
          table: JOBS,
          issues: [
            {
              fieldId: "f-customer",
              kind: "reference",
              severity: "blocking",
              messageKey: "validation.broken-reference",
              messageParameters: {},
            },
          ],
        })}
      />,
    );
    const group = query('[data-field="f-customer"]');
    expect(group.querySelector('[data-control="reference-picker"]')?.getAttribute("data-invalid")).toBe("true");
    expect(group.textContent).toContain("The record this points at is not on this device.");
  });
});

describe("SCR-025 references and SHT-003", () => {
  it("a list card reads a reference as its label, and a broken one with its key", async () => {
    const vm = selectRecordsListVm(
      JOBS,
      {
        tableId: "t-jobs",
        scope: { kind: "table" },
        records: [job("r-j1", "J-1001", { kind: "reference", recordId: "r-c8" }, []), job("r-j16", "J-1016", { kind: "invalid", sourceText: "C-013" }, [])],
        hasMore: false,
        nextCursor: null,
        totalCount: 60,
        isTotalExact: true,
      },
      new Map([
        ["r-j1", [RESOLVED]],
        ["r-j16", [BROKEN]],
      ]),
    );
    const switcher = selectTableSwitcherVm([JOBS, CUSTOMERS], "t-jobs");
    const onOpen = vi.fn();
    await render(
      <RecordsScreen
        app={identity}
        nav={nav}
        newRecordHref="#/new"
        onOpenTableSwitcher={onOpen}
        onSearch={vi.fn()}
        recordHref={(recordId) => `#/r/${recordId}`}
        tableSwitcher={switcher}
        vm={vm}
      />,
    );
    const cards = queryAll("[data-record]").map((card) => card.textContent ?? "");
    expect(cards[0]).toContain("Harbor View Inn");
    expect(cards[1]).toContain("Missing related record · original key C-013");
    const trigger = queryAll("button").find((button) => button.textContent === "Jobs · 60 records · switch table");
    await interact(() => {
      trigger?.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("the switcher lists every table with its exact count and marks the current one", async () => {
    await render(
      <TableSwitcherSheet
        isOpen
        onClose={vi.fn()}
        tableHref={(tableId) => `#/app/${APP_ID}/t/${tableId}`}
        vm={selectTableSwitcherVm([JOBS, CUSTOMERS], "t-customers")}
      />,
    );
    const links = queryAll<HTMLAnchorElement>("[data-sheet='SHT-003'] a");
    expect(links.map((link) => link.textContent)).toEqual(["Jobs60 records", "Customers12 records · current"]);
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(links[0]?.getAttribute("href")).toBe(`#/app/${APP_ID}/t/t-jobs`);
  });
});
