# Archivist log

Historical entries remain append-only in `ROSHI-LOG.md` (F01–F04, latest `60a6a81`). No prior ARCHIVIST-LOG.md existed at this pass. This log continues that record and preserves its standing IDs verbatim, including adopted/retired rows for traceability.

## 2026-09-24 — durable-home-backup (F05), final, BLOCKED / INCOMPLETE

### Record and scope

Read `program-agents/ARCHIVIST.md` in full, the full F05 Final Report and STATE (all raw returns), all architecture files including pre-existing untracked seeds, PROGRAM-CONFIG, all seven sessions and MASTER, original planning/graph review results, git history and the last several historical log entries (F02/F03/F04 final). Inspected affected implementation and sampled behavioral tests against approved database/format meaning. No source, tests, specifications, migration, role, STATE, MASTER, SESSION or report was edited. No tests or live browser/provider/OS-save proofs were rerun by Archivist.

Implementation ends at `d75830d`; root receive `95a539d`; consumed arch deltas `5d73ba2`, `c25742f`, `5a977e6`, `385e794`; graph replan `f1eae46`. Root report records `pnpm verify`: typecheck/lint/build exit 0, 214 files / 2402 passing / 3 inherited skips. Current graph gate: 25 files / 209 independently passing. Native selected 19 files / 106 passing is worker-reported and included in root's full suite. These results do not establish a completed F05 capability.

### Reconciled drift

- Folded F05 deltas into current M01/M07/M08/M09/M12/M23/M24/M27/M32/M33/M34/M51/M53/M56/M59/M62 contracts, ahead of preserved change history. Replaced the S01 eager graph bytes and semantic buffer description with the `c7e6507` metadata/bounded readers and owned lifetime. Native `d75830d` receipt/IO contribution is explicitly partial.
- Replaced planned-only heads in M24/M27/M59/M62 with their landed subsets. M33 now names the real IO worker; export worker remains future. M32 distinguishes byte-free page RPC from the separate IO channel. Updated append head retention, streamed projection/replay/provenance and bootstrap/file-save facts. Valid non-saved completions and aborted transfers have different pin outcomes; CP6 recovery remains open.
- M56's combined M56/M57 S01 material is now unit evidence in M56 and `tests/property/sync/vault.test.ts` evidence in new M57. Property round trips are not storage/restart or provider proof.
- Corrected two inherited documentation remnants: M15 no longer suggests zip.js is used (native M13 reader shipped); M19 no longer names removed `inferProposal`. M36 now names S02 CP5 as the unfinished inherited CAP-05 countdown owner.
- Created `arch/MODULE-REGISTRY.md` from TypeScript AST scans of every registered module's non-test source: type-only imports/exports excluded, value re-exports and dynamic imports included, worker URL construction separate. M24/M27/M59/M62 exist; seeds M05/M25/M26/M29/M30/M47/M64 remain future and byte-preserved. Module edges were not inferred from symbol searches. Config's historical/planned registry remains unchanged under the explicit protected-owner instruction.
- `arch/F05-boundaries.md` reconciles CA-34–41, current graph compatibility scope, pending readers and author inputs with source/proof/owner references. It does not mark STATE ready or grant dispatch.

### Current blockers and owner corrections

S01 3/3; S02 2/6 plus partial CP3; S03–S07 blocked. No J1, complete CAP-39–45, actual OS save, live provider qualification or GATE-F05. Receipt production is present while `app-session.ts` / `record-handlers.ts` still expose absolute local sequence counts; S02 CP4/5 owns receipt-relative readers and exact restart/count proof. S02 CP5 also owns the inherited CAP-05 recovery countdown. Native invalid/aborted pin recovery and complete vault-only artifact recovery remain S02 CP6.

Human DEC-72 → Designer's remaining outcome states → S02 CP3 completion/CP4 J1; human DEC-71 → Designer/S03 reminder policy. `58bffc8` already supplied the fixed named-vault/recovery design portion; its 80 renders are design evidence only. Human/DB Author GRAPH-CONTRACT → S06 CP1 nonempty retained/conflict/audit writers/readers/publication, CP2 installation/history/chain and CP4 J3/J1 regression. Provider registrations, exact redirects and authorized accounts → S04/S05 qualification → S07 real config/token/egress/scheduler and J4–6. These are existing owners, not new plans or product decisions by Archivist.

Machine-actionable record correction for Orchestrator: STATE's Inspected inheritance and Seam Preflight retain present-tense missing-home/IO/save claims superseded by `03ee571`/`d75830d`; current CA/CAP rows are more accurate. Qualify those summaries by revision or refresh them without rewriting historical returns. Narrow DF-F05-1 summary to the remaining decision-dependent design; do not redo the accepted fixed portion. No new source-backed counterexample overturning accepted current-graph evidence was established in the sampled review. Future nonempty and composed proof gaps remain explicitly unverified. AR-1's absent `program/demiurge/specs/database.md` transcript source remains Orchestrator/Archivist validation debt, not inferred format success.

### Recurrence and convention promotion

The threshold is crossed **within one cycle**, not deferred because F05 is incomplete. S02 r1: append retention writer/test omitted → `9466660`; r2: eager shared graph/publication/frontier/fixtures → `760dae1`; r3: incremental hash/CBOR primitives/tests omitted → `3093131`. Those three distinct mechanical returns suffice. r4 adds the graph-contract/producer/reader ownership return → replan `f1eae46`. Three lease amendments and two replans (initial five planning findings at `5e38ca7`, then graph replan) are planning evidence; the product choices themselves are not decomposition defects. No context exhaustion or re-slice occurred. r5→r6 continued independently safe native work in the same context; Native await timeouts were transport reattachments, not worker crashes.

Exact promoted wording, recorded now in owned `arch/PROGRAM-CONVENTIONS.md`:

> Before dispatching or redispatching a backup/retention checkpoint, enumerate all head-mutating writers (including import append), the graph exporter, shared publication/frontier consumers, incremental hash and canonical-encoding primitives, lifecycle owners, and their paired tests/fixtures. Compare boundedness end to end, including pin/load and publication rereads. Batch all visible mechanical path additions into one controlled lease revision. Record unsupported graph branches with both an author-contract supplier and the producer/reader/proof checkpoint that will consume it. Do not use a successful partial producer gate as acceptance of the whole capability.

PROGRAM-CONFIG.md and ROADMAP.md contain externally owned changes and the envelope expressly prohibits their edit/stage/commit. They were preserved; convention incorporation in PROGRAM-CONFIG remains its owner's action, not a deferred decision to recognize the met threshold. Verification commands and scheduling were not changed.

### Proposed for the framework

- **Boundedness is a producer-consumer agreement, not a helper's property:** recommend making the existing mechanical preflight enumerate payload memory, streaming hash/codec consumers and lifetime/retention owners when a checkpoint promises bounded processing. F05 S02 r1/r2/r3/r4: **1 cycle, 4 returns**, of which three are mechanical lease omissions. The specialization above supplies the program rule now. Existing general seam rules are present; this recommends a concrete checklist improvement, not another review stage.
- **Keep present-tense summaries synchronized with received producer facts:** extend the existing CA/CAP receive invariant to Inspected inheritance and Seam Preflight, or explicitly label those sections historical. **1 cycle, 1 receive observation, 2 stale summary locations**. Native IO/home producers landed, while the final summaries still say missing. Do not wait for three cycles to make this recommendation.
- Carry forward the open recommendations in the table below. Size-only interim cadence recurs at **5 cycles**, with **3 F05 seam examples** (eager graph M07, planned M24 head, missing IO M33) added to prior counts. This cycle's two scoped planning reviews mitigated planning gaps; they did not perform final-style synthesis. The framework cleanup-ledger envelope omission remains open but **did not recur in the supplied F05 envelope**, which explicitly fixed its write set.

### Adoption check

Read current PLANNER/CODER/UI-CODER/ORCHESTRATOR text for each carried open item's substance and checked `git log --` plus `git ls-files --` for those exact role paths. They are not tracked in this repository; **there is no attributable role commit to cite**. This limits dating, not the ability to inspect adoption. No inference about human action was drawn from Archivist leaving files unchanged.

`1f54dec2254e8f15` is **adopted** by current PLANNER's “Contract changes include their affected consumers” (production callers, paired fixtures/tests, exact paths and serialized handoff) and shared-assertion ownership rule. It is no longer an open request. Existing receive status invariant (`b06241fe8526baa2`), verification maintenance and shared-index dispositions remain satisfied/retired; `26e3bdf9a1e6dd6f` is normalized from historical “not proposed — already present” to adopted without changing its ID.

Still absent in the reviewed current rules: table-cell validation, an explicit route for an unleased module's own fragment, a live sibling rule-notification channel, exact seed-function requirement and exact-count worker assertion requirement. Generic seed/domain-effect rules are useful but do not fully adopt those narrower requests. The ORCHESTRATOR template still omits cleanup-ledger path and retains the 16-session interim threshold. Counts are held when no new occurrence was established; silence or repeated copying does not increment evidence.

### Cleanup and verification

Created `CLEANUP-LEDGER.md` by reconciling historical CL-01–06. CL-01/04 remain retired on current package/source evidence; CL-02/06 track. Fresh AST export enumeration and whole-word src/tests search finds 211 exported values without outside-file textual references; internal uses and future/dynamic/public contracts prevent calling them dead code. CL-03/05 are briefed, correcting the historical tracking-table/open-brief inconsistency. The standing **Prove or name every unconsumed export** classification brief is refreshed under the repeated-ledger-pattern threshold; it is not removal authority or an approved cleanup program.

Re-read owned diff and new documents, checked links/source paths and `git diff --check`; verified protected config/roadmap hashes against the supplied preservation record, and role/pre-existing seed hashes against startup capture. No implementation suite applies to this prose-only pass. Unrelated modified config/roadmap and untracked seed files remain outside the explicit commit pathspec; a globally clean tree is neither possible nor claimed.

### Standing recommendations

| id | pattern | cycles | in-cycle instances | first seen | status |
| --- | --- | ---: | ---: | --- | --- |
| `27bf4a350ec2f23c` | A dependency must-not ships as a test, not a review note | 4 | 5(F01)+3(F02)+5(F03)+3(F04) | F01 | promoted → PROGRAM-CONFIG Conventions |
| `33dba11758afa4e2` | Encode a must-not as a type or a runtime throw | 4 | 5(F01)+8(F02)+3(F03)+2(F04) | F01 | promoted → PROGRAM-CONFIG Conventions |
| `3e30962a53a57c2f` | Test filters take no bare `--` | 1 | 3 | F01 | promoted → PROGRAM-CONFIG Conventions; no F02/F03/F04 instance |
| `f279893d1ad0a40d` | `Owns` authoritative, Files table indicative | 4 | 7(F01)+9(F02)+12+(F03)+1(F04) | F01 | promoted → Custom Rule 7; F04's continuing mirror-direction instance recorded |
| `3ddf907567cd76e6` | Arch fragment head contract superseded by its own delta | 5 | 4(F01)+6(F02)+6(F03)+1(F04)+6(F05) | F01 | promoted — existing fragment policy; F05 M07/M24/M27/M33/M59/M62 reconciled |
| `b73d9bab7c196038` | Lease or boundary sweep drawn over the wrong tree | 2 | 3(F02) | F01 | promoted at F02 interim → PROGRAM-CONFIG Conventions; held — 0 new instances F03 or F04 |
| `d7d81c3b2cf8e9c9` | Closed union and its exhaustive map split across leases | 2 | 3(F02)+0(F03)+4(F04) | F02 | promoted → PROGRAM-CONFIG Conventions; F04 mixed result — one blocked (S04), three pre-empted after (S05, S06, S08) |
| `f823e9a910b0a671` | A delta describing another module | 4 | 4(F01)+4(F02)+0(F03)+1(F04)+1(F05) | F01 | promoted — existing fragment policy; M56/M57 material separated |
| `442cb40af6e1a830` | No interim drift check scheduled below 16 sessions | 5 | 4(F01)+10(F02)+5(F03)+2(F04)+3(F05) | F01 | open — cadence still size-based; F05 three named stale seams, mitigated by two scoped planning reviews |
| `f1442f23b7f0949d` | Archivist envelope write set omits the cleanup ledger it is asked to own | 4 | 1(F01)+2(F02)+1(F03)+1(F04) | F01 | open — framework template still omits ledger; this F05 envelope explicitly includes it, no new instance |
| `b06241fe8526baa2` | Landed proof legs left in STATE's `planned:` list at receive | 1 | 13 | F02 | **adopted** — ORCHESTRATOR.md's receive step 7 CA/CAP status invariant; F04 shows zero recurrence for the second cycle running |
| `b027c25ef168decb` | STATE table rows that lose a cell go unnoticed | 1 | 6(F02) | F02 | open — no new F05 malformed-row finding; current role lacks a table-shape check |
| `06e04ece038e736d` | A module no session leased has no route into its own fragment | 1 | 6(F02) | F02 | open — no new F05 instance; generic fragment integration does not specify unleased-module routing |
| `3261d808a9c412da` | FORGE-CONFIG Verification Commands has no post-baseline maintainer | 1 | 2 | F01 | adopted (rule + supersession text exist); third consecutive cycle of the expected maintenance note, not a recurrence of the original gap |
| `1a8974acd0d1350e` | Checkpoint boundary blur: capability bodies and proofs split across checkpoints | 2 | 2(F01)+0(F02) | F01 | retired — settled negative at F02; no F03 or F04 instance either (32+31+35 checkpoints across three cycles, no sizing failure) |
| `26e3bdf9a1e6dd6f` | Authorized contract change breaks a consumer outside the lease | 1 | 1 | F02 | adopted — substance already in PLANNER contract-consumer rule; historical not-proposed disposition retained here |
| `6fdb29d40829b4ec` | Files staged in the shared index from outside any lease | 1 | 3 | F01 | retired as an agent concern (environmental, proven F01); do not re-raise |
| `1f54dec2254e8f15` | A declared serial-lease-handoff line for a source directory should name its paired test-directory handoff | 1 | 4(F03) | F03 | adopted — current PLANNER contract-consumer and shared-assertion rules cover paired test handoffs; no attributable role commit available |
| `1c51a85390a3f964` | A rule a concurrently-dispatched sibling session discovers mid-run has no channel to reach another concurrently-dispatched sibling building against the same shared fact vocabulary | 1 | 1(F03) | F03 | open — receive/recheck and lease rules exist; no live sibling rule-notification channel specified; no F05 recurrence |
| `ed1f65d3f1c1e905` | A payload cached by the projection (M12) and sealed by staging (M23) is the same durable fact encoded twice; a version change must lease both | 1 | 3 | F04 | promoted → PROGRAM-CONFIG Conventions at F04; carried unchanged |
| `242f2bb3c9d6af33` | A checkpoint's seed instruction should name the exact producing function, not just the file | 1 | 1(F04) | F04 | open — current rules require authoritative seeds but do not explicitly require exact seed-function references |
| `abf5cf9b579e46b5` | A worker-tier proving assertion requires exact counts, not an inequality, at the first checkpoint that proves a capability | 1 | 1(F04) | F04 | open — exact-count requirement not explicit in current generic proof rules; F05 plans do use exact assertions |
| `941f0fdbdd02f2c4` | Bounded backup prerequisites emerge one per return instead of one complete producer-consumer trace | 1 | 4(F05: S02 r1/r2/r3/r4) | F05 | promoted — arch/PROGRAM-CONVENTIONS.md; framework recommendation open; external config owner preserved |
| `52cdcf97581fa215` | Receive updates current tables but leaves present-tense producer summaries at an older revision | 1 | 1(F05 final receive; two summary locations) | F05 | open — extend existing CA/CAP receive invariant to present-tense inheritance and preflight summaries |
