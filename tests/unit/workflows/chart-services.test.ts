import { describe, expect, it, vi } from "vitest";
import { createChartServices, type RecordsWorkerPort } from "../../../src/application/workflows/records-services.js";
import type { ChartDefinitionWireV1, DataWorkerRequestV1 } from "../../../src/workers/protocol/messages.js";

/**
 * The charts column's adapters (S05): each names its request and sends it,
 * verbatim, adding nothing and deciding nothing.
 */

function recordingPort(): { readonly port: RecordsWorkerPort; readonly sent: DataWorkerRequestV1[] } {
  const sent: DataWorkerRequestV1[] = [];
  const port: RecordsWorkerPort = {
    send: (request) => {
      sent.push(request);
      return Promise.resolve({ kind: request.kind, outcome: { result: "unknown-chart" } } as never);
    },
  };
  return { port, sent };
}

const definition: ChartDefinitionWireV1 = {
  name: "Quoted by site",
  tableId: "table-1",
  filters: [],
  pinned: true,
  type: "bar",
  groupBy: { kind: "field", fieldId: "field-site" },
  seriesBy: null,
  measure: { kind: "count" },
  sort: "category",
};

describe("createChartServices", () => {
  it("notifies the shared reminder boundary only after an authored commit", async () => {
    const onAuthored = vi.fn();
    const port: RecordsWorkerPort = { send: vi.fn().mockResolvedValueOnce({ kind: "setChartPin", outcome: { result: "saved", commitId: null } })
      .mockResolvedValueOnce({ kind: "setChartPin", outcome: { result: "stale-chart", chartRevision: 3 } })
      .mockResolvedValueOnce({ kind: "setChartPin", outcome: { result: "saved", commitId: "c" } }) };
    const services = createChartServices(port, onAuthored);
    const request = { appId: "a", chartId: "c", expectedRevision: 1, pinned: true };
    await services.setChartPin(request);
    await services.setChartPin(request);
    expect(onAuthored).not.toHaveBeenCalled();
    await services.setChartPin(request);
    expect(onAuthored).toHaveBeenCalledExactlyOnceWith("a");
  });
  it("sends each chart request exactly as named", async () => {
    const { port, sent } = recordingPort();
    const services = createChartServices(port);
    await services.listCharts({ appId: "app-1" });
    await services.getChart({ appId: "app-1", chartId: "chart-1" });
    await services.getChartDataset({ appId: "app-1", source: { kind: "draft", definition }, tableOffset: 50 });
    await services.saveChart({ appId: "app-1", chartId: null, expectedRevision: null, definition });
    await services.setChartPin({ appId: "app-1", chartId: "chart-1", expectedRevision: 2, pinned: false });
    await services.deleteChart({ appId: "app-1", chartId: "chart-1", expectedRevision: 3 });
    await services.getChartDraft({ appId: "app-1" });
    await services.saveChartDraft({ appId: "app-1", draft: { chartId: null, expectedRevision: null, definition } });
    await services.discardChartDraft({ appId: "app-1" });
    expect(sent).toEqual([
      { kind: "listCharts", appId: "app-1" },
      { kind: "getChart", appId: "app-1", chartId: "chart-1" },
      { kind: "getChartDataset", appId: "app-1", source: { kind: "draft", definition }, tableOffset: 50 },
      { kind: "saveChart", appId: "app-1", chartId: null, expectedRevision: null, definition },
      { kind: "setChartPin", appId: "app-1", chartId: "chart-1", expectedRevision: 2, pinned: false },
      { kind: "deleteChart", appId: "app-1", chartId: "chart-1", expectedRevision: 3 },
      { kind: "getChartDraft", appId: "app-1" },
      { kind: "saveChartDraft", appId: "app-1", draft: { chartId: null, expectedRevision: null, definition } },
      { kind: "discardChartDraft", appId: "app-1" },
    ]);
  });
});
