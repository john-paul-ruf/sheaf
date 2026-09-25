# M60 — Browser tests (`tests/browser/`)

Reconciled at production `47a633b`. Browser project tests may use the built harness to exercise real worker/storage boundaries; M61 separately owns real-entry e2e journeys. The registry counts helper source independently of spec files.

## F05 surfaces

`sync/fixtures/save-dialog.entry.tsx` builds an isolated confirmation component page. Its modal proof establishes component behavior, not mounted home reachability or OS save durability.

`sync/fixtures/bundle-reader.{entry,worker}.ts` plus `bundle-reader.config.ts` build a separate production-decoder fixture. It opens captured ciphertext using only a vault passphrase or recovery code, invokes M27 `openBundle` and M33 `recoverBackupGraph`, and compares complete supported authored state without local-root storage.

`sync/bundle.spec.ts` exercises real app import, complete graph recovery, malformed-output rejection, interrupted pending confirmation, reopen and retry while retaining prior bytes. It also rejects import console/page errors and records served build identity and artifact hash. The r9 import failure was an actual required-gate counterexample; `823012b` fixed shared hydration and visit writes. Both deterministic unit regressions failed before the fix, and the rebuilt browser gate passed after it.

At `47a633b` this spec passed in the independently rerun 11-test combined browser/e2e gate. No implementation test was rerun by Archivist. S06 owns nonempty graph/compaction extensions and their J1 regression; S07 owns cloud/security composition. Fresh builds, exclusive output/port ownership and isolated context cleanup remain required. Native OS durability is not established by destination fixtures. See [F05 boundaries](F05-boundaries.md) and M61 for real-entry deadline/status proofs.

## Change History

- 2026-09-25 — S02 CP3–6 and r10 browser deltas reconciled into module-specific component/artifact evidence; unit and e2e details reside in M56/M61.
