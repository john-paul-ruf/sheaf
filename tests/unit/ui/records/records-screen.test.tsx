import { describe, expect, it, vi } from "vitest";
import { selectRecordsListVm } from "../../../../src/application/view-models/records.js";
import { RecordsScreen } from "../../../../src/ui/records/records-screen.js";
import type {
  AppIdentity,
  AppNavigation,
} from "../../../../src/ui/records/app-frame.js";
import type { FieldTypeVm } from "../../../../src/ui/records/values.js";
import "../../../../src/ui/theme/base.css";
import { cssRulesFor, query, queryAll, render, typeInto } from "../render.js";
import {
  APP_ID,
  FIELD_IDS,
  TABLE_ID,
  page,
  session,
  summary,
  table,
} from "./fixtures.js";

/**
 * SCR-025 and SCR-026 as rendered (CAP-15, CA-14, FR-13 search leg).
 *
 * Three claims the design and the agreement bind together: the search stays
 * visible while records scroll, the count on a search page is the *table's*,
 * and an empty table and a search that matched nothing never share a screen.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  tables: [
    {
      tableId: TABLE_ID,
      displayName: "Visits",
      href: `#/app/${APP_ID}/t/${TABLE_ID}`,
    },
  ],
};

const identity: AppIdentity = {
  appId: APP_ID,
  displayName: "Field Log",
  theme: session().theme,
};

const fieldTypes: ReadonlyMap<string, FieldTypeVm> = new Map(
  table().fields.map((field) => [field.fieldId, field.type]),
);

function renderList(
  vm = selectRecordsListVm(table(), page()),
  onSearch: (text: string) => void = vi.fn(),
  onShowMore?: () => void,
): Promise<unknown> {
  return render(
    <RecordsScreen
      app={identity}
      fieldTypes={fieldTypes}
      nav={nav}
      newRecordHref={`#/app/${APP_ID}/t/${TABLE_ID}/new`}
      onSearch={onSearch}
      recordHref={(recordId) =>
        `#/app/${APP_ID}/t/${TABLE_ID}/r/${recordId}`
      }
      vm={vm}
      {...(onShowMore === undefined ? {} : { onShowMore })}
    />,
  );
}

describe("SCR-025 — the records list", () => {
  it("leads each card with its label and at most three supporting facts", async () => {
    await renderList();

    const card = query("[data-record]");
    // The first renderable value leads; the next three support it.
    expect(card.querySelector("h2")?.textContent).toBe("1018");
    expect(card.querySelectorAll("dt")).toHaveLength(3);
    expect(card.textContent).toContain("Visit date");
    expect(card.textContent).toContain("Alder Court");
  });

  it("flags the preserved invalid value rather than hiding it", async () => {
    await renderList();

    const flag = query('[data-severity="warning"]');
    expect(flag.textContent).toBe("1 value needs attention");
  });

  it("keeps the search visible while the records scroll", async () => {
    await renderList();

    const tools = query("[role='search']");
    const rules = cssRulesFor(tools).join(" ");
    expect(rules).toContain("position: sticky");
  });

  it("states the table's count, never a match count (CA-14)", async () => {
    const searched = selectRecordsListVm(
      table(),
      page({ scope: { kind: "search", text: "alder" }, records: [summary()] }),
    );
    await renderList(searched);

    const screen = query('[data-screen="SCR-025"]');
    expect(screen.textContent).toContain("This table holds 40 records.");
    expect(screen.textContent).toContain(
      "Showing what matches “alder” on this device.",
    );
    // One match of a 40-record table is not "1 record"; nothing may say it is.
    expect(screen.textContent).not.toContain("1 result");
  });

  it("passes the typed term straight back out", async () => {
    const onSearch = vi.fn();
    await renderList(undefined, onSearch);

    await typeInto(query<HTMLInputElement>("input"), "alder");
    expect(onSearch).toHaveBeenCalledWith("alder");
  });

  it("offers more records only when the page says there are more", async () => {
    const showMore = vi.fn();
    await renderList(
      selectRecordsListVm(table(), page({ hasMore: true, nextCursor: 12 })),
      vi.fn(),
      showMore,
    );

    const button = queryAll("button").find(
      (candidate) => candidate.textContent === "Show more records",
    );
    expect(button).toBeTruthy();
    button?.click();
    expect(showMore).toHaveBeenCalledTimes(1);
  });

  it("renders an amount as its currency, from the field's own code", async () => {
    await renderList(
      selectRecordsListVm(
        table(),
        page({
          records: [
            summary({
              values: [
                { fieldId: FIELD_IDS.visitId, value: { kind: "text", text: "1" } },
                {
                  fieldId: FIELD_IDS.amount,
                  value: { kind: "number", decimal: "1250.00" },
                },
              ],
            }),
          ],
        }),
      ),
    );

    expect(query("[data-record]").textContent).toContain("$1,250.00");
  });
});

describe("SCR-026 — the two empty states stay two", () => {
  it("invites the first record when the table is empty", async () => {
    await renderList(
      selectRecordsListVm(
        table({ recordCount: 0 }),
        page({ records: [], totalCount: 0 }),
      ),
    );

    const empty = query('[data-empty="empty-table"]');
    expect(empty.textContent).toContain("No records yet.");
    expect(empty.textContent).toContain("there is no search or filter to clear");
    expect(queryAll('[data-empty="no-results"]')).toHaveLength(0);
  });

  it("keeps the term, states the table's count, and offers to clear it", async () => {
    const onSearch = vi.fn();
    await renderList(
      selectRecordsListVm(
        table(),
        page({
          records: [],
          scope: { kind: "search", text: "payroll" },
        }),
      ),
      onSearch,
    );

    const empty = query('[data-empty="no-results"]');
    expect(empty.textContent).toContain("No record matches “payroll”.");
    expect(empty.textContent).toContain("Visits holds 40 records");

    // The term is still in the field, and clearing it is one press away.
    expect(query<HTMLInputElement>("input").value).toBe("payroll");
    const clear = queryAll("button").filter(
      (button) => button.textContent === "Clear search",
    );
    expect(clear).toHaveLength(2);
    clear[0]?.click();
    expect(onSearch).toHaveBeenCalledWith("");
  });
});
