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

S04/S05/S06 source leases are disjoint but full-session dist:build/playwright:output reservations must serialize under current envelopes. Provider input blockage need not stop S06 after scoped review of accepted Authorafe37f3 and ready S02/S03 inputs. A distinct port does not isolate shared outputs. After receiving this plan correction, Orchestrator refreshes its ledger from STATE and performs scoped planning-completeness recheck before affected dispatch. DEC-71/72 are approved; save/reminder design is accepted at 4c31ded. Provider design98ee79c is supplied; registration/qualification and demo verdict remain separate gates.

## REPLAN-F05-GRAPH-APPROVED receive and dispatch

Plan/Author HEADafe37f3 supplies the exact approved DB contract. S01 done3/3, S02 done6/6 and S03 done4/4 remain accepted; current implementation47a633b and independent local/J1/J2 evidence are preserved. No completed session is restarted. CA-35/41 Author input is supplied/agreed; S06 producer and candidate/installed/composed proofs remain planned.

S06 is pending0/4 **for implementation after** scoped PLAN-REVIEW-GRAPH-APPROVED. Request the Archivist planning-completeness pass at this quiet boundary, reconcile findings and refresh ledger/blockers from canonical STATE before dispatch. No new human graph question. Its expanded exact lease batches codecs, bounded projection export/history, original import-checkpoint preservation, both head writers and import caller, publication/frontier, nested bundle decoder, counts, safe cleanup tickets and all affected tests/harness. Four checkpoints: complete candidate+reader proof; installed/reopen/edit/import/history/cleanup equivalence; actual periodic scheduler/harness; J3/J1 vault-only proof. No application proof is claimed by this replan.

S06 uses production128-tail/real timer with no release debug API. Port8081 and dist:build/playwright:output are exclusive; source-disjoint provider sessions still serialize these resources. Coder rechecks committed CP1 mapping before CP2; Orchestrator amends canonical mappings from received implementation/evidence before S07. S07 retains dependenciesS03/S04/S05/S06, provider registrations/qualification and J4/J5/J6; provider design98ee79c is ready. Provider inputs and GATE-F05 remain independent blockers. Author specs/migrations, protected config/roadmap/arch seeds and historical handoffs stay untouched.

## Crash Recovery

Read STATE last checkpoint, handoff, git status and git log --oneline -- <lease paths>. Git commits are authoritative. Resume after last committed checkpoint, retaining and validating uncommitted in-lease work after confirming previous worker ended. Never reset --hard or discard another session's work. Record state before stopping.

## Stopping Conditions

All sessions done is not sufficient: every required capability needs current composed acceptance evidence. Blocked session → record exact owner/input and work on another eligible session. Only unresolved product-design/destructive choices go to human. Real provider/interruption/context terminal → preserve checkpoint/work and report it. No turn/token/retry budget is part of this plan.

## Final Report

Orchestrator (or solo runner after implementation) writes `program/sheaf/prompts/durable-home-backup/FINAL-REPORT.md` and commits that exact path before returning. It summarizes sessions/checkpoints, capabilities, changed files/APIs, actual tests, source/build/config identity, residual gaps/owners and GATE-F05 demo recipe. Include orchestration concurrency/wall time/lease violations/checkpoint shortfalls/granularity feedback. Required live or platform proof not run is explicitly incomplete; never call local doubles live qualification.

The prompts directory is ignored. Earlier reports are individually force-tracked. To fulfill the explicit committed-report instruction without changing ignore policy, stage only the final report with `git add -f -- program/sheaf/prompts/durable-home-backup/FINAL-REPORT.md`; inspect staged paths then commit. Coder does not own this report or STATE/MASTER. Do not publish to .program scratch instead.

## Schedule and next step

Seven sessions, 28 checkpoint commits: S01 → S02 → S03 → {S04 / S05 / S06; source-disjoint, shared resources serialize} → S07. See explicit dependencies (S04/S05 depend on S01/S02, not S03 code) and current input gates in STATE. First narrow journey J1 is S02 CP4, completed error/recovery proof CP6. S03 integrates reminders/status, S06 compaction/recovery, S07 cloud scheduling/egress. S01/S02/S03 are accepted through production47a633b; save/reminder policies and all scoped design inputs are ready (provider98ee79c). S06 Author input is suppliedafe37f3 and its implementation dispatch awaits scoped completeness review; S04/S05 still require provider registrations; S07 retains dependent cloud/security proofs. Do not restart completed sessions. Planner does not execute these sessions.
