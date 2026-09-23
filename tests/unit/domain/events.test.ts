import { describe, expect, it } from "vitest";
import {
  EVENT_KINDS_V1,
  type EventKindV1,
} from "../../../src/migrations/004_event_format_v1.js";
import {
  APP_THEME_TOKENS,
  DELETION_SOURCES,
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
    const widened: readonly EventKindV1[] = [...F02_EVENT_KINDS, ...F04_SCHEMA_EVENT_KINDS];
    const narrowed: DomainEventKindV1 = "field.changed";
    expect(widened).toContain(narrowed);
  });
});
