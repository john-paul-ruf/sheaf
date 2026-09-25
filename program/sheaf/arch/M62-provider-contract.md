# M62 — provider-contract (`tests/provider-contract/`)

## Current contract

S01 shared stateful double landed. Dropbox/OneDrive adapters and live qualification remain pending S04/S05. Live accounts/credentials must not be committed; local fixture proof must stay distinct from opt-in external qualification.

`tests/provider-contract/shared/double.ts#DurableHomeDouble` is stateful per
account/location instance, copy-isolates bytes, accepts only identical retries of
immutable objects, atomically rejects stale/create-if-absent CAS, and observes
abort before mutation. Its self-tests are discovered under
`tests/unit/sync/protocol/provider-double.test.ts`. No external provider request,
credentials, platform-save completion or live qualification is claimed.

## Evidence and limits

Implementation: S01 `694c741` / `13e83f1` / `8674766`, S02 `c7e6507` / `d75830d`, as applicable to the paths above. See [F05 boundaries](F05-boundaries.md) for CA ownership and proof limits, and [current registry](MODULE-REGISTRY.md) for mechanically derived runtime edges.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Final reconciliation replaced that planned status with the landed subset and folded received implementation deltas. No full F05 capability is claimed.
