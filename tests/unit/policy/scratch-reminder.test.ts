import { describe, expect, it } from "vitest";
import { dismissScratchReminder, scratchReminderSchedule, type ScratchReminderState } from "../../../src/domain/policy/scratch-reminder.js";
import { backupFreshness } from "../../../src/domain/policy/backup-freshness.js";

describe("scratch reminders (CA-37)", () => {
  const initial: ScratchReminderState = { triggeringCommitId: "commit", dismissalCount: 0, dismissedAtEpochMs: null, nextEligibleAtEpochMs: null };
  it("requires an authored trigger and is immediately eligible", () => {
    expect(scratchReminderSchedule(null, 0)).toBe(false);
    expect(scratchReminderSchedule(initial, 0)).toBe(true);
  });
  it("defers ten minutes, one hour, then repeats daily without changing scratch status", () => {
    let state = initial;
    let now = 1_800_000_000_000;
    for (const delay of [600_000, 3_600_000, 86_400_000, 86_400_000, 86_400_000]) {
      state = dismissScratchReminder(state, now);
      expect(state.nextEligibleAtEpochMs).toBe(now + delay);
      expect(scratchReminderSchedule(state, now + delay - 1)).toBe(false);
      expect(scratchReminderSchedule(state, now + delay)).toBe(true);
      expect(backupFreshness({ homeId: null, confirmedAtMs: null, deviceOnlyChangeCount: 2 })).toBe("scratch");
      now += delay;
    }
    expect(state.dismissalCount).toBe(5);
  });
  it("clock rollback cannot advance eligibility or erase escalation", () => {
    const state = dismissScratchReminder(initial, 1_800_000_000_000);
    expect(scratchReminderSchedule(state, 1_700_000_000_000)).toBe(false);
    const next = dismissScratchReminder(state, 1_700_000_000_000);
    expect(next.dismissalCount).toBe(2);
    expect(next.nextEligibleAtEpochMs).toBe(1_800_003_600_000);
  });
});

it("backup freshness preserves null confirmation and explicit zero", () => {
  expect(backupFreshness({ homeId: "home", confirmedAtMs: null, deviceOnlyChangeCount: 0 })).toBe("never-confirmed");
  expect(backupFreshness({ homeId: "home", confirmedAtMs: 0, deviceOnlyChangeCount: 0 })).toBe("current");
  expect(backupFreshness({ homeId: "home", confirmedAtMs: 0, deviceOnlyChangeCount: 1 })).toBe("out-of-date");
});
