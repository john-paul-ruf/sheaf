import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVENT_KINDS_V1,
  type EventKindV1,
} from "../../../src/migrations/004_event_format_v1.js";
import {
  APP_THEME_TOKENS,
  CHART_PROVENANCES,
  NON_TEXT_CONTRAST_MINIMUM,
  SYSTEM_FOCUS_COLORS,
  TEXT_CONTRAST_MINIMUM,
  THEME_CONTRAST_PAIRS,
  contrastRatio,
  evaluateThemeContrast,
  isThemeColor,
  themeRenderings,
  DELETION_SOURCES,
  F04_CHART_EVENT_KINDS,
  F02_EVENT_KINDS,
  F04_SCHEMA_EVENT_KINDS,
  FORMULA_IMPORTED_VALUE_POLICIES,
  FORMULA_SOURCES,
  INFERENCE_DISPOSITIONS,
  type DomainEventKindV1,
  type F02DomainEventV1,
  type F02EventKindV1,
} from "../../../src/domain/model/events.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { MISSING_VALUE, decimalValue } from "../../../src/domain/model/values.js";
import type { DomainEventV1 } from "../../../src/application/ports/event-repository.js";

describe("F02 event kinds", () => {
  it("names only kinds migration 004 already declares", () => {
    const declared = new Set<string>(EVENT_KINDS_V1);

    expect(F02_EVENT_KINDS).toHaveLength(11);
    for (const kind of F02_EVENT_KINDS) {
      expect(declared.has(kind), kind).toBe(true);
    }
    // The list is a subset: F02 does not author every kind the format allows.
    expect(F02_EVENT_KINDS.length).toBeLessThan(EVENT_KINDS_V1.length);
  });

  it("types no event the format forbids", () => {
    const kinds = new Set<string>(F02_EVENT_KINDS);

    for (const absent of [
      "record.recalculated",
      "app.last-opened",
      "reminder.dismissed",
      "conflict.timed-out",
    ]) {
      expect(kinds.has(absent), absent).toBe(false);
      expect((EVENT_KINDS_V1 as readonly string[]).includes(absent)).toBe(false);
    }
  });

  it("pairs each kind with exactly its own payload", () => {
    const recordId = asDomainId("record", new Uint8Array(16).fill(1));
    const tableId = asDomainId("table", new Uint8Array(16).fill(2));
    const fieldId = asDomainId("field", new Uint8Array(16).fill(3));

    const patched: F02DomainEventV1 = {
      kind: "record.patched",
      payload: {
        recordId,
        tableId,
        recordRevision: 2n,
        // Sparse and two-ended: the before value travels with the after value.
        changes: [
          {
            fieldId,
            before: MISSING_VALUE,
            after: decimalValue("18.50"),
            provenance: { source: "user" },
          },
        ],
        resultingRecordSha256: new Uint8Array(32),
      },
    };

    expect(patched.payload.changes[0]?.before).toEqual(MISSING_VALUE);
    expect(patched.payload.changes[0]?.after).toEqual({
      kind: "decimal",
      decimal: "18.50",
    });
  });

  it("keeps the closed vocabularies frozen", () => {
    expect([...DELETION_SOURCES]).toEqual(["user", "conflict-resolution"]);
    expect([...INFERENCE_DISPOSITIONS]).toEqual([
      "accepted",
      "rejected",
      "edited",
    ]);
    // design.md § Per-app theming contract: six semantic tokens, and no
    // danger/warning/success/focus token a theme could make ambiguous.
    expect([...APP_THEME_TOKENS]).toEqual([
      "app-ink",
      "app-canvas",
      "app-surface",
      "app-primary",
      "app-accent",
      "app-muted",
    ]);
    for (const frozen of [
      F02_EVENT_KINDS,
      DELETION_SOURCES,
      INFERENCE_DISPOSITIONS,
      APP_THEME_TOKENS,
    ]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
  });

  it("holds the subset relation in the type system", () => {
    // A compile error here means the domain named a kind 004 does not declare.
    const widened: readonly EventKindV1[] = F02_EVENT_KINDS;
    const narrowed: F02EventKindV1 = "record.deleted";

    expect(widened).toContain(narrowed);
  });
});

describe("F04 schema event kinds", () => {
  it("names only kinds migration 004 already declares, and none F02 already typed", () => {
    const declared = new Set<string>(EVENT_KINDS_V1);
    const f02 = new Set<string>(F02_EVENT_KINDS);

    expect([...F04_SCHEMA_EVENT_KINDS]).toEqual([
      "app.renamed",
      "table.changed",
      "field.changed",
      "relationship.changed",
      "relationship.removed",
      "rule.changed",
      "rule.removed",
      "formula.changed",
      "formula.removed",
    ]);
    for (const kind of F04_SCHEMA_EVENT_KINDS) {
      expect(declared.has(kind), kind).toBe(true);
      expect(f02.has(kind), kind).toBe(false);
    }
  });

  it("still types no recalculation event (invariant 7)", () => {
    const kinds = new Set<string>([...F02_EVENT_KINDS, ...F04_SCHEMA_EVENT_KINDS]);
    for (const absent of ["record.recalculated", "formula.evaluated", "formula.result"]) {
      expect(kinds.has(absent), absent).toBe(false);
    }
    // Charts and theme stay with their own columns (S05, S08).
    expect(kinds.has("chart.saved")).toBe(false);
  });

  it("pairs a formula event with a definition that holds no evaluated value", () => {
    const tableId = asDomainId("table", new Uint8Array(16).fill(2));
    const fieldId = asDomainId("field", new Uint8Array(16).fill(3));
    const formulaId = asDomainId("formula", new Uint8Array(16).fill(4));
    const changed: DomainEventV1 = {
      kind: "formula.changed",
      payload: {
        formula: {
          formulaId,
          target: { kind: "computed-column", tableId, fieldId },
          displayName: null,
          originalText: "TODAY()",
          document: {
            irVersion: 1,
            root: { kind: "call", name: "TODAY", version: 1, args: [] },
          },
          disposition: "live",
          determinism: "clock-volatile",
          dependencies: [],
        },
        metadata: {
          catalogVersion: 1,
          functionVersions: [{ name: "TODAY", version: 1 }],
          source: "authored",
          importedValuePolicy: "none",
        },
        priorSha256: null,
      },
    };

    expect(Object.keys(changed.payload).sort()).toEqual(["formula", "metadata", "priorSha256"]);
    expect(Object.keys(changed.payload.formula)).not.toContain("value");
    expect(Object.keys(changed.payload.formula)).not.toContain("result");
  });

  it("keeps the formula metadata vocabularies closed and frozen", () => {
    expect([...FORMULA_SOURCES]).toEqual(["authored", "imported"]);
    expect([...FORMULA_IMPORTED_VALUE_POLICIES]).toEqual(["none", "kept-as-literal"]);
    expect(Object.isFrozen(F04_SCHEMA_EVENT_KINDS)).toBe(true);
    expect(Object.isFrozen(FORMULA_SOURCES)).toBe(true);
    expect(Object.isFrozen(FORMULA_IMPORTED_VALUE_POLICIES)).toBe(true);
  });

  it("holds the widened union inside 004's list in the type system", () => {
    const widened: readonly EventKindV1[] = [...F02_EVENT_KINDS, ...F04_SCHEMA_EVENT_KINDS, ...F04_CHART_EVENT_KINDS];
    const narrowed: DomainEventKindV1 = "field.changed";
    expect(widened).toContain(narrowed);
  });
});

describe("F04 chart event kinds (CA-30)", () => {
  it("names only the two chart kinds migration 004 already declares", () => {
    const declared = new Set<string>(EVENT_KINDS_V1);
    const earlier = new Set<string>([...F02_EVENT_KINDS, ...F04_SCHEMA_EVENT_KINDS]);
    expect([...F04_CHART_EVENT_KINDS]).toEqual(["chart.saved", "chart.deleted"]);
    for (const kind of F04_CHART_EVENT_KINDS) {
      expect(declared.has(kind), kind).toBe(true);
      expect(earlier.has(kind), kind).toBe(false);
    }
    expect(Object.isFrozen(F04_CHART_EVENT_KINDS)).toBe(true);
  });

  it("keeps provenance to migration 005's `charts.provenance` CHECK, verbatim", () => {
    const sql = readFileSync(new URL("../../../src/migrations/005_projection_v1.sql", import.meta.url), "utf8");
    expect(sql).toContain("provenance TEXT NOT NULL CHECK (provenance IN ('imported', 'user'))");
    expect([...CHART_PROVENANCES]).toEqual(["imported", "user"]);
    expect(Object.isFrozen(CHART_PROVENANCES)).toBe(true);
  });
});

describe("the theme contrast gate (CA-32, D56)", () => {
  const cedarLight = {
    "app-ink": "#17231e",
    "app-canvas": "#f5f1e7",
    "app-surface": "#fffdf6",
    "app-primary": "#315c49",
    "app-accent": "#c66948",
    "app-muted": "#d9d0bf",
  } as const;
  const cedarDark = {
    "app-ink": "#f2eee3",
    "app-canvas": "#121b17",
    "app-surface": "#1b2822",
    "app-primary": "#9cc7ae",
    "app-accent": "#e08a6a",
    "app-muted": "#2e3d35",
  } as const;
  const cedar = { themeKey: "cedar", tokens: cedarLight };

  it("measures WCAG 2.x ratios, from 1 to 21, in either order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(() => contrastRatio("red", "#ffffff")).toThrow(RangeError);
  });

  it("renders light only, dark only, or both for system — with the custom accent in each", () => {
    expect(themeRenderings(cedar, cedarDark).map((rendering) => rendering.mode)).toEqual(["light"]);
    expect(themeRenderings({ ...cedar, mode: "dark" }, cedarDark)).toEqual([{ mode: "dark", tokens: cedarDark }]);
    const system = themeRenderings({ ...cedar, mode: "system", customAccent: "#123456" }, cedarDark);
    expect(system.map((rendering) => [rendering.mode, rendering.tokens["app-accent"]])).toEqual([
      ["light", "#123456"],
      ["dark", "#123456"],
    ]);
    expect(() => themeRenderings({ ...cedar, mode: "dark" }, null)).toThrow(RangeError);
  });

  it("checks every CA-32 pair: eight in light (chrome focus included), seven in dark", () => {
    const checks = evaluateThemeContrast(themeRenderings({ ...cedar, mode: "system" }, cedarDark));
    expect(checks.filter((check) => check.mode === "light").map((check) => check.pair)).toEqual([...THEME_CONTRAST_PAIRS]);
    expect(checks.filter((check) => check.mode === "dark").map((check) => check.pair)).toEqual(
      THEME_CONTRAST_PAIRS.filter((pair) => pair !== "focus-chrome"),
    );
    expect(checks.every((check) => check.passes)).toBe(true);
    const minimumOf = new Map(checks.map((check) => [check.pair, check.minimum]));
    expect(["ink-canvas", "ink-surface", "primary-label"].map((pair) => minimumOf.get(pair as never))).toEqual([4.5, 4.5, 4.5]);
    expect(
      ["accent-canvas", "accent-surface", "focus-canvas", "focus-surface", "focus-chrome"].map((pair) => minimumOf.get(pair as never)),
    ).toEqual([3, 3, 3, 3, 3]);
  });

  it("measures the label on primary with surface in light and canvas in dark, and focus with Leaf then Sprout", () => {
    const [light] = evaluateThemeContrast(themeRenderings(cedar, null)).filter((check) => check.pair === "primary-label");
    const [dark] = evaluateThemeContrast(themeRenderings({ ...cedar, mode: "dark" }, cedarDark)).filter((check) => check.pair === "primary-label");
    expect(light?.ratio).toBeCloseTo(contrastRatio(cedarLight["app-surface"], cedarLight["app-primary"]), 10);
    expect(dark?.ratio).toBeCloseTo(contrastRatio(cedarDark["app-canvas"], cedarDark["app-primary"]), 10);
    const focus = evaluateThemeContrast(themeRenderings({ ...cedar, mode: "system" }, cedarDark)).filter((check) => check.pair === "focus-canvas");
    expect(focus.map((check) => check.ratio)).toEqual([
      contrastRatio(SYSTEM_FOCUS_COLORS.onLight, cedarLight["app-canvas"]),
      contrastRatio(SYSTEM_FOCUS_COLORS.onInk, cedarDark["app-canvas"]),
    ]);
  });

  it("fails a custom accent too close to the canvas, naming the pair and the mode", () => {
    // Negative control: the gate must be able to say no.
    const failing = evaluateThemeContrast(
      themeRenderings({ ...cedar, mode: "system", customAccent: "#e8e2d0" }, cedarDark),
    ).filter((check) => !check.passes);
    expect(failing.map((check) => [check.mode, check.pair])).toEqual([
      ["light", "accent-canvas"],
      ["light", "accent-surface"],
    ]);
    expect(failing.every((check) => check.ratio < NON_TEXT_CONTRAST_MINIMUM)).toBe(true);
  });

  it("accepts only #rrggbb in lower case as a theme colour", () => {
    expect(["#a1b2c3", "#000000"].map(isThemeColor)).toEqual([true, true]);
    expect(["#A1B2C3", "a1b2c3", "#abc", "#a1b2c3ff", "var(--color-danger)"].map(isThemeColor)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(TEXT_CONTRAST_MINIMUM).toBe(4.5);
  });
});
