import { describe, expect, it, vi } from "vitest";
import {
  selectRecordsListVm,
  type FilterableFieldVm,
  type RecordsFilterV1,
  type RecordsListVm,
} from "../../../../src/application/view-models/records.js";
import { RecordsScreen } from "../../../../src/ui/records/records-screen.js";
import { FilterSheet } from "../../../../src/ui/records/filter-sheets.js";
import { SortSheet } from "../../../../src/ui/records/sort-sheet.js";
import type { AppIdentity, AppNavigation } from "../../../../src/ui/records/app-frame.js";
import type { FieldTypeVm } from "../../../../src/ui/records/values.js";
import "../../../../src/ui/theme/base.css";
import { accessibleName, interact, query, queryAll, render, typeInto } from "../render.js";
import { APP_ID, FIELD_IDS, OPTION_IDS, TABLE_ID, page, session, summary, table } from "./fixtures.js";

/**
 * FR-13 as rendered (S04 CP3; CA-29; SHT-004–009; STA-014; STA-026): the
 * chip row inside the sticky tools, each typed sheet answering exactly one
 * filter, the sort sheet, the partial banner, and the filtered no-result
 * state kept apart from an empty table.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  tables: [{ tableId: TABLE_ID, displayName: "Visits", href: `#/app/${APP_ID}/t/${TABLE_ID}` }],
};

const identity: AppIdentity = { appId: APP_ID, displayName: "Field Log", theme: session().theme };
const fieldTypes: ReadonlyMap<string, FieldTypeVm> = new Map(table().fields.map((field) => [field.fieldId, field.type]));

const SITE_FILTER: RecordsFilterV1 = { fieldId: FIELD_IDS.site, operand: { kind: "enum-in", optionIds: [OPTION_IDS.alder] } };
const AMOUNT_FILTER: RecordsFilterV1 = { fieldId: FIELD_IDS.amount, operand: { kind: "number-range", min: "1000", max: null } };

function listVm(overrides: Parameters<typeof page>[0] = {}, filters: readonly RecordsFilterV1[] = [SITE_FILTER]): RecordsListVm {
  return selectRecordsListVm(table(), page(overrides), undefined, { filters, sort: null });
}

async function renderList(
  vm: RecordsListVm,
  handlers: {
    readonly onOpenFilter?: (fieldId: string) => void;
    readonly onClearFilter?: (filter: RecordsFilterV1) => void;
    readonly onClearAllFilters?: () => void;
    readonly onOpenSort?: () => void;
  } = {},
): Promise<void> {
  await render(
    <RecordsScreen
      app={identity}
      fieldTypes={fieldTypes}
      nav={nav}
      newRecordHref="#new"
      onClearAllFilters={handlers.onClearAllFilters ?? vi.fn()}
      onClearFilter={(chip) => {
        handlers.onClearFilter?.(chip.filter);
      }}
      onOpenFilter={handlers.onOpenFilter ?? vi.fn()}
      onOpenSort={handlers.onOpenSort ?? vi.fn()}
      onSearch={vi.fn()}
      recordHref={(recordId) => `#r/${recordId}`}
      vm={vm}
    />,
  );
}

const buttonNamed = (name: string): HTMLButtonElement => {
  const found = queryAll<HTMLButtonElement>("button").find((button) => accessibleName(button) === name);
  if (found === undefined) throw new Error(`No button named ${name}`);
  return found;
};

describe("the chip row (records.html; STA-026)", () => {
  it("shows Sort, each applied filter by what it says, and every filterable column", async () => {
    const onOpenFilter = vi.fn();
    const onClearFilter = vi.fn();
    const onOpenSort = vi.fn();
    await renderList(listVm({ records: [summary()], totalCount: 40, total: 12 }, [SITE_FILTER, AMOUNT_FILTER]), {
      onOpenFilter,
      onClearFilter,
      onOpenSort,
    });

    const row = query("[aria-label='Sort and filters']");
    // Inside the sticky tools, so it stays while records scroll.
    expect(row.closest("[role='search']")).not.toBeNull();
    const chips = [...row.querySelectorAll("li")].map((chip) => chip.textContent);
    expect(chips).toEqual([
      "Sort ↕",
      "Visit date",
      "Site: Alder Court×",
      expect.stringMatching(/^Quoted amount: at least \$1,000\.00×$/u),
      "Follow up",
    ]);

    await interact(() => {
      buttonNamed("Clear filter Site: Alder Court").click();
    });
    expect(onClearFilter).toHaveBeenCalledWith(SITE_FILTER);
    await interact(() => {
      buttonNamed("Visit date").click();
    });
    expect(onOpenFilter).toHaveBeenCalledWith(FIELD_IDS.visitDate);
    await interact(() => {
      buttonNamed("Sort ↕").click();
    });
    expect(onOpenSort).toHaveBeenCalled();

    // The exact count of matches, beside the table's.
    expect(query("[data-match-count]").textContent).toBe("12 records match.");
    expect(document.body.textContent).toContain("This table holds 40 records.");
  });

  it("clears every filter at once", async () => {
    const onClearAllFilters = vi.fn();
    await renderList(listVm({ records: [summary()], totalCount: 40, total: 3 }), { onClearAllFilters });
    await interact(() => {
      buttonNamed("Clear all filters").click();
    });
    expect(onClearAllFilters).toHaveBeenCalledOnce();
  });

  it("names a partial page's exact scope and its remedy (STA-014)", async () => {
    await renderList(
      listVm({
        records: [summary()],
        totalCount: 60_000,
        total: null,
        partial: { scanned: 50_000, tableTotal: 60_000, cause: "query-budget", remedy: "narrow-filters" },
      }),
    );
    const banner = query("[data-state='STA-014']");
    expect(banner.textContent).toContain("Searched the first 50,000 of 60,000 rows");
    expect(banner.textContent).toContain("add a filter to search every row");
    // A partial page counts nothing it did not look at.
    expect(queryAll("[data-match-count]")).toHaveLength(0);
  });
});

describe("the two empties stay apart (SCR-026)", () => {
  it("keeps a filtered no-result state with its chips, each clearable, and the table's count", async () => {
    const onClearFilter = vi.fn();
    await renderList(listVm({ records: [], totalCount: 12_482, total: 0 }, [SITE_FILTER, AMOUNT_FILTER]), { onClearFilter });
    const empty = query("[data-empty='no-results']");
    expect(empty.dataset["state"]).toBe("STA-026");
    expect(empty.querySelector("h2")?.textContent).toBe("No record matches these filters.");
    expect(empty.textContent).toContain("The table contains 12,482 records. 2 active filters exclude all of them.");
    const clears = [...empty.querySelectorAll("button")].map((button) => accessibleName(button));
    expect(clears).toContain("Clear filter Site: Alder Court");
    expect(clears).toContain("Clear all filters");
  });

  it("offers the first record, not a filter to clear, for an empty table", async () => {
    await renderList(listVm({ records: [], totalCount: 0, total: 0 }));
    expect(query("[data-empty='empty-table']").textContent).toContain("contains zero records");
    expect(queryAll("[data-empty='no-results']")).toHaveLength(0);
  });
});

function filterable(fieldId: string): FilterableFieldVm {
  const found = listVm({}, []).filterableFields.find((field) => field.fieldId === fieldId);
  if (found === undefined) throw new Error(`${fieldId} is not filterable`);
  return found;
}

async function openSheet(
  fieldId: string,
  current: RecordsFilterV1 | null = null,
  extra: Partial<Parameters<typeof FilterSheet>[0]> = {},
): Promise<ReturnType<typeof vi.fn>> {
  const onApply = vi.fn();
  await render(<FilterSheet current={current} field={filterable(fieldId)} onApply={onApply} onClose={vi.fn()} {...extra} />);
  return onApply;
}

const inputLabelled = (label: string): HTMLInputElement => {
  const found = queryAll<HTMLLabelElement>("label").find((candidate) => candidate.textContent === label);
  const id = found?.htmlFor ?? "";
  return query<HTMLInputElement>(`[id='${id}']`);
};

describe("the typed filter sheets (SHT-004–008)", () => {
  it("SHT-004: selects several choices, retired ones included, and applies them in the field's order", async () => {
    const onApply = await openSheet(FIELD_IDS.site);
    expect(query("[data-sheet='SHT-004']").textContent).toContain("No longer offered");
    const boxes = queryAll<HTMLInputElement>("[data-sheet='SHT-004'] input[type='checkbox']");
    // Nothing chosen: Apply is disabled, and says why in text.
    expect(buttonNamed("Apply filter").disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose at least one Site choice.");
    await interact(() => {
      boxes[2]?.click();
    });
    await interact(() => {
      boxes[0]?.click();
    });
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenCalledWith(
      { fieldId: FIELD_IDS.site, operand: { kind: "enum-in", optionIds: [OPTION_IDS.ridgeway, OPTION_IDS.retired] } },
      undefined,
    );
  });

  it("SHT-004: Clear removes the column's filter", async () => {
    const onApply = await openSheet(FIELD_IDS.site, SITE_FILTER);
    await interact(() => {
      buttonNamed("Clear filter").click();
    });
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("SHT-005: an open-ended range applies; an inverted one says why and applies nothing", async () => {
    const onApply = await openSheet(FIELD_IDS.visitDate);
    await typeInto(inputLabelled("Start date"), "2026-03-10");
    await typeInto(inputLabelled("End date"), "2026-03-01");
    expect(document.body.textContent).toContain("The start date is after the end date.");
    expect(inputLabelled("Start date").getAttribute("aria-invalid")).toBe("true");

    await typeInto(inputLabelled("End date"), "");
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenCalledWith(
      { fieldId: FIELD_IDS.visitDate, operand: { kind: "date-range", from: 20_522, to: null } },
      undefined,
    );
  });

  it("SHT-006: refuses text and an inverted range in words, then applies decimal bounds as typed", async () => {
    const onApply = await openSheet(FIELD_IDS.amount);
    expect(document.body.textContent).toContain("Amount in USD.");
    await typeInto(inputLabelled("Minimum"), "TBD");
    expect(document.body.textContent).toContain("Enter each amount as digits");
    await typeInto(inputLabelled("Minimum"), "2000");
    await typeInto(inputLabelled("Maximum"), "1999.99");
    expect(document.body.textContent).toContain("The minimum is above the maximum.");
    await typeInto(inputLabelled("Maximum"), "2000.50");
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenCalledWith(
      { fieldId: FIELD_IDS.amount, operand: { kind: "number-range", min: "2000", max: "2000.50" } },
      undefined,
    );
  });

  it("SHT-007: Either clears, Yes and No filter", async () => {
    const onApply = await openSheet(FIELD_IDS.followUp);
    expect(queryAll("[data-sheet='SHT-007'] button").map((button) => button.textContent)).toEqual(["Either", "Yes", "No"]);
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenLastCalledWith(null);
    await interact(() => {
      buttonNamed("No").click();
    });
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenLastCalledWith({ fieldId: FIELD_IDS.followUp, operand: { kind: "boolean-is", value: false } });
  });
});

describe("the reference sheet (SHT-008)", () => {
  const referenceTable = table({
    fields: [...table().fields, { fieldId: "field-customer", displayName: "Customer", fieldOrdinal: 9, type: { kind: "reference" }, isRequired: false, isActive: true, enumOptions: [] }],
  });
  const customer = selectRecordsListVm(referenceTable, page(), undefined, { filters: [], sort: null }).filterableFields.find(
    (field) => field.fieldId === "field-customer",
  ) as FilterableFieldVm;
  const search = vi.fn(() =>
    Promise.resolve({
      fieldName: "Customer",
      query: "",
      candidates: [
        { recordId: "r-c1", label: "Priya Ellis", isCurrent: false },
        { recordId: "r-c2", label: "Devon Moss", isCurrent: false },
      ],
      emptiness: null,
    } as never),
  );

  it("selects related records by label and applies them with their labels", async () => {
    const onApply = vi.fn();
    await render(<FilterSheet current={null} field={customer} onApply={onApply} onClose={vi.fn()} referenceSearch={search} />);
    await interact(() => {
      buttonNamed("Devon Moss").click();
    });
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenCalledWith(
      { fieldId: "field-customer", operand: { kind: "reference-in", recordIds: ["r-c2"] } },
      new Map([["r-c2", "Devon Moss"]]),
    );
  });

  it("offers the broken item: records whose reference points at nothing", async () => {
    const onApply = vi.fn();
    await render(<FilterSheet current={null} field={customer} onApply={onApply} onClose={vi.fn()} referenceSearch={search} />);
    await interact(() => {
      queryAll<HTMLButtonElement>("button").find((button) => button.textContent?.startsWith("Missing related record"))?.click();
    });
    await interact(() => {
      buttonNamed("Apply filter").click();
    });
    expect(onApply).toHaveBeenCalledWith({ fieldId: "field-customer", operand: { kind: "reference-broken" } }, undefined);
  });
});

describe("the sort sheet (SHT-009)", () => {
  it("lists every column, takes a direction, and says missing values sort last", async () => {
    const onApply = vi.fn();
    const vm = listVm({}, []);
    await render(<SortSheet onApply={onApply} onClose={vi.fn()} vm={vm} />);
    const columns = queryAll("[aria-label='Columns'] button").map((button) => button.textContent);
    expect(columns).toEqual(table().fields.map((field) => field.displayName));
    expect(document.body.textContent).toContain("Records with no value sort last in either direction.");

    await interact(() => {
      buttonNamed("Descending").click();
    });
    await interact(() => {
      buttonNamed("Visit date").click();
    });
    await interact(() => {
      buttonNamed("Apply sort").click();
    });
    expect(onApply).toHaveBeenCalledWith({ fieldId: FIELD_IDS.visitDate, direction: "desc" });
  });
});
