/**
 * CA-07 amendments 3 and 4 — the snapshot and chart shapes, in every phase
 * (M54), and the chart mark's filter intent in navigation state (D63).
 *
 * Lives beside the records surfaces because `tests/unit/routes/` is in no
 * lease this feature; the guard is a pure function, so a node test is its
 * whole proof, and `tests/e2e/route-guards.spec.ts` drives the same rows
 * through the real entry.
 */

import { describe, expect, it } from "vitest";
import {
  appSnapshotsPath,
  chartPath,
  chartsPath,
  editChartPath,
  guardRoute,
  isAppAreaPath,
  newChartPath,
  snapshotPath,
  type SessionPhase,
} from "../../../../src/routes/guards.js";
import {
  filterIntentState,
  readFilterIntent,
  readFilterOrigin,
} from "../../../../src/routes/filter-intent.js";

const SNAPSHOT_SHAPES = [
  "/app/app-1/snapshots",
  "/app/app-1/snapshots/sheet-9",
  "/app/app-1/snapshots/",
] as const;

describe("the snapshot shapes (CA-07 amendment 3)", () => {
  it("are app-area paths, and an extra segment is not", () => {
    expect(isAppAreaPath("/app/app-1/snapshots")).toBe(true);
    expect(isAppAreaPath("/app/app-1/snapshots/sheet-9")).toBe(true);
    expect(isAppAreaPath("/app/app-1/snapshots/sheet-9/deeper")).toBe(false);
    expect(isAppAreaPath("/app/app-1/snapshot")).toBe(false);
  });

  it("are built from ids, percent-encoded", () => {
    expect(appSnapshotsPath("a/b")).toBe("/app/a%2Fb/snapshots");
    expect(snapshotPath("a", "s 1")).toBe("/app/a/snapshots/s%201");
    expect(isAppAreaPath(snapshotPath("a/b", "s/1"))).toBe(true);
  });

  const expected: Readonly<Record<SessionPhase, ReturnType<typeof guardRoute>>> = {
    "first-run": { kind: "redirect", to: "/welcome" },
    locked: { kind: "redirect", to: "/unlock" },
    unlocked: { kind: "render" },
  };

  for (const phase of ["first-run", "locked", "unlocked"] as const) {
    it.each(SNAPSHOT_SHAPES)(`${phase}: %s`, (path) => {
      expect(guardRoute(phase, path)).toEqual(expected[phase]);
    });
  }

  it("leaves the extra-segment case to the phase's fallback", () => {
    expect(guardRoute("unlocked", "/app/app-1/snapshots/sheet-9/deeper")).toEqual({
      kind: "redirect",
      to: "/library",
    });
  });
});

const CHART_SHAPES = [
  "/app/app-1/charts",
  "/app/app-1/charts/new",
  "/app/app-1/charts/chart-7",
  "/app/app-1/charts/chart-7/edit",
  "/app/app-1/charts/",
] as const;

describe("the chart shapes (CA-07 amendment 4, D63)", () => {
  it("are app-area paths, and an extra segment is not", () => {
    for (const path of CHART_SHAPES) expect(isAppAreaPath(path.replace(/\/$/u, "")), path).toBe(true);
    expect(isAppAreaPath("/app/app-1/charts/chart-7/edit/again")).toBe(false);
    expect(isAppAreaPath("/app/app-1/charts/chart-7/pin")).toBe(false);
    expect(isAppAreaPath("/app/app-1/chart")).toBe(false);
  });

  it("are built from ids, percent-encoded", () => {
    expect(chartsPath("a/b")).toBe("/app/a%2Fb/charts");
    expect(newChartPath("a")).toBe("/app/a/charts/new");
    expect(chartPath("a", "c 1")).toBe("/app/a/charts/c%201");
    expect(editChartPath("a", "c/1")).toBe("/app/a/charts/c%2F1/edit");
    expect(isAppAreaPath(editChartPath("a/b", "c/1"))).toBe(true);
  });

  const expected: Readonly<Record<SessionPhase, ReturnType<typeof guardRoute>>> = {
    "first-run": { kind: "redirect", to: "/welcome" },
    locked: { kind: "redirect", to: "/unlock" },
    unlocked: { kind: "render" },
  };

  for (const phase of ["first-run", "locked", "unlocked"] as const) {
    it.each(CHART_SHAPES)(`${phase}: %s`, (path) => {
      expect(guardRoute(phase, path)).toEqual(expected[phase]);
    });
  }
});

describe("a chart mark's filter intent (D63)", () => {
  const filter = { fieldId: "field-site", operand: { kind: "enum-in" as const, optionIds: ["option-1"] } };

  it("carries the filters, the chart's name and its records' labels", () => {
    const state = filterIntentState([filter], { chartName: "Quoted by site", recordLabels: { "record-7": "Priya Ellis" } });
    expect(readFilterIntent(state)).toEqual([filter]);
    expect(readFilterOrigin(state)).toEqual({ chartName: "Quoted by site", recordLabels: { "record-7": "Priya Ellis" } });
  });

  it("names no origin without filters, or with a malformed one", () => {
    expect(readFilterOrigin(filterIntentState([filter]))).toBeNull();
    expect(readFilterOrigin(filterIntentState([], { chartName: "Quoted by site", recordLabels: {} }))).toBeNull();
    expect(readFilterOrigin({ ...filterIntentState([filter]), "sheaf.records.filterOrigin": { chartName: 7 } })).toBeNull();
    expect(readFilterOrigin(null)).toBeNull();
  });
});
