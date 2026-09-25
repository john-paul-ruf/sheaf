# Program conventions carried from F05 evidence

These conventions are recorded on an Archivist-owned architecture surface at the F05 final pass (2026-09-24). The user's envelope prohibits editing or committing externally modified PROGRAM-CONFIG.md. Its owner can incorporate the exact wording below into Conventions; this pass applies the crossed-threshold promotion here rather than waiting for a completed F05. Verification commands, scheduling and protected format contracts are unchanged.

## Trace the whole bounded backup path before a lease amendment

> Before dispatching or redispatching a backup/retention checkpoint, enumerate all head-mutating writers (including import append), the graph exporter, shared publication/frontier consumers, incremental hash and canonical-encoding primitives, lifecycle owners, and their paired tests/fixtures. Compare boundedness end to end, including pin/load and publication rereads. Batch all visible mechanical path additions into one controlled lease revision. Record unsupported graph branches with both an author-contract supplier and the producer/reader/proof checkpoint that will consume it. Do not use a successful partial producer gate as acceptance of the whole capability.

Threshold crossed on the **in-cycle axis**: F05 S02 r1 found the CSV append retention writer/test seam (`9466660` amendment); r2 found eager shared graph/publication/frontier and fixture seams (`760dae1`); r3 found missing incremental hash/CBOR primitives/tests (`3093131`). A fourth return, r4, exposed nonempty graph source/mapping ownership and led to `f1eae46`. Three mechanical lease corrections plus a semantic replan are distinct instances, not one observation because they share a MASTER. The first three alone cross the bar. The fourth requires DB/Author input, not mechanical invention of wire semantics.

This specializes existing framework preflight and owner-recheck rules; it does not create a new review role or demand a new approval. DEC-71/72 are independent product decisions. Native await timeout reattachment, no-context-exhaustion recoveries and the r5→r6 continuation of independently safe native work are not counted as additional lease defects.
