/**
 * CA-07 amendment 3 — the two snapshot shapes, in every phase (M54).
 *
 * Lives beside the records surfaces because `tests/unit/routes/` is in no
 * lease this feature; the guard is a pure function, so a node test is its
 * whole proof, and `tests/e2e/route-guards.spec.ts` drives the same rows
 * through the real entry.
 */

import { describe, expect, it } from "vitest";
import {
  appSnapshotsPath,
  guardRoute,
  isAppAreaPath,
  snapshotPath,
  type SessionPhase,
} from "../../../../src/routes/guards.js";

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
