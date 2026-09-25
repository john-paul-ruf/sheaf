# M59 — vault-fixtures (`tests/fixtures/vaults/`)

## Current contract

S01 generated known answers landed; byte compatibility retained at `c7e6507`.
F05 outputs stay isolated under `f05/`; the F01 `local-v1/` KATs remain authoritative and unchanged.

`tests/fixtures/vaults/f05/{head.cbor,checkpoint.shf,manifest.shf,index.shf}` are
byte-exact deterministic producer known answers. `generate.ts` writes only those
four names in its own directory. Tests regenerate in memory, detect a deliberately
corrupted answer, and open the graph from the fixture vault passphrase/recovery
via real crypto and existing checkpoint codecs. This is an empty-app fixture;
full current-application reconstruction/storage/restart is separately accepted
through S02 (`823012b`, rerun at `47a633b`). Positive future nonempty graph and
compaction fixtures/proofs remain S06, behind the exact Author contract.

## Evidence and limits

Implementation: S01 `694c741` / `13e83f1` / `8674766`, S02 `c7e6507` / `d75830d`, as applicable to the paths above. See [F05 boundaries](F05-boundaries.md) for CA ownership and proof limits, and [current registry](MODULE-REGISTRY.md) for mechanically derived runtime edges.

## Change History

- 2026-09-24 — Planner seed at `2c35bfb` described future work.
- 2026-09-24 — Final reconciliation replaced that planned status with the landed subset and folded received implementation deltas. No full F05 capability is claimed.

- 2026-09-25 — Current application proof separated from empty KAT fixture and future S06 nonempty proof.
