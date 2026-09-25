export interface ScratchReminderState {
  readonly triggeringCommitId: string;
  readonly dismissalCount: number;
  readonly dismissedAtEpochMs: number | null;
  readonly nextEligibleAtEpochMs: number | null;
}

/** DEC-71: dismissing a reminder never changes the scratch badge. */
export function scratchReminderSchedule(state: ScratchReminderState | null, nowEpochMs: number): boolean {
  return state !== null && (state.nextEligibleAtEpochMs === null || nowEpochMs >= state.nextEligibleAtEpochMs);
}

export function dismissScratchReminder(state: ScratchReminderState, nowEpochMs: number): ScratchReminderState {
  const delay = state.dismissalCount === 0 ? 600_000 : state.dismissalCount === 1 ? 3_600_000 : 86_400_000;
  const dismissedAtEpochMs = Math.max(nowEpochMs, state.dismissedAtEpochMs ?? nowEpochMs);
  return { ...state, dismissalCount: state.dismissalCount + 1, dismissedAtEpochMs,
    nextEligibleAtEpochMs: dismissedAtEpochMs + delay };
}
