# M05 F05 policy delta

Pre-existing untracked M05-policy.md remains untouched; this tracked delta records only accepted F05 work.


<!-- durable-home-backup SESSION-03 r3 -->
## M05 — policy

New `scratch-reminder.ts`: `ScratchReminderState`, `scratchReminderSchedule(state, nowEpochMs)` and `dismissScratchReminder(state, nowEpochMs)`. An authored trigger with no deadline is immediately eligible; acknowledged dismissals defer 600000ms, 3600000ms, then 86400000ms repeatedly. Rollback never shortens a persisted deadline or resets escalation. Callers supply worker ClockPort time. No clock, storage or UI imports.

New `backup-freshness.ts`: `backupFreshness({homeId, confirmedAtMs, deviceOnlyChangeCount})` distinguishes `scratch`, `never-confirmed`, `out-of-date`, `current`; zero time is a receipt, null is not. Freshness never changes the authoritative count.


Independent receive at47a633b: typecheck/lint exit0;223files/2461unit pass/3inherited skips; exact combined current-build browser gate11pass/0skip/0retry. Original full e2e81pass is Coder-run, source-identical evidence reviewed; focused composed gates independently rerun. S06/S07 future graph/provider proofs remain owned.
