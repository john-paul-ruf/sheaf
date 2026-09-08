import { describe, expect, it } from "vitest";
import type { EventProvenanceV1 } from "../../../src/migrations/004_event_format_v1.js";
import {
  PROVENANCE_SOURCES,
  type ValueProvenanceV1,
} from "../../../src/domain/model/provenance.js";
import { asDomainId } from "../../../src/domain/model/ids.js";

describe("value provenance", () => {
  it("mirrors 004's closed source list", () => {
    expect([...PROVENANCE_SOURCES]).toEqual([
      "user",
      "initial-import",
      "workbook-reupload",
      "remote-device",
      "conflict-resolution",
      "compaction",
    ]);
    expect(Object.isFrozen(PROVENANCE_SOURCES)).toBe(true);
  });

  it("stays assignable to 004's wire type", () => {
    const domain: ValueProvenanceV1 = {
      source: "initial-import",
      sourceId: asDomainId("lineage", new Uint8Array(16).fill(9)),
      sourceTimestampMs: 1_700_000_000_000n,
      evidence: { column: 3 },
    };

    // A compile error here is the drift alarm this test exists for. The
    // reverse direction is deliberately not assignable: 004's `sourceId` is
    // plain bytes, and widening bytes back to a branded ID must go through
    // `asDomainId`, which checks the length first.
    const wire: EventProvenanceV1 = domain;

    expect(wire.source).toBe("initial-import");
    expect(wire.sourceTimestampMs).toBe(1_700_000_000_000n);
  });

  it("carries no source outside the closed list", () => {
    const sources = new Set<string>(PROVENANCE_SOURCES);

    expect(sources.has("last-write-wins")).toBe(false);
    expect(sources.has("system")).toBe(false);
  });
});
