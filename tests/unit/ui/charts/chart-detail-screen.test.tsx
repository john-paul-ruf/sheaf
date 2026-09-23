import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { selectChartDetailVm } from "../../../../src/application/view-models/records.js";
import type { ChartCanvasProps } from "../../../../src/ui/charts/chart-canvas.js";
import { ChartDetailScreen } from "../../../../src/ui/charts/chart-detail-screen.js";
import type { AppNavigation } from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import { interact, query, queryAll, render } from "../render.js";
import { APP_ID, FIELD_IDS, OPTION_IDS, session, table } from "../records/fixtures.js";
import { MARKS, dataset } from "./fixtures.js";

/**
 * SCR-033 as rendered (S05 CP3): the scope, the text summary, the keyboard
 * path to every mark, SHT-012's apply and clear, SHT-017's table and its
 * paging, and STA-015's named sample. Chart.js is stubbed: jsdom has no
 * canvas, and what is under test is everything Sheaf owns around it. The stub
 * still exposes `onMark`, so a mark tapped on the canvas is covered too.
 */

const canvas = vi.hoisted(() => ({ last: null as ChartCanvasProps | null }));
vi.mock("../../../../src/ui/charts/chart-canvas.js", () => ({
  ChartCanvas: (props: ChartCanvasProps): ReactNode => {
    canvas.last = props;
    return <div data-canvas-stub={props.data.type} />;
  },
}));

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  appSnapshots: `#/app/${APP_ID}/snapshots`,
  tables: [],
};
const identity = { appId: APP_ID, displayName: "Field Log", theme: session().theme };

async function renderDetail(vm = selectChartDetailVm(dataset(), [table()]), onShowMoreRows?: () => void) {
  const onApplyMark = vi.fn();
  await render(
    <ChartDetailScreen
      app={identity}
      fullDataHref={`#/app/${APP_ID}/t/table-1`}
      nav={nav}
      onApplyMark={onApplyMark}
      vm={vm}
      {...(onShowMoreRows === undefined ? {} : { onShowMoreRows })}
    />,
  );
  return { onApplyMark };
}

const button = (name: string): HTMLButtonElement => {
  const found = queryAll<HTMLButtonElement>("button").find((candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent) === name);
  if (found === undefined) throw new Error(`no button ${name}`);
  return found;
};

describe("SCR-033 — chart detail", () => {
  it("names the chart and its table, and says every row was read", async () => {
    await renderDetail();
    const screen = query('[data-screen="SCR-033"]');
    expect(screen.textContent).toContain("Charts · Visits");
    expect(query("h1").textContent).toBe("Quoted by site");
    expect(screen.textContent).toContain("Select a bar to filter the related record list. Colour never carries meaning by itself.");
    expect(query('[data-scope="all"]').textContent).toBe("Showing all 8 local rows");
  });

  it("writes the text summary from the dataset's facts (chart-detail.html's pattern)", async () => {
    await renderDetail();
    expect(query('[data-summary="true"]').textContent).toBe("Ridgeway Depot is highest at $1,850.00; Not given is lowest at $30.00.");
    expect(query('[role="group"]').getAttribute("aria-label")).toBe(
      "Bar chart: Quoted by site. Ridgeway Depot is highest at $1,850.00; Not given is lowest at $30.00.",
    );
  });

  it("reaches every mark from the keyboard path, not only the canvas (CTL-075)", async () => {
    await renderDetail();
    const marks = queryAll("[data-mark]");
    expect(marks.map((mark) => mark.textContent)).toEqual([
      "Ridgeway Depot$1,850.00",
      "Alder Court$920.00",
      "Not given$30.00",
      "Needs attentionNot given",
    ]);
    expect(marks.every((mark) => mark.tagName === "BUTTON" && mark.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("opens SHT-012 for a mark and applies exactly its filter", async () => {
    const { onApplyMark } = await renderDetail();
    await interact(() => {
      button("Ridgeway Depot, $1,850.00").click();
    });
    const sheet = query('[data-sheet="SHT-012"]');
    expect(sheet.textContent).toContain("Ridgeway Depot · $1,850.00");
    expect(sheet.textContent).toContain("Site: Ridgeway Depot");
    expect(sheet.textContent).toContain("4 records in Visits.");
    expect(query('[data-mark="0"]').getAttribute("aria-pressed")).toBe("true");
    await interact(() => {
      button("View all 4 records").click();
    });
    expect(onApplyMark).toHaveBeenCalledTimes(1);
    expect(onApplyMark.mock.calls[0]?.[0]).toMatchObject({
      index: 0,
      filterIntent: [{ fieldId: FIELD_IDS.site, operand: { kind: "enum-in", optionIds: [OPTION_IDS.ridgeway] } }],
    });
  });

  it("clears the selection, and offers nothing to apply for rows no filter can name", async () => {
    const { onApplyMark } = await renderDetail();
    await interact(() => {
      button("Needs attention, Not given").click();
    });
    const apply = button("View all 1 record");
    expect(apply.disabled || apply.getAttribute("aria-disabled") === "true").toBe(true);
    expect(query('[data-sheet="SHT-012"]').closest('[role="dialog"]')?.textContent).toContain(
      "No filter finds exactly the records this mark counts.",
    );
    await interact(() => {
      button("Clear filter").click();
    });
    expect(queryAll('[data-sheet="SHT-012"]')).toHaveLength(0);
    expect(queryAll('[data-mark][aria-pressed="true"]')).toHaveLength(0);
    expect(onApplyMark).not.toHaveBeenCalled();
  });

  it("opens SHT-012 for a mark tapped on the canvas", async () => {
    await renderDetail();
    expect(canvas.last?.data.labels).toEqual(["Ridgeway Depot", "Alder Court", "Not given", "Needs attention"]);
    await interact(() => {
      canvas.last?.onMark(1);
    });
    expect(query('[data-sheet="SHT-012"]').textContent).toContain("Alder Court · $920.00");
  });

  it("opens SHT-017: the summary, every category's row, and paging", async () => {
    const onShowMoreRows = vi.fn();
    const vm = selectChartDetailVm(dataset({ tablePage: { rows: MARKS.slice(0, 2), offset: 0, total: 4 } }), [table()]);
    await renderDetail(vm, onShowMoreRows);
    await interact(() => {
      button("Accessibility view").click();
    });
    const sheet = query('[data-sheet="SHT-017"]');
    expect(sheet.closest('[role="dialog"]')?.textContent).toContain("Text summary and complete data table");
    expect(queryAll("thead th").map((cell) => cell.textContent)).toEqual(["Site", "Quoted amount", "Records"]);
    expect(queryAll("tbody tr").map((row) => row.textContent)).toEqual(["Ridgeway Depot$1,850.004", "Alder Court$920.002"]);
    expect(sheet.textContent).toContain("2 of 4 rows shown.");
    await interact(() => {
      button("Show more rows").click();
    });
    expect(onShowMoreRows).toHaveBeenCalledTimes(1);
  });
});

describe("STA-015 — a named sample and a named omission", () => {
  const partial = selectChartDetailVm(
    dataset({
      sourceRowsConsidered: 20_000,
      matchingRows: 25_000,
      sample: { kind: "newest", rows: 20_000 },
      omittedCategories: 1_196,
      tablePage: { rows: MARKS, offset: 0, total: 1_200 },
    }),
    [table()],
  );

  it("says exactly what the chart read and drew, with the remedy", async () => {
    await renderDetail(partial);
    const state = query('[data-state="STA-015"]');
    expect(state.textContent).toContain("Chart uses the newest 20,000 of 25,000 local rows on this device");
    expect(state.textContent).toContain("Showing 4 of 1,200 categories.");
    const link = queryAll<HTMLAnchorElement>("a").find((anchor) => anchor.textContent === "Open full data");
    expect(link?.getAttribute("href")).toBe(`#/app/${APP_ID}/t/table-1`);
  });

  it("calls the accessible table partial", async () => {
    await renderDetail(partial);
    await interact(() => {
      button("Accessibility view").click();
    });
    expect(query('[data-sheet="SHT-017"]').closest('[role="dialog"]')?.textContent).toContain("Text summary and partial data table");
  });
});
