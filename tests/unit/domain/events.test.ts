import { describe, expect, it } from "vitest";
import {
  EVENT_KINDS_V1,
  type EventKindV1,
} from "../../../src/migrations/004_event_format_v1.js";
import {
  APP_THEME_TOKENS,
  DELETION_SOURCES,
  F02_EVENT_KINDS,
  INFERENCE_DISPOSITIONS,
  type F02DomainEventV1,
  type F02EventKindV1,
} from "../../../src/domain/model/events.js";
import { asDomainId } from "../../../src/domain/model/ids.js";
import { MISSING_VALUE, decimalValue } from "../../../src/domain/model/values.js";

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
