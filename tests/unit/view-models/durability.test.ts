import { expect, it } from "vitest";
import { selectBackupStatus } from "../../../src/application/view-models/durability.js";

it("CA-36/40 keeps no home, no receipt, zero pending and stale receipt distinct", () => {
  const facts = { homeId: "home", homeName: "Bundle", confirmedAtMs: null, deviceOnlyChangeCount: 0 };
  expect(selectBackupStatus({ ...facts, homeId: null })).toMatchObject({ freshness: "scratch", remedy: "Back up now" });
  expect(selectBackupStatus(facts)).toMatchObject({ freshness: "never-confirmed", tone: "warning" });
  expect(selectBackupStatus({ ...facts, confirmedAtMs: 0 })).toMatchObject({ freshness: "current", tone: "success" });
  expect(selectBackupStatus({ ...facts, confirmedAtMs: 0, deviceOnlyChangeCount: 1 }))
    .toMatchObject({ freshness: "out-of-date", title: "Bundle out of date", remedy: "Save a fresh bundle", tone: "warning" });
});
