import { describe, expect, it } from "vitest";
import { chartConfiguration, PALETTE_PROPERTIES, type ChartCanvasData } from "../../../../src/ui/charts/chart-canvas.js";

/**
 * The canvas's choices, as a pure function (S05 CP3): the motion preference,
 * the palette order, the stacked scales and the selected mark's outline.
 * jsdom has no canvas, so drawing itself is the e2e's to prove.
 */

const palette = ["accent", "violet", "primary", "ink"];

const bars: ChartCanvasData = {
  type: "bar",
  labels: ["Scheduled", "Waiting"],
  series: [{ label: "Records", values: [3, 1] }],
  points: [],
  markAt: [[0, 1]],
};

describe("chartConfiguration", () => {
  it("draws with no animation when a person asks for reduced motion", () => {
    expect(chartConfiguration(bars, palette, true, null).options).toMatchObject({ animation: false });
    expect(chartConfiguration(bars, palette, false, null).options).not.toHaveProperty("animation");
  });

  it("reads the series colours from the app accent first, then the secondary series colour", () => {
    expect([...PALETTE_PROPERTIES]).toEqual(["--app-accent", "--violet-600", "--app-primary", "--app-ink"]);
    const stacked = chartConfiguration(
      { ...bars, type: "stacked", series: [{ label: "Yes", values: [2, 1] }, { label: "No", values: [1, 0] }], markAt: [[0, 1], [2, 3]] },
      palette,
      false,
      null,
    );
    expect(stacked.data.datasets.map((dataset) => dataset.backgroundColor)).toEqual(["accent", "violet"]);
    expect(stacked.options).toMatchObject({ scales: { x: { stacked: true }, y: { stacked: true } } });
    // Two series: the legend names them, so colour never carries meaning alone.
    expect(stacked.options).toMatchObject({ plugins: { legend: { display: true } } });
  });

  it("outlines the selected mark in the app's ink, and no other", () => {
    const selected = chartConfiguration(bars, palette, false, { series: 0, index: 1 });
    expect(selected.data.datasets[0]).toMatchObject({ borderColor: "ink", borderWidth: [0, 3] });
  });

  it("gives each slice of a pie its own colour and a legend", () => {
    const pie = chartConfiguration({ ...bars, type: "pie" }, palette, false, null);
    expect(pie.type).toBe("pie");
    expect(pie.data.datasets[0]?.backgroundColor).toEqual(["accent", "violet"]);
    expect(pie.options).toMatchObject({ plugins: { legend: { display: true } } });
  });

  it("plots a scatter's points as x/y pairs", () => {
    const scatter = chartConfiguration(
      { type: "scatter", labels: [], series: [{ label: "Hours × Quoted", values: [] }], points: [{ x: 1, y: 2 }], markAt: [[0]] },
      palette,
      false,
      null,
    );
    expect(scatter.data.datasets[0]?.data).toEqual([{ x: 1, y: 2 }]);
  });
});
