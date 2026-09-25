# Final Report — F05 durable-home-backup

**Current outcome (run r-_nfe, 2026-09-25): blocked on your provider inputs; S01, S02, S03 and S06 accepted.** Periodic compaction now works end to end. After two real 128-commit compactions, a vault-only recovered bundle still matches an independent replay oracle, including authored state, full history and restoration, provenance and device chains. The same J3 journey covers same-context restart, restoring a pre-compaction deletion, and a V2 edit and append. S04, S05 and S07 cannot proceed without the Dropbox/OneDrive registrations (INPUT-DROPBOX / INPUT-ONEDRIVE). No cloud qualification, F05 demo approval or permission to start F06 is claimed. The report from the earlier continuation (13cfbbc) is kept verbatim below. Its S06 and "compaction" rows are superseded by this section.

## This continuation — S06 compaction (CAP-44)

| Work | Commits | Acceptance |
|---|---|---|
| S06 CP1 authenticated V2 candidate and evidence recovery | 084ecf9 (r8), correction 7e785e4 (r9) | 084ecf9 was held on receive after an intermittent 1/250 IntegrityError under the root gate. Root cause: the fixture used a random demo row that sometimes carries warnings, with a hard-coded empty report. Production's refusal was correct, and the check was not loosened. |
| S06 CP2 install, reopen, edit and append without downgrade | 250c9e0, correction fccc345 | Atomic head/catalog/ticket CAS; reachability and pin checks on every cleanup batch; retained-history VM and screen; restored an unauthorized removal of the “this device” line |
| S06 CP3 periodic scheduler | 7a7fce8, corrections 696824e, 8a215d0 | One worker-owned scheduler at 128 post-checkpoint commits, checking every 1500 ms; command/transfer gate; no storage reads after lock or dispose |
| S06 CP4 J3 through real UI and vault-only recovery | 2d8ff2d | Oracle equivalence for every artifact (127/V1 → 128/V1 → V2 cp129 → V2 cp257); receipt pending 0→1 with confirmed time unchanged |
| Architecture delta | 71e3adc | M09/M12/M23/M24/M33/M37/M44 |

**Independent verification at 2d8ff2d** (Orchestrator ran these and checked exit codes): `pnpm typecheck` 0 and `pnpm lint` 0. The CP1+CP2 selector (39 files) passed 473/473. Full `pnpm test`: 229 files, 2520 passed, 3 known skips carried over from earlier features. Playwright on port 8081 with a fresh build: compaction-backup 2/2 (J3), sync/compaction + sync/bundle 3/3 (production timer), bundle-backup/append-import/backup-status/records-crud/gate-f02-demo/worker/import-journey 18/18. That is 23/23; the built main bundle carries build id 2d8ff2d. CP1 was also rechecked in a clean worktree at 084ecf9 (tc/lint 0; gate 249/250, which led to the correction above).

## Orchestration

**Concurrency:** 3 (effective 1; only S06 was eligible)   **Wall clock:** ~2h (08:43–10:50 local)   **Binding:** Native (`mcp__demiurge__spawn_subagent` / `await_subagent_result`; awaits re-issued after the client's 300 s idle timeout)
**Sessions run:** 1 (S06 r9)   **Checkpoint commits by Coder this run:** 7 (+ CP1 084ecf9 from prior run r8)

### Wave plan as executed
| Wave | Sessions | Notes |
|---|---|---|
| GRAPH-8 | S06 r9 (recovery2) | Resumed from CP1 084ecf9 plus preserved r8 CP2 work; returned done 4/4 |

### Blocked
| S | Reason | Last checkpoint | Dependents stalled |
|---|---|---|---|
| S04 | INPUT-DROPBOX: needs your registered public client ID, redirect URIs, App Folder config and test accounts | — | S07 |
| S05 | INPUT-ONEDRIVE: needs your Entra SPA registration, client ID, redirects, account type and test accounts | — | S07 |
| S07 | Depends on S04/S05 and the provider inputs | — | GATE-F05, F06 |

### Blocker escalations
| S | Class | Action / human ask | Disposition |
|---|---|---|---|
| S06 r8 | crashed: provider usage-limit terminal (prior run) | Preserved CP2 work (digest 8f1d941bd9ad); fresh recovery2 under unchanged lease r4 | cleared |
| S06 CP1 | intermittent gate counterexample | Held acceptance; r9 root-caused it with a regression that fails deterministically | closed 7e785e4 |
| S04/S05 | protected human input | Provider registrations (see Blocked) | open, human |

### Interim Archivist checks
| After wave | Sessions received | Result | Drift found | Actions |
|---|---|---|---|---|
| — | — | none this run (7 sessions total; planning review was completed in earlier runs) | — | — |

### Lease violations
none (all 8 S06 commits since 9f0ef04 checked with `git show --name-only` against the 71-path lease r4)

### Checkpoint shortfalls
none. Handoff says 4; git shows CP1–CP4 plus 4 correction commits.

### Wave plan corrections
none

### Granularity feedback for Planner
S06 took nine attempts (r1–r9). They were caused by lease seams (r2–r4), missing Author mappings (r5, r7), one context exhaustion on CP1 (r6) and one provider terminal (r8), not by bad checkpoint boundaries. The prescribed selector `tests/unit/queries/history.test.ts` does not exist (history tests are in `tests/unit/queries/records.test.ts`). CP1 was very large (44 files); a future graph-contract session should split codec/candidate from evidence replay.

### Process effectiveness
First-dispatch completion this run: 1/1 (r9 accepted without redispatch). S06 overall: 0/1 first-dispatch; 3 controlled lease revisions (same session), 3 Author clarifications (91ad694, 17a73ae, 8c303fd), 1 held-then-corrected checkpoint (CP1). Environment failures: r8 provider usage limit. Integration rework after acceptance: none.

### Capability completion
- **Verified:** CAP-05, CAP-39, CAP-40 (including the nonempty V2 extension), CAP-42, CAP-44; CA-34/35/37/41 verified for their current scope; CA-36/40 verified for local/bundle, cloud part pending S07.
- **Blocked:** CAP-43 (provider connection/automatic backup: S04/S05/S07 + human inputs).
- **Planned:** CAP-45 (egress/lock isolation: S07 CP1/5, J6 does not need credentials but is sequenced in S07); CAP-41 cloud extension (S07).
- F05 is **not complete**.

### Follow-up closure ledger
| Source | Entry (verbatim) | Disposition |
|---|---|---|
| S06 r2 needsOwnerCorrection | “correct SESSION-06 CP1 item 6 and STATE’s corresponding mapping to preserve existing genesis enforcement, add frontier-boundary regression coverage, and implement missing basis coverage” | closed: prompt corrected in the prior run; basis coverage landed 084ecf9 |
| S06 r3 needsOwnerCorrection | “Mechanical owner seam; Orchestrator should issue lease r3 adding” records-crud/gate-f02-demo | closed: lease r3; consumers adapted 250c9e0/fccc345 |
| S06 r4 needsOwnerCorrection | “Issue lease r4 adding tests/browser/worker/runtime.ts” | closed: lease r4; landed 084ecf9 |
| S06 r5 needsOwnerCorrection | “bounded Author clarification in program/sheaf/specs/database.md: supply the original conflict/merge payload maps…” | closed: 91ad694; implemented 084ecf9 |
| S06 r6 surprises | “Root lint scans Orchestrator’s recovery copies outside the TypeScript projects.” | closed: recovery copies archived as tarballs |
| S06 r7 needsOwnerCorrection | “DB/Author and Planner must specify authoritative origins or a compatibility disposition” for baselines | closed: 17a73ae + 8c303fd; implemented 084ecf9 |
| S06 r2–r7 followUp | “All four implementation checkpoints and candidate/installed/J3/J1 proofs remain pending” (and equivalents) | closed: 2d8ff2d, independently verified |
| S06 r9 followUp | “Orchestrator should decide whether component-level quota proof is enough for the CP3 ‘quota refusal’ item.” | decided: accepted for CP3 (Chromium ignores the CDP quota override). **Carried** as debt: real-browser quota refusal, to be owned by S07's J6/security harness if a working quota mechanism exists |
| S06 r9 followUp | “The planned tests/unit/queries/history.test.ts should be dropped from the gate or replaced by records.test.ts in a lease revision.” | closed: substituted in the installed gate (decisions.md); SESSION-06 is complete, so no lease revision was needed |
| S06 r9 followUp | “S07 should consume the landed symbols above and the arch fragment…” | closed: fragment integrated 71e3adc; symbols recorded in CA-35/41 for S07 |
| S06 r9 followUp | “Possible performance follow-up (not a defect): isBackupHeadPinned now exports the full graphs of other roots and pins on every edit.” | **carried** to S07 (owns backup-handlers/home-state composition next) for a measure-first review |
| S06 r9 surprises | Scheduler compacts only when idle, not during active imports; defers if a command or save is in flight | retired: intended behavior, matches SESSION-06 CP3 |
| S06 r9 surprises | handlers.ts large diff from dedenting dispatch | retired: cosmetic |
| Prior-report follow-ups | see preserved section below | unchanged except S06/graph rows, now closed above |

### Archivist's Note
{pending final Archivist}

---

## Preserved prior continuation report (13cfbbc)


**Current outcome: blocked/incomplete feature; S01, S02 and S03 accepted.** The approved save-confirmation and reminder recommendations are implemented and independently verified. Users can create a separate vault, save a complete current-format encrypted bundle, explicitly confirm an unobservable save after delivery, reopen truthful backup status, and dismiss persistent scratch reminders on the approved schedule. This supersedes the blocked policy boundary reported at4cf629a. It does not claim cloud qualification, compaction, OS-native durability, F05 demo approval or permission to start F06.

## Delivered and accepted

| Session / work | Commits | Current acceptance |
|---|---|---|
| S01 vault crypto and authenticated publication contracts |694c741,13e83f1,8674766|3/3; bounded publication correction subsequently c7e6507|
| S02 atomic home/pin retention and current graph |03ee571,c7e6507|Current producers, covered chain/provenance, bounded encoding/hash/export and lifecycle|
| S02 complete save confirmation |partiald75830d, fullCP3a93a87c|Native observed write/close or delivered bundle followed by explicit “I saved this bundle”; failure/cancel never confirms|
| S02 mounted journey, reset/countdown, vault-only recovery |7b1bb58,f978eb3,7ee5ce8|6/6 accepted after corrections below; actual workers/ports/IndexedDB and same-context restart|
| Receipt and hydration corrections |2cd5ad4,823012b|All locally held device frontiers counted; concurrent readers share hydration and visit writes; deterministic negative regressions plus real import proof|
| S03 reminder producer and no-op correction |59caafb|Unchanged schema/chart requests create no commit; accepted authored trigger written atomically with encrypted catalog|
| S03 dismissal, escalation and restart |a016752|Actual worker-clock proof, precise10m/1h/24h/repeateddaily, persistent badge, no-op/stale/duplicate guards|
| S03 consistent status and accessibility |d8b4e14,47a633b|4/4 accepted; scratch/bundle status/remedy across shell/frame/home/settings/detail/reset, preserved-value copy and old-journey compatibility|
| Vault, save and reminder design sources |58bffc8,4c31ded|Approved scoped mocks; existing mocks preserved|
| Provider presentation fill |98ee79c|Detailed selection/authorization/reconnect/quota/disconnect states; design only, registration/application proofs separate|

Key APIs: independent VaultCryptoPort; authenticated DurableHomePort; bounded BackupAppGraphV1/ProjectionAuthoredStatePort and streaming hash/CBOR; data↔IO bundle transfer and FileSavePort; readAppDurability and receipt-relative count; inflight AppSessionRegistry.open; scratchReminderSchedule/dismissScratchReminder/backupFreshness; getScratchReminder/dismissScratchReminder; honest schema unchanged outcome; shared reminder machine and status selector. Exact files and commits are in STATE handoffs. Orchestrator wrote no application code.

## Verification and limits

Current implementation revision **47a633bde5528de15e0d7bf274f733bf7f4e7159**. Orchestrator independently ran:

- `pnpm typecheck` and `pnpm lint`: exit0.
- `pnpm test`:223 files, **2461 passed /3 inherited skips**, exit0.
- `SHEAF_PW_PORT=8081 pnpm exec playwright test --project=e2e --project=browser bundle-backup recovery-countdown sync/bundle scratch-reminders backup-status --workers=1 --global-timeout=900000`:5 files, **11 passed**,0 skips/retries, exit0; fresh build/strict port/no reused server.

The11 cases exercise vault-only full current graph recovery, malformed/interrupted output, both save destinations and receipts after page replacement, local recovery countdown, consistent backup facts, real-worker clock bridge, page-only-clock negative control, every dismissal deadline across replacement, separate real-clock edits, authored families/home assignment suppression, and responsive/keyboard/axe behavior. Build IDs, configuration/source inventories, served data-worker assets and saved artifact hashes checked at receive. Coder's **full end-to-end suite81/81passed**,6.7m, ran against source identical to47a633b; recorded changed-source/config digests were checked. Root did not repeat that slow full suite, but independently reran all due composed capability gates above. No build substituted for typecheck or browser proof.

Unit persistence uses production handlers/commands/crypto/SQLite over fake-indexeddb. Browser proofs use actual production workers, MessagePorts and browser IndexedDB; native-save destination remains a writable-handle fixture, not OS-picker durability. Download delivery is real. S03 reported37 inspected screenshots and36 axe variants at320/600/900/1200; root inspected compact-phone reminder and desktop stale-home output, plus earlier save/design samples. Two inherited layout issues are carried below, not hidden by a full visual-parity claim. Existing >500kB chunk warning remains. No provider registration/account/credential was supplied, no live provider was contacted, and no external publication/deployment occurred.

The r9 S02 receive failed sync/bundle at7ee5ce8 despite a claimed pass. Acceptance was withheld;823012b closed the actual concurrent hydration/visit cause with failing-before deterministic tests and independently passing real import/artifact checks. S03's inherited no-op producer defect was assigned and fixed59caafb, not masked in the reminder layer. ERR_NETWORK_CHANGED during an earlier S03 page replacement remains recorded as environment failure; final and independent runs passed unchanged timeout/retry policy. A320px sticky-toolbar interception was corrected47a633b with original journey assertions retained.

Ignored evidence is not the completion artifact. Evidence was consumed at receive and the exact outcomes are recorded here and in committed STATE; scratch retains raw handoffs, diagnostics and source inventories for recovery.

## Remaining input, owner and acceptance conditions

| Obligation | Supplier / implementation owner | Required closure |
|---|---|---|
| GRAPH-CONTRACT nonempty retained/conflict/audit format |DB/Author supplies exact protected contract; S06 CP1/2/4 implements and proves|User approved typed authenticated retained refs and bounded conflict/audit direction. Still require exact local scope/kind/descendant/covered-chain/version/backward-reader specification, then positive nonempty writer/reader/publication, two-compaction history/restore/restart and J3/J1. No Spec/DB worker or protected edit was dispatched.|
| Dropbox registration and live account premises |Human public registration/redirect/account supplier; S04 qualification, S07 integration|AppFolder scope/discovery/isolation/CORS/exact CAS/readback with authorized test accounts; no secrets in report.|
| OneDrive registration and final-write premise |Human Entra SPA registration/redirect/account supplier; S05 qualification, S07 integration|Same plus demonstrated final-publication conditional-write guarantee; unresolved premise cannot enable provider.|
| Provider scheduling/status/egress |S07 CP1–5 after named predecessors|Real configured IO adapters, selected-provider CSP/fetch guard, discovery/selftests for credential-free local security J6, offline/restart/manual/autobackup J4 and live J5. Local security proof remains required even if credentials absent.|
| F05 demo and next-feature gate |S07 prepares; human gives verdict|Current-built setup/import/edit→vault/bundle/save/reopen/recover; reminders/status; compaction/history/restore→new bundle; account isolation/CAS/offline/egress. No verdict inferred from trust in recommendations.|

DEC-71 and DEC-72 no longer need human answers. Exact protected graph specification and external provider inputs are not inferred from approval of their recommended direction. Required obligations retain producers and proof checkpoints; blocked work is not completion.

## Orchestration

**Concurrency:** Native demiurge binding, cap3. One Coder active at a time from dependency/shared-resource constraints; disjoint S02r7 and reminder-clock Planner launched before collection. No binding change, shell worker processes, live lease changes, interrupts or worker budgets. Native transport timeouts reattached to original handles.

**Sessions run:**3 of7 Planner sessions;13 Coder launches total (S01×1,S02×10,S03×2). **Checkpoint-labelled Coder commits:**14 from git:13 complete checkpoints plus the preserved partialCP3d75830d; additionally2 explicit S02 correction commits. These totals do not count Designer, Planner, orchestration or arch commits as Coder checkpoints.

**Wall clock:** prior measured initial segment114.1minutes (first dispatch2026-09-24 20:51:19 CDT through2026-09-25T03:45:25.910931Z). Continuation timing only where recorded: S02r10 launch04:59:41Z→received05:10:53Z; S03r2 launch05:12:10Z→received05:17:06Z; S03r3 launch05:17:36Z→received06:08:27Z. These include verification/receive time and are not hands-on estimates. Some early continuation dispatches have no timestamp; no duration invented. Final close timestamp appended after Archivist.

### Wave plan as executed

| Wave | Sessions | Notes |
|---|---|---|
| Initial preflight/W1 |Archivist→replan; S01 + vault Designer|Initial planning correction5e38ca7; source-disjoint launches before collection|
| Initial W2r1–r6 |S02 six attempts; quiet graph replan/Archivist|Three lease amendments and graph split; CP1/2 and partialCP3; initial report4cf629a|
| Approval preparation |save/reminder Designer→approval Planner→scoped Archivist|Approval27e9a34, design4c31ded, plan9749c76, findings assigned|
| resume-1 |S02r7 + reminder-clock Planner|Both launched before waits; fullCP3a93a87c; plan37303ce|
| resume-2 |S02r8|No code; execution shortfall, fully received|
| resume-3 |S02r9|CP4–6 committed; independent import failure blocked acceptance|
| resume-4 |S02r10|823012b negative regression and required gates; S02 accepted|
| resume-5 |S03r2|CP0 no-op producer counterexample; no code; precise lease amendment|
| resume-6 |S03r3|All4CPs accepted;11browser/current2461unit checks|
| Quiet provider fill |DESIGN-F05-PROVIDER-STATES|Already-approved missing presentation detail; no Coder concurrent|
| Final |Archivist continuation final pass|Report assembled first; no active Coder/pending receive|

### Blocked

| S | Reason | Last checkpoint | Dependents stalled |
|---|---|---|---|
| S04 |INPUT-DROPBOX|0/3|S07|
| S05 |INPUT-ONEDRIVE|0/3|S07|
| S06 |exact DB/Author GRAPH-CONTRACT; S02/S03 prerequisites now satisfied|0/4|S07|
| S07 |S04/S05/S06 contracts and proofs|0/5|F05 acceptance/F06 gate|

### Blocker escalations

| S / area | Class | Action | Disposition |
|---|---|---|---|
| Initial preflight |missing readers/tests/discovery owners|replan5e38ca7|plan closed; S06/S07 future proofs owned|
| S02 initialr1–r4 |append writer, bounded shared API, incremental primitives, future graph mapping|lease9466660/760dae1/3093131 + replanf1eae46|current graph closedc7e6507; exact nonempty Author/S06 remains|
| DEC71/72 + graph direction |product recommendations|user trust approval27e9a34; design4c31ded and replan9749c76|policies implemented/proved; exact graph format still supplier-owned|
| S03 clock harness |missing concrete actual-worker proof mechanism|replan37303ce|implemented/proveda016752/47a633b|
| S02r7/r8 |context terminal then execution shortfall|same lease recovery, no product question|CP4–6 landed; S02accepted823012b|
| S02r9 receive |required integration regression|withheld done, same-context r10 correction|closed823012b, independent proof|
| S03 compatibility |five missing old-journey test leases|controlledr2 amendment50aed81|assertions preserved, full81pass|
| S03r2 |inherited command no-op producer gap|controlledr3 amendment0634e89, six exact paths|closed59caafb, no history rewrite|
| DF-F05-1 |missing scoped designs|vault, save/reminder, provider fill workers|provider design accepted98ee79c; application cloud proof stillS07|
| INPUT providers |unavailable external registrations/accounts|retain supplier and S04/S05/S07 owners|blocked, not waived|
| AR-1 transcript |source grammar unavailable|program/demiurge/specs/database.md absent; existing blockquote convention retained|carried Orchestrator/Archivist until source supplied; noncritical|

### Interim Archivist checks

Seven sessions: no recurring interim checks required. Initial planning AO787 and affected graph AJwdH preserved. Approval review AO6jT read-only identified actual-worker clock mechanism and stale architecture policy summaries;37303ce and70f640c/8c8a53d closed assignments before S03. Final Archivist initial pass5959ca4 retained historically; continuation final return appended below once. No Archivist concurrent with Coder.

### Lease violations

None in accepted Coder/Designer/Planner commits. Every checkpoint commit path checked against its active lease; S03's58 unique paths inside r3. Shared human edits preserved. Initial failed attempt to stage ignored arch scratch produced no commit. M05/M47 pre-existing untracked seeds were preserved; accepted deltas went into separately tracked F05 files.

### Checkpoint shortfalls

S02r7 explicitly stopped after fullCP3 on context exhaustion; r8 made no progress despite no external blocker. Both received honestly, recovered within same session. S02r9 claimed done but root required-gate failure blocked acceptance;823012b closes it. No fewer checkpoint commits than a finally accepted checkpoint claim. S03r2 declared CP0 ownership blocker with no edits, corrected before resume. No unreceived patch or unfinished checkpoint remains.

### Wave plan corrections

S04/S05/S06 source leases disjoint but shared dist/build and Playwright outputs collide; retain serialized reservations unless a reviewed isolation plan is supplied. Different ports alone are insufficient. Five exact compatibility specs and six no-op producer/mapping/test paths were added to S03 only after prior worker ended and S02 released its lease; no active overlap.

### Granularity feedback for Planner

Initial S02 repeated transitive prerequisite returns established recurrence within one cycle. Continuation added S03 actual-worker clock specification, five old-journey lease gaps and command no-op producer gap. Trace command writer→atomic state→UI acknowledgement→test harness and all accepted mutation paths before dispatch. S02r7 exhausted context afterCP3; r8 had an execution shortfall, not a planning blocker. Recovery completed without checkpoint re-slice. No turn/token ceiling was imposed. No elapsed wait timeout was treated as a worker failure.

### Process effectiveness

First-dispatch completion: **1/3** Planner sessions dispatched accepted without redispatch/unplanned correction (S01). **8 unplanned planning/ownership corrections:** initial preflight, append lease, bounded API lease, streaming primitive lease, graph split replan, reminder-clock replan, S03 compatibility lease, S03 no-op producer lease. Affected CAP05/39/40/41/42/44/45 as assigned in STATE. Five mechanical lease amendments retained ended-worker context; three broader assignments used Planner. Approval reconciliation and scoped design fills follow newly approved/fixed inputs and are counted separately, not hidden as implementation failures.

Integration rework after earlier acceptance: S02CP2 c7e6507 corrected S01's eager shared graph contract (CAP40/future44). Before final S02 acceptance,2cd5ad4 corrected multi-device count and823012b corrected hydration/visit concurrency exposed by mounted composition; both relevant negative regressions preserved. S03 no-op correction addresses inherited command semantics, not a newly invented reminder policy. Product input absence, one environment network event, context terminal and execution shortfall are separate categories. No provider capacity failure reported.

### Capability completion

| CAP | Current status | Remaining owner / proof |
|---|---|---|
|05 inherited|verified47a633b countdown/replacement-passphrase path|none for this inherited obligation|
|39|verified current create-vault/attach/recovery/J1|none for current capability|
|40|current-producer complete bundle/confirmation/recovery verified|required positive nonempty extension DB/Author+S06CP1/2/4|
|41|scratch/bundle surface consistency verifiedd8b4e14/47a633b|cloud extension S07CP2–4/J4|
|42|verified59caafb/a016752/47a633b|none for required reminder behavior|
|43|blocked external inputs and adapters/composition|S04/S05/S07 live qualification/J4/J5|
|44|blocked exact protected graph contract|DB/Author+S06J3/J1|
|45|IO lifecycle contribution landed; provider/egress/security incomplete|S07CP1/5,J4/J5/J6; live inputs separate|

### Follow-up closure ledger

Historical raw entries below are verbatim from the first receive records. Their earlier disposition prose is historical; the current closure table immediately following them supersedes policy/pending claims. No handoff text is rewritten.


Every received Coder/Designer `surprises` and `followUp` entry is reproduced verbatim below; grouped obligations retain individual owners. Planner follow-ups are included separately. Historical claims remain verbatim even when later corrected.

#### F05-SESSION-01.result.md

> - **surprises:** Lease r1 used throughout. Corrected a boundary-test false positive for imports between ports. Self-review added exact head readback and cancellation checks. A newer concurrent head during readback conservatively rejects confirmation. Vite reports chunks above 500 kB. No outside-lease source changes caused.

> - **followUp:** Orchestrator must update CA-34/35/38 mappings before consumer dispatch. S02 owns authenticated descendant extraction, independent authored-state reconstruction, complete bundle assembly, save receipts and J1 restart proof. S06 owns compaction/J3. S04/S05 own live provider qualification; S07 owns account-bound composition and lifecycle integration. DEC-71/72 remain with their existing owners. Architecture delta: [F05-SESSION-01.arch.md](/Users/the.phoenix/WebstormProjects/sheaf/.program/signal/F05-SESSION-01.arch.md). No server started.

**Closed:** CA mappings and arch5d73ba2/3a06d30; current descendant reconstruction c7e6507, native assembly/receipt d75830d. **Carried:** S02CP4/6 J1/recovery, S06CP1–4 nonempty compaction/J3, S04/S05 live qualification, S07 account/lifecycle/egress, human DEC71/72. Large-chunk warning carried to S07 final verification and Planner performance follow-up; no size redesign authorized.

#### F05-SESSION-02.attempt1.result.md

> - **surprises:** CP1 names immediate deletion in `createEventStore`, but `appendTable` independently deletes `target.headStorageId` in [append.ts](/Users/the.phoenix/WebstormProjects/sheaf/src/import/staging/append.ts:370). Production `appendIntoApp` supplies that current head and calls this writer directly; it then closes the app session. The existing [append test](/Users/the.phoenix/WebstormProjects/sheaf/tests/unit/staging/append.test.ts:222) explicitly asserts that the old head disappears. Neither file is leased.

> - **followUp:** Resume CP1 after owner correction. Required regression: pin the current head, append a CSV through the production append path, verify the pinned graph remains readable while the current head advances, then verify safe release/cleanup. Preserve the existing unpinned deletion and rejected-append no-change assertions. Related constraint: existing cleanup reasons are import-only, and `sweepStaleImports` treats every active workflow as an import; backup retention must not register incompatible tickets/workflows there. DEC-72 and save-design prerequisites remain unchanged for later checkpoints; they are not this immediate blocker.

**Closed:** r2 lease9466660 and CP1 retention/import separation03ee571, checked119tests. **Carried:** DEC72 human → Designer → S02 fullCP3/4.

#### F05-SESSION-02.attempt2.result.md

> - **surprises:** S02 requires bounded snapshot loaders, explicitly excluding holding all ciphertext in memory. However, [BackupAppGraphV1](/Users/the.phoenix/WebstormProjects/sheaf/src/application/ports/backup.ts:30) requires an array containing every object’s bytes. [buildPublicationCandidate](/Users/the.phoenix/WebstormProjects/sheaf/src/sync/protocol/publication.ts:108) clones that entire graph; `verifyGraph` retains every decrypted payload; candidate storage and `readPublicationCandidate` clone complete object collections again. Sequential store reads cannot resolve this downstream accumulation. This is source-backed evidence, not a measured peak-memory result.

> - **followUp:** Correct the shared bounded-read contract before CP2 implementation. Preserve authenticated references, immutable snapshot identity, exact-byte publication, and existing rejection assertions. Add a multi-batch regression with a negative control detecting eager whole-graph loading. CP1 remains unimplemented; this return follows the checkpoint-0 inherited-prerequisite correction rule. DEC-72 and dependent CP3/CP4 boundaries remain unchanged.

**Closed:** r3 amendment760dae1 and bounded/current-producer CP2c7e6507 with eager negative control. **Carried:** protected fallback and full UI proof to human/Designer/S02.

#### F05-SESSION-02.attempt3.result.md

> - **surprises:** CP2’s shared hashing/encoding dependencies remain one-shot: `sha256(Uint8Array)` and `encodeCanonical` require complete buffers. The installed libsodium exposes incremental SHA-256, but Sheaf has no corresponding public adapter. Architecture routes durable hashes through M08 and canonical representation through M09. The ignored architecture fragment could not be staged; its documentation commit failed with an unmatched pathspec. It remains available for Orchestrator. An accidental empty `/tmp/sheaf-bounded-note` was immediately removed.

> - **followUp:** Resume CP2 after the bounded primitive amendment below. The r3 publication/frontier correction remains S02-owned. DEC-72 and dependent save/UI design boundaries remain unchanged; CP3–6 and J1 are unverified. No pending implementation changes require recovery.

**Closed:** r4 amendment3093131, incremental primitives/byte tests c7e6507; failed scratch stage produced no commit, archc25742f consumed. **Carried:** S02CP3–6 remaining obligations (native partiald75830d delivered); DEC72/Designer unchanged.

#### F05-SESSION-02.attempt4.result.md

> - **surprises:** `StorageRefV1` contains only `storageId` and `semanticSha256`; `AppHeadV1.retainedRoots` uses that type. Envelope scope is absent from the encrypted frame and must originate from an authenticated parent. No approved mapping supplies it for arbitrary retained roots. Concrete conflict/audit page descendant codecs are also absent. Current producers emit empty branches, but that does not prove CP2’s required nonempty graph traversal. Publication and projection port changes remain proposed, uncommitted contracts.

> - **followUp:** Preserve the recovery inventory below. After the bounded contract correction, finish retained-root and conflict/audit traversal, cursor-port coverage, exporter key disposal across worker lifecycle/cancellation, and remaining graph proofs before committing CP2. Future S06 producer proofs remain separate. DEC-72, dependent save/UI checkpoints, and J1 remain gated. Proposed architecture delta is preserved in the ignored fragment; it is explicitly marked unaccepted.

**Closed:** preserved patche724c8b… and scoped replanf1eae46 resolve ordering; cursor/lifecycle/current graph c7e6507, arch5a977e6 consumed. **Carried:** nonempty retained/conflict/audit layout supplier DB/Author after humanGRAPH-CONTRACT; implementation and positive proof S06CP1/2/4. S02CP4/6 J1/recovery remains. Earlier claim that future branches must block current-producer CP2 is retired by explicit replan boundary, not by omitting required future assertions.

#### F05-SESSION-02.attempt5.result.md

> - **surprises:** A failing restoration regression exposed provenance loss from matching decoded field IDs by object identity. Canonical byte-ID lookup fixes it; the regression now passes. All 26 committed paths are within r5; outside changes remain untouched.

> - **followUp:** CP3 native-save implementation remains independently implementable and was not completed in this return. DEC-72 and Designer save-outcome coverage still gate the fallback and CP4. S06 owns future nonempty graph mappings and positive proofs after GRAPH-CONTRACT. CP3–6 and J1 remain unverified.

**Closed:** provenance regression c7e6507; independent native continuation d75830d. **Carried:** humanDEC72 → Designer outcome coverage → S02 fullCP3/CP4–6/J1; human/AuthorGRAPH-CONTRACT → S06 nonempty proofs.

#### F05-SESSION-02.attempt6.result.md

> - **surprises:** Transport testing exposed an unhandled rejection in an incomplete save double; corrected before acceptance. Pending-transfer disposal now explicitly rejects instead of abandoning its promise. Build reports the existing large-chunk warning but succeeds. No unrelated files changed.

> - **followUp:** Orchestrator should retain partial-CP3 status. After DEC-72 and Designer outcome coverage arrive, S02 completes fallback behavior and full CP3 acceptance, then CP4’s real-entry J1. CP4/5 still own receipt/count/status readers; CP6 owns interrupted-operation recovery and complete artifact recovery. Interrupted or rejected operations retain encrypted pins for recovery/release. S06’s nonempty-graph obligations remain separate.

**Closed:** save-double rejection and pending disposal corrected in d75830d; component/full closing checks pass. **Carried:** partialCP3 retained; humanDEC72/Designer/S02 fullCP3 thenCP4J1, CP4/5 readers/status, CP5countdown, CP6 interrupted pins/artifact recovery; S06 nonempty graph. Existing build-size warning owned S07 verification/Planner performance follow-up.

#### DESIGN-F05-VAULT.result.md

> - **surprises:** Browser CLI stalled; completed verification with Playwright. No design-policy deviations.

> - **followUp:** SESSION-02/07 can consume these scoped designs. Orchestrator/Designer retains reminders, saved/cancelled/failed/unconfirmed outcomes, and provider authorization/reconnect/disconnect. DEC-71/72 remain unresolved; this fill does not clear those checkpoint gates.

**Closed:** design validation completed with Playwright58bffc8 after CLI stall, no policy deviation. **Carried:** remaining reminder/save/provider detailed designs to Orchestrator/Designer after respective fixed inputs; implementation S02/S03/S07. DEC71/72 remain human choices.

#### Planner follow-ups

> **Follow-up:** Orchestrator refreshes its ledger, rechecks corrected planning dispositions and clears PLAN-REVIEW before affected dispatch. All implementation/proofs remain planned or blocked. No code, builds, implementation tests or provider calls executed; no workers spawned. Historical records and pre-existing outside changes were preserved.

**Closed:** REPLAN-F05-PREFLIGHT receive0f7c68c; exact leases/DAG verified and implementation owners retained.

> **Resume:** Orchestrator rechecks the amended plan and lease, then resumes preserved S02 CP2 after accepted CP1 `03ee571`. Cursor coverage, production key disposal/cancellation, and complete current-graph proofs must pass before committing CP2. J1 remains unverified.

**Closed:** REPLAN-F05-GRAPH scoped review2b6522e, current-producer CP2c7e6507. **Carried:** J1 S02CP4/6; protected graph mapping Author and positive extension S06 as above.


### Current disposition of initial follow-ups

| Source | Current disposition at continuation close |
|---|---|
|S01|**closed** CA mappings/current descendant/J1/recovery/readers atc7e6507/a93a87c/823012b; DEC71/72 approved27e9a34 and implemented. **carried** exact nonempty Author/S06, providerS04/05/S07, chunk warningS07 verification/Planner performance.|
|S02r1|**closed** retention03ee571 and fallback/J1a93a87c/823012b.|
|S02r2|**closed** bounded APIc7e6507 and fallback/J1a93a87c/823012b.|
|S02r3|**closed** streaming primitivesc7e6507, consumed arch, save/UI/countdown/recoverya93a87c/f978eb3/823012b.|
|S02r4|**closed** preserved current graph/cursor/lifecyclec7e6507 and J1823012b; **carried** exact nonempty contract DB/Author and S06CP1/2/4; scope split remains explicitf1eae46.|
|S02r5|**closed** independent native/fallback/UI workd75830d/a93a87c/823012b; **carried** nonempty contract Author/S06.|
|S02r6|**closed** fullCP3a93a87c, CP4/5/6 and independent current recovery823012b/47a633b; **carried** S06nonempty, S07/Planner chunk-size observation.|
|Vault Designer|**closed** vault/save/reminder detail58bffc8/4c31ded and DEC71/72; provider design disposition recorded below; **carried** provider application S07.|
|Initial Planner follow-ups|**closed** current producer/gatesc7e6507/823012b; **carried** exact nonempty mapping Author/S06.|

### Continuation handoffs — verbatim follow-ups and current dispositions

#### DESIGN-F05-SAVE-REMINDERS

> - **surprises:** Provider authorization/reconnect/disconnect designs remain adjacent DF-F05-1 gaps outside this envelope.

> - **followUp:** SESSION-02 can consume the save design for CP3/4; SESSION-03 can consume reminders for CP1/2. They retain responsibility for actual save receipts, persisted scheduling, and J1/J2 proofs.

**closed** save/reminder inputs4c31ded, implemented S02a93a87c/823012b and S03a016752/47a633b; provider fill separately recorded below.

#### REPLAN-F05-APPROVAL

> - **surprises:** Current no-picker path returns `unconfirmed` without delivery, then bootstrap disposes the transfer. The complete correction and lifecycle tests are explicitly assigned to S02.

> - **followUp:** Orchestrator receives this commit, refreshes operational records, requests scoped Archivist planning-completeness review, then resumes S02 full CP3 under its unchanged lease.

**closed** scoped review8c8a53d, current no-picker correctiona93a87c and J1823012b.

#### REPLAN-F05-REMINDER-CLOCK

> - **surprises:** Durability fixture is a future S02 output. Existing S03 ownership covers its extension and browser tests; `LEASES.json` remains unchanged.

> - **followUp:** Orchestrator reconciles STATE’s VB-02/J2, CAP-42, CA-37, and finding disposition. After fully receiving S02 r7, recheck landed worker/bootstrap/protocol/fixture contracts before S03 dispatch. S03 CP2 implements and proves the mechanism; CP4 reruns J2.

**closed** recheck6223610 and actual-worker mechanism/proof a016752/47a633b; no future harness obligation remains.

#### F05-SESSION-02.attempt7

> - **surprises:** Worker double originally passed ports by reference, causing cancellation to stall; corrected to actual transferable-port semantics. Superseded stalled runs were terminated. Existing large-chunk build warning remains. Unrelated changes preserved; owned browser and preview stopped.

> - **followUp:** Resume S02 at CP4: authoritative receipt/count readers, vault creation/recovery UI, mounted routes, and actual-download/native-destination J1 with same-context reopen. CP5 retains reset consequences and CAP-05 countdown proof; CP6 retains interrupted-pin and complete vault-only artifact recovery. S06 nonempty-graph proofs remain separate. Architecture delta is `.program/signal/F05-SESSION-02.arch.md`.

**closed** port-double correctiona93a87c and CP4–6 acceptance823012b; arch9850d14 consumed. **carried** nonempty Author/S06; chunk warningS07 verification/Planner performance.

#### F05-SESSION-02.attempt8

> - **surprises:** No external prerequisite or lease blocker established. This attempt did not fulfill the requested implementation.

> - **followUp:** S02 still owns CP4 home/vault RPC and mounted UI, receipt-relative readers, and J1; CP5 reset/status integration and CAP-05 countdown; CP6 interrupted-pin handling and complete vault-only artifact recovery. CAP-39/40/41 and applicable CA-34/35/36/37/40 integration proofs remain incomplete.

**closed** execution shortfall via r9 implementation and r10acceptance823012b; no fabricated external blocker.

#### F05-SESSION-02.attempt9

> - **surprises:** Self-review exposed CA-36 undercount across multiple locally held device frontiers: regression reproduced **1 instead of 3**, then passed after `2cd5ad4`. Countdown negative controls failed both intended cases against the old implementation. Temporary unrelated port occupation resolved without intervention. Browser harness navigation-before-unlock race corrected. Existing large-chunk warning remains. Native destination is doubled; no OS durability claim is made. Pre-existing configuration, roadmap, and architecture changes preserved.

> - **followUp:** S03 owns CAP-41 consumer/reminder integration and J2; S06 owns nonempty conflict/audit/retained-graph extensions and J3/J1 reruns. Crash-retained pins remain conservatively recoverable through worker `exportGraph`/`release`; no blind startup sweep or restored confirmation authority. Existing-home adoption remains future work. Inherited empty-library unavailable copy remains outside this lease.

**closed** all-device count2cd5ad4, countdownf978eb3, receive counterexample823012b, S03reminder/status47a633b. **carried** nonempty Author/S06; conservative retained pins and existing-home adoption F06 Planner/M33; inherited empty-library unavailable copy F06 Planner/M42; OS-picker qualification S07 release verification; chunk warning S07/Planner.

#### F05-SESSION-02.attempt10

> - **surprises:** The concurrency defects existed before CP4; source comparisons confirm unchanged implementations at `a93a87c` and `ee34258`. CP4’s receipt await exposed the disposed-projection failure; it was treated as a regression, not waived. An initial nonexistent test selector was corrected. Temporary trace extraction was removed before final lint. Native destination remains doubled; no OS durability claim.

> - **followUp:** Orchestrator can close the r9 receive counterexample using this evidence and consume the [architecture delta](/Users/the.phoenix/WebstormProjects/sheaf/.program/signal/F05-SESSION-02.arch.md). S03 retains J2/consumer integration; S06 retains nonempty graph extensions and J3/J1 reruns. Pre-existing program and architecture changes remain untouched.

**closed** concurrent hydration/visit regression823012b, architecture8876404, current STATE5333da8 and S03J247a633b. **carried** nonempty Author/S06 and native OS qualification S07; pre-existing human changes preserved.

#### F05-SESSION-03.attempt1

> - **surprises:** `executeSchemaChange` unconditionally commits prepared drafts; `SchemaApplyResultV1` requires a commit for successful application. `saveChart` unconditionally calls `commitSave` after validation. Suppressing reminders downstream would leave the prohibited authored commits intact. Initial diagnostic attempts exposed the zero-draft exception and an invalid assumption about the imported theme; neither was counted as passing evidence.

> - **followUp:** Orchestrator should issue a bounded correction and replacement lease, then resume CP1. Preserve S02’s accepted receipt/concurrency behavior. S03 retains all four checkpoints, J2, status integration, accessibility, and full-suite acceptance.

**closed** exact r3 amendment0634e89 and command-layer no-op correction59caafb with preserved stale guards/reopen counts; full S03proof47a633b.

#### F05-SESSION-03.attempt2

> - **surprises:** Fixed an owned 320px sticky-toolbar interception exposed by full integration. An earlier browser run encountered `ERR_NETWORK_CHANGED`; retained in evidence, without increasing timeouts or enabling retries. New schema `unchanged` outcome is mapped through command, protocol, handler, route and VM. Legacy absent provenance retains existing import wording.

> - **followUp:** Orchestrator should consume the architecture delta and update STATE. S07 retains cloud/provider status and J4 proofs; S06 retains nonempty graph/publication and J3 proofs. Unrelated inherited visual issues remain with M46 (`schema.module.css`, cramped 600px Settings rows) and M39 (`app-shell.module.css`, clipped 900px rail branding). Pre-existing changes preserved.

**closed** reminder/status acceptance6223610, arch27dd483,320px interception47a633b, independent11browser2461unit; earlier network event superseded by relevant unchanged-configuration passes. **carried** cloud status/J4S07, nonempty graph/J3Author+S06, inherited600pxSettings layout M46 and900pxrailbranding M39 for next Planner UI maintenance assignment. Legacy absent provenance preserves existing contract; no invented attribution.

#### DESIGN-F05-PROVIDER-STATES

> - **surprises:** Automation stalls recorded; fresh-session checks completed. Unrelated workspace changes preserved.

> - **followUp:** SESSION-07 CP2/4 can consume this design source. Provider registration, live qualification, and DB inputs remain separate prerequisites.

**closed** presentation gap98ee79c, exact2file commit and sample visual/source checked; automation stalls superseded by fresh-session checks. **carried** provider registration/live qualificationS04/05/S07 and exact graph inputDB/Author+S06. No application capability claim from mock.

### Working-tree preservation and completion condition

All accepted implementation is committed. Pre-existing PROGRAM-CONFIG.md and ROADMAP.md modifications and untracked architecture seeds remain untouched; no global clean-tree claim is made. Root will prove the report commit landed and show the residual status, not commit/reset unrelated work to satisfy an empty-status appearance. The committed report is a blocked/incomplete feature record; required obligations retain named suppliers and implementation/proof owners.

### Final receive, follow-up closure and duration

Continuation final Archivist3ea3606 reconciled25authorized documentation files; root checked every path and all20protected hashes. Current-summary follow-up is **closed** by STATEdc05efa: DEC71/72, approval review, VB02, CA37 producer/proof prose, CA40 countdown, seam preflight and graph resumption now match accepted47a633b/98ee79c. Historical handoffs remain verbatim. Architecture convention promoted complete prerequisite tracing at1cycle/7instances; broader report count8 also includes initial preflight. Framework recommendations retain stable IDs and their framework-maintainer owner. The212export CL03/05 classification brief remains **carried** to Planner, unaccepted; no removal is authorized. AR-1 grammar validation remains **carried** to Orchestrator/Archivist until its source exists.

No Coder/Designer/Archivist remains active; all receives, deltas and handles reconciled. All own implementation/orchestration documents are committed except this report, which is committed separately immediately after assembly. Pre-existing external changes remain as recorded. No retries or alternate models for final Archivist; wait timeouts reattached to the same handle.

Measured overall recorded wall-clock window: **279.7minutes**, from first dispatch2026-09-25T01:51:19Z to final receive/report assembly2026-09-25T06:31:02.396416+00:00. This includes the initial blocked boundary and continuation; it is not uninterrupted hands-on time. Earlier per-attempt recorded intervals above remain the only attributed durations.

### Archivist's Note

I’ll read the final-mode envelope and required record, then reconcile the permitted documentation and verify that protected files remain unchanged.


The report now accepts S02 and S03, while several architecture sections still describe their save, reader and reminder work as pending. I’m checking those sections against the landed code and keeping the nonempty-graph and provider obligations separate.


I found current-summary drift in STATE: the CA-37 heading still marks fallback and reminder proofs as planned, despite the accepted CA/CAP rows and later receive records. I’ll report the exact locations for Orchestrator to correct and leave STATE untouched.


The continuation adds three more prerequisite corrections: the worker-clock harness, five existing browser specs affected by reminders, and the no-op command producers. I’m checking the inherited convention against those cases and refreshing the registry from actual imports.


The source trace matches the accepted local behavior: receipts use app-scoped captured frontiers, pending counts cover all locally held devices, and reminders persist with authored commits. The registry also needs the new M33→M05 and M37→M05 imports. I’m consolidating these facts into the module sections and keeping the remaining graph, provider and security proofs explicitly assigned.


The documentation now distinguishes accepted local/bundle behavior from the remaining Author/S06 and provider/S07 work. I’m finishing the standing ledger, preserving recommendation IDs, and checking that every file outside the authorized documentation set is unchanged.


The reconciliation is complete. I found stale present-tense summaries in STATE and recorded their exact correction locations for Orchestrator. I’m checking the protected-file hashes before committing the 25 authorized documentation files.

Committed **`3ea3606`** — 25 authorized documentation files reconciled. Protected files and pre-existing changes remain untouched. No delegation or implementation tests were run.

## Archivist Note

- **role:** archivist
- **registryUpdated:** true — all 65 module rows checked mechanically from runtime imports.
- **reconciled:** 23 tracked architecture documents, including current module contracts, registry, boundaries and conventions; cleanup ledger updated.
- **conventionsAdded:** Complete prerequisite tracing now explicitly covers no-op producers, worker-clock proof mechanisms and affected existing journeys. Threshold: **1 cycle, 7 instances**.
- **proposedForFramework:**
  - Extend prerequisite tracing with those concrete checks — **1 cycle, 7 instances**.
  - Reconcile present-tense decision/baseline/agreement/preflight prose at receive — **1 cycle, 2 instances**.
- **logEntry:** Appended the dated continuation entry to [ARCHIVIST-LOG.md](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/ARCHIVIST-LOG.md), preserving historical entries and recommendation IDs.
- **verification:** Documentation checks passed; the 1,022-file inventory showed only the 25 authorized changes; all 20 protected external hashes matched.

S01–S03 acceptance is recorded without implying overall F05 completion. Exact graph inputs and S06 proof, provider qualification and S07 composition/security proof remain owned obligations. Credential-free J6 remains mandatory.

Stale STATE summaries are documented with correction locations and closure criteria in [F05-boundaries.md](/Users/the.phoenix/WebstormProjects/sheaf/program/sheaf/arch/F05-boundaries.md). Orchestrator owns those corrections; STATE was not edited.

### cleanupBriefs

- **title:** Prove or name every unconsumed export
- **targetArea:** `src/**`, existing CL-03/05 campaign
- **confidence:** Low for removal; high for measured textual absence
- **proposedPlannerTask:** Classify 212 exported declarations without outside-file textual consumers before planning visibility changes or removal.
- **requiredChecks:** Focused boundary, known-answer, worker and recovery checks; `pnpm verify` and affected browser/e2e assertions after approved implementation.
- **risks:** Dynamic, external and future consumers can escape textual searches.
- **status:** Briefed, not accepted; no implementation cleanup performed.

### standingRecommendations

Full open backlog; IDs preserved:

| id | pattern | cycles | instances | firstSeen | status |
|---|---|---:|---:|---|---|
| `442cb40af6e1a830` | Interim drift cadence remains size-based | 5 | 24 | F01 | open |
| `f1442f23b7f0949d` | Standard Archivist envelope omits cleanup-ledger ownership | 4 | 5 | F01 | open |
| `b027c25ef168decb` | Malformed STATE table rows lack detection | 1 | 6 | F02 | open |
| `06e04ece038e736d` | Unleased modules lack explicit fragment-update routing | 1 | 6 | F02 | open |
| `1c51a85390a3f964` | Shared rules discovered mid-run lack sibling notification | 1 | 1 | F03 | open |
| `242f2bb3c9d6af33` | Seed instructions should name the producing function | 1 | 1 | F04 | open |
| `abf5cf9b579e46b5` | First worker-tier proofs should assert exact counts | 1 | 1 | F04 | open |
| `941f0fdbdd02f2c4` | Trace complete prerequisites before redispatch | 1 | 7 | F05 | Convention promoted; framework refinement open |
| `52cdcf97581fa215` | Receive updates tables but leaves current prose stale | 1 | 2 | F05 | open |
