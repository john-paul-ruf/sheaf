# Build — Sheaf / durable-home-backup

## Agents

Planner planned this. Coder builds it; Orchestrator schedules it. The inspected local role sources are `program-agents/CODER.md` and `program-agents/ORCHESTRATOR.md`; UI delegation follows `program-agents/UI-CODER.md`. Do not refer to a nonexistent ./CODER.md beside this plan. STATE, MASTER and arch belong to Orchestrator; Coder commits only its lease at every checkpoint.

Solo: one agent follows the serial protocol below. Parallel: Orchestrator spawns Coder using the runtime's subagent mechanism, supplies an Orchestration Envelope with exact write set/port/arch-fragment path, and awaits the result. No shell-process/pid/env handshake; Orchestrator cannot commit during a blocked await.

## Protocol — each iteration

1. Read PROGRAM-CONFIG, STATE canonical sections and the selected SESSION fully. Historical handoffs do not override current blockers/readiness.
2. Choose a pending session with satisfied explicit dependencies, agreed CAs and committed ready predecessor inputs. Own future implementations are planned, not prerequisites. Clear PLAN-REVIEW and only applicable protected input/design seams.
3. Inspect actual constructor/configuration/transport/proof inputs against CA mapping; amend provisional mapping after the producer lands before dependent dispatch.
4. Acquire exact Owns lease and resources, verify prior worker ended and preserve unfinished work. Read all target files before changing them.
5. Build checkpoint by checkpoint; every checkpoint's relevant tests and typecheck/build condition pass before Coder runs git add -- with exactly its Owns pathspec and commits. Never stage shared state/arch, protected author inputs or unrelated files.
6. Use VB-01/VB-02/VB-03 exact commands and proof J1–J6; do not treat zero discovery, download start, a fixture-only adapter or an unconfigured constructor as success.
7. Return handoff with actual commits/commands/evidence; Orchestrator updates session status/checkpoint, CA producer/proof status, CAP readiness and blockers separately. Paste handoff verbatim; invalidate evidence on counterexample or contract change.
8. Controlled Lease Revision handles mechanical seams after ownership checks, preserving implementation. Product/schema/security changes route through Author re-entry; no self-widened worker lease.
9. Recheck affected next sessions, update architecture, and continue all eligible work. No parallel source overlap; shared dist/Playwright-output resources are exclusive even for disjoint source leases.

## Bounded preflight corrections

PC-F05-01–05 dispositions are canonical in STATE. S02 CP4 includes J1 receipt/count readers; CP5 closes inherited CAP-05 countdown. S06 CP2 includes audit history/restore readers plus truthful history VM/screen and paired tests before equivalence; CP4 proves real UI restoration. CA-35 scope is authenticated-parent/AAD authority, never a frame field. S07 CP1 registers and runs credential-free security-f05 discovery, probes and negative controls; CP5 reruns it. Optional chart file split is intentionally retained. Seven sessions and their dependencies remain unchanged.

S04/S05/S06 source leases are disjoint but full-session dist:build/playwright:output reservations must serialize under current envelopes. Provider input blockage need not stop S06 once GRAPH-CONTRACT and predecessor proofs are cleared. A distinct port does not isolate shared outputs. After receiving this plan correction, Orchestrator refreshes its ledger from STATE and performs scoped planning-completeness recheck before affected dispatch. DEC-71/72, design fill, provider qualification and demo verdict remain separate gates.

## REPLAN-F05-GRAPH receive and dispatch

Base `3093131`; S02 CP1 `03ee571` accepted. CaVon ended with CP2 implementation preserved uncommitted; do not redo CP1, reset/stash/stage implementation during planning, or adopt the unaccepted arch fragment as ready. STATE graph map and GRAPH-S02/GRAPH-S06 session gates are authoritative. Orchestrator performs a scoped planning-completeness recheck at the quiet boundary, refreshes stale ledger/blockers and issues the amended exact S02 envelope. Resume CP2 with cursor/port coverage, production key/cursor cleanup and complete current-producer graph proof. Its unsupported nonempty-root compatibility guard rejects without publication, receipt change or discarded content.

S06 co-owns first nonempty retained/conflict/audit candidate writers, descendant readers, shared publication/frontier/backup-port integration, paired fixtures and J1 assertions at CP1 before CP2 installation. GRAPH-CONTRACT is a scoped human/DB Author decision with concrete recommendation and compatibility consequences in STATE. S06 and S07's compacted-graph consumption remain blocked until accepted mapping and proofs; independent S02 work may proceed. Do not call current-workbook tests complete nonempty graph proof. Author inputs stay outside every Coder lease. Coder rechecks provisional CA-35/41 at its committed CP1 before CP2 and reports mapping/evidence in Handoff; Orchestrator updates canonical agreements on receive and checks J3/J1 before S07. No mid-session Orchestrator handshake is required. DEC-71/72/design/provider choices remain open.

## Crash Recovery

Read STATE last checkpoint, handoff, git status and git log --oneline -- <lease paths>. Git commits are authoritative. Resume after last committed checkpoint, retaining and validating uncommitted in-lease work after confirming previous worker ended. Never reset --hard or discard another session's work. Record state before stopping.

## Stopping Conditions

All sessions done is not sufficient: every required capability needs current composed acceptance evidence. Blocked session → record exact owner/input and work on another eligible session. Only unresolved product-design/destructive choices go to human. Real provider/interruption/context terminal → preserve checkpoint/work and report it. No turn/token/retry budget is part of this plan.

## Final Report

Orchestrator (or solo runner after implementation) writes `program/sheaf/prompts/durable-home-backup/FINAL-REPORT.md` and commits that exact path before returning. It summarizes sessions/checkpoints, capabilities, changed files/APIs, actual tests, source/build/config identity, residual gaps/owners and GATE-F05 demo recipe. Include orchestration concurrency/wall time/lease violations/checkpoint shortfalls/granularity feedback. Required live or platform proof not run is explicitly incomplete; never call local doubles live qualification.

The prompts directory is ignored. Earlier reports are individually force-tracked. To fulfill the explicit committed-report instruction without changing ignore policy, stage only the final report with `git add -f -- program/sheaf/prompts/durable-home-backup/FINAL-REPORT.md`; inspect staged paths then commit. Coder does not own this report or STATE/MASTER. Do not publish to .program scratch instead.

## Schedule and next step

Seven sessions, 28 checkpoint commits: S01 → S02 → S03 → {S04 / S05 / S06; source-disjoint, shared resources serialize} → S07. See explicit dependencies (S04/S05 depend on S01/S02, not S03 code) and current input gates in STATE. First narrow journey J1 is S02 CP4, completed error/recovery proof CP6. S03 integrates reminders/status, S06 compaction/recovery, S07 cloud scheduling/egress. Resume S02 CP2 after the scoped GRAPH planning recheck; route Designer fill and pending human inputs concurrently where independent. Planner does not execute these sessions.
