# M47 — Current durability UI (`src/ui/durability/`)

Reconciled at production `47a633b`. This tracked document supersedes planned status for the implemented subset; externally owned `M47-ui-durability.md` remains a preserved planning seed.

## Presentational contracts

`bundle-save-dialog.tsx` renders the accepted MOD-025 preparation/delivery/explicit-confirmation and terminal outcome states. Escape dismisses; backdrop clicks do not. Callbacks reach M36/M54's live save operation, never fabricate a receipt.

`home-screen.tsx` renders SCR-038/SCR-039's current bundle subset with the shared M37 status selector: nullable confirmation time, explicit pending count, freshness and a working save remedy. M54 mounts it at `/app/:appId/backup`; M41 supplies scoped vault create/reuse/recovery/re-view dialogs. Cloud choices do not imply configured or qualified providers.

`scratch-reminder-dialog.tsx` renders approved first/later reminder copy, exact pending count and persistent loss warning. It focuses its heading, uses two 44px actions, Escape dismissal, inert backdrop and a phone sheet with 16px gutters. React Aria contains/restores focus. Dismissal postpones eligibility and leaves the scratch badge; accepted edits precede the prompt. M54 owns the single keyed route/machine instance and stale-response protection.

## Sources and proof

Accepted vault design `58bffc8`, save/reminder design `4c31ded`, provider design `98ee79c` (future S07 consumer). Source S02 `a93a87c`/`7b1bb58`, S03 through `47a633b`; component assertions and real-entry J1/J2/status/a11y are distinguished in M56/M61. Provider composition/proof stays S07. See [F05 boundaries](F05-boundaries.md).

## Change History

- 2026-09-25 — Final continuation reconciles S02/S03 receive deltas into one implemented-subset contract; preserved the external seed.
