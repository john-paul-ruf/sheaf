# M05 — Current policy implementation (`src/domain/policy/`)

Reconciled at production `47a633b`, F05 continuation. This tracked document records landed behavior; the externally owned `M05-policy.md` planning seed is preserved unchanged.

## Contract

`scratch-reminder.ts` exports `ScratchReminderState`, `scratchReminderSchedule(state, nowEpochMs)` and `dismissScratchReminder(state, nowEpochMs)`. An authored trigger with no deadline is immediately eligible. Acknowledged dismissals defer 600000ms, 3600000ms, then 86400000ms repeatedly. Dismissal time is clamped against prior dismissal time, so clock rollback does not shorten the deadline or reset escalation. The worker supplies ClockPort time and persists the result; policy imports no clock, storage or UI.

`backup-freshness.ts` exports `backupFreshness({homeId, confirmedAtMs, deviceOnlyChangeCount})`: `scratch`, `never-confirmed`, `out-of-date`, `current`. Zero timestamp is a receipt; null is not. Freshness never changes authoritative count or dismisses the scratch badge. Removal/account-lifecycle policies remain future work.

## Consumers and evidence

M33 `handlers.ts` consumes reminder policy; M37 `durability.ts` consumes freshness. Both runtime edges are derived from imports in [MODULE-REGISTRY.md](MODULE-REGISTRY.md). Producer/atomic persistence belongs to M33, route lifetime to M54. `tests/unit/policy/` and actual-worker J2 cover deadlines, rollback and restart; [F05 boundaries](F05-boundaries.md) separates accepted current behavior from future providers.

## Change History

- 2026-09-25 — S03 `59caafb`/`a016752`/`d8b4e14`/`47a633b` implemented and proved policy, persistence and consumers; final reconciliation replaces the receive delta.
