# ROSHI-LOG — Sheaf

Append-only. One dated entry per Roshi pass. Newest last.

---

## 2026-09-08 — final pass, cycle **F01 / foundation-first-unlock**

First entry in this log; there was no prior backlog to carry forward. Base
`f0b1ec4`, final `2c0248a6f1764a67695c761bcb5df4dfc5b27714`, specs `3b836f2`.
Read in full before writing: `.forge/FINAL-REPORT.md`, all seven
`.forge/results/SESSION-NN.result.md`, `.forge/results/ROSHI-PLANNING.result.md`,
`.forge/{roshi-notes,decisions,ledger,blockers}.md`, `STATE.md` end to end, all
nineteen `arch/` fragments, `PROGRAM-CONFIG.md`, and `git log` from `e8cf9c9`
forward.

### Planning-pass findings F-01..F-11 — all eleven closed, verified in code

Not taken from the replan's own report. Each checked against the tree at
`2c0248a`:

| # | Closure evidence |
|---|---|
| F-01 harness entry | `harness.html`, `src/harness/{main.ts,probe.worker.ts}`, `tests/browser/harness.smoke.spec.ts` exist; 5 specs green incl. the stale-artifact negative control and "the served page has no harness" |
| F-02 idle-timeout writer | `updateSettings` present in the request **and** response unions of `messages.ts`; handler at `src/workers/data/handlers.ts:395`; `SET_IDLE_TIMEOUT` wired in `session.machine.ts` (4 sites); e2e proves the value survives lock → full reload → new worker |
| F-03 primitives lease | `error-state`, `select-field`, `inline-link`, `busy-indicator` all present in `src/ui/primitives/` |
| F-04 `logicalRevision` | `src/persistence/envelope-store/frame-row.ts` exists and is the only row-literal constructor; CA-02 verified both sides (`acca5a8` / `f4382b3`) |
| F-05 delay threshold | `ATTEMPT_FREE_FAILURES = 5` in `src/workers/data/session.ts`; unit vector + one live 2s observation; e2e observes the delay at the 6th attempt |
| F-06 capability probe | thirteen ids in `src/platform/capabilities.ts` matching D14/AD-9 exactly; `tests/e2e/capability-gate.spec.ts` asserts each stubbed id is a `CAPABILITY_IDS` member |
| F-07 no-network | `tests/e2e/offline-guard.spec.ts` + `fixtures/no-network.ts`; deny-by-default proven to fire by a run-and-revert negative control |
| F-08 test deps | `jsdom`, `axe-core`, `@axe-core/playwright`, `fake-indexeddb` pinned; `vitest.config.ts` ships Vitest 5 `test.projects` with `css: true` |
| F-09 port + freshness | `playwright.config.ts` reads `SHEAF_PW_PORT` (default 8080), `pnpm build && pnpm preview --strictPort`, `reuseExistingServer:false` |
| F-10 D10 + check 7 | AD-8 recorded; `stale-confirmation` refusal at `handlers.ts:618`; e2e reset leg proves the surface refuses a stale confirm token |
| F-11 CA-07 wording | S07 verified and reported the existing agreement; the implemented matrix equals STATE's recorded one and needed no amendment |

Two of them (F-01 harness, F-08 test deps) would each have blocked a mid-run
session. The planning pass ran before wave 1 and cost nothing to act on.

### Drift found and reconciled

All nineteen `arch/` fragments rewritten to read as one description of the
module as it stands at `2c0248a`; the `<!-- foundation-first-unlock SESSION-NN -->`
staples are merged into their head contracts and removed. Five were substantive,
not cosmetic:

1. **`M51-platform.md` — head contract silently superseded.** The seeded F01
   list named seven capabilities; the landed probe has thirteen under three
   classifications (D14/AD-9). SESSION-05's delta said in plain words that the
   head list was superseded — and then left it standing above itself. A reader
   taking the fragment top-down got the wrong set. Head replaced with the
   landed table.
2. **`M32-worker-protocol.md` — request union missing `updateSettings`.** The
   head union predated replan F-02/D13/AD-7. Verified against `messages.ts` and
   corrected.
3. **`M38-ui-primitives.md` — export list missing the four F-03 primitives.**
   Same shape: the head predated the replan, the delta added them below.
4. **`M42-ui-library.md` — a fixed defect recorded as an open gap.** M42 carried
   SESSION-07's cross-lease finding that M39's icon-only rail had no accessible
   name at 900–1199px. That was closed by OWNER-M39-RAIL-LABEL at `2c0248a`
   (`aria-label` on the rail anchor; the `test.fail()` block deleted). The note
   removed from M42; the *contract* it implies promoted into `M39-ui-layout.md`'s
   must-not list, where it binds future work instead of describing past work.
5. **`M11-envelope-store.md` — two `## Change History` sections** and a duplicated
   `## M11` heading inside one of them. Collapsed.

Everything else was merge-and-normalise: session-level facts that only existed
in `.forge/results/*` were promoted into the fragment that owns them — M41's
`noValidate` must-not and the recorded design deviations, M36's missing
recoveryMachine countdown, M53's two-countdown reconciliation, M33's check-7
and nested-envelope facts, M08's AD-10 no-prefix fact, M55's harness contract.

`PROGRAM-CONFIG.md` module registry: added the F01-landed module list
(git-verified), added `harness.html` + `src/harness/**` and the four missing
root manifests to the owner-seam paths, and corrected M33's Path — the shipped
leasing unit is `src/workers/**`, not `src/workers/*.worker.ts`, because the
entry is a composition root and every command body lives in `src/workers/data/`.

**Reported, not corrected — no owner:** `PROGRAM-CONFIG.md`'s **Verification
Commands** block still opens *"Status: aspirational — nothing below is
executable yet. No `package.json` exists"*, and still lists `pnpm test -- <path>`
as the focused-test form. Both have been false since `7767341`. Roshi's charter
excludes that section (a running Mu depends on it), so it is left untouched and
raised here — see the framework recommendation below.

### Conventions promoted to FORGE-CONFIG (Vow 4)

Each crossed the in-cycle axis (three or more distinct sessions within one
feature cycle). Instances are cited in the file itself.

- **A dependency must-not ships as a test, not a review note** — 5 instances
  (S02, S03, S04, S05, S06). Two genuine cross-lease defects were prevented by
  these tests rather than caught by review.
- **Encode a must-not as a type or a runtime throw wherever the language allows**
  — 5 instances (S03 ×2, S04, S05, S06).
- **Test filters take no bare `--`** — 3 instances (S01, S05, S06). Silently
  runs the whole suite; passes vacuously.
- **Custom Rule 7: `Owns` is authoritative, the Files table is indicative** —
  4 instances (S03, S05, S06, S07), each an in-lease file created for a real
  structural reason and disclosed.
- **Arch fragment reconciliation policy** — 4 instances (M32, M38, M42, M51).
  Recorded in the Module Registry's fragment policy, where a future Forge and
  Jikijitsu will read it.

### Proposed for the framework (Vow 3 — recommendations only, never edits)

`FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` were read for adoption and are
byte-identical to how this pass found them.

**Checked and NOT proposed, because the substance is already present:**

- A mandatory planning-completeness pass before first dispatch — `JIKIJITSU.md`
  already requires it at all sizes. It paid for itself here (11 findings, all
  real, 2 blocking); no change is needed.
- Warning that another agent may stage files in the shared index — `MU.md`
  already states it and mandates the pathspec mitigation, which held every
  time. See the note under the ledger: this pass settled *what* is doing the
  staging, which is worth more than a new rule.

**Proposed (1 cycle each; the count is evidence, not a gate):**

1. **`JIKIJITSU.md` — no interim drift check is scheduled below 16 sessions,
   and a 7-session run drifted.** Current cadence: *"1-15 sessions: no
   additional interim drift checks by default."* F01 ran 7 sessions with
   planning + final only, and four fragments finished with a head contract
   their own delta had superseded — one of them (M42) carrying a defect as
   open for the last two commits of the run. None was harmful, because the
   record was reconciled at the end; but the deltas that caused it were all
   landed by wave 4 and a single quiet-boundary check would have caught them
   while the owning sessions were still available. *Suggested:* one interim
   check at the first quiet boundary after the halfway wave, for any run of 6+
   sessions. **1 cycle, 4 in-cycle instances.**

2. **`PROGRAM-CONFIG.md`'s Verification Commands block has no maintainer after
   the scaffolding session proves the baseline.** Forge writes it at feature
   planning as aspirational; Mu proves the commands and records results in
   STATE's Verification Baseline; Roshi is explicitly barred from that section;
   nobody is told to go back and correct it. The result is a config that
   asserts *"nothing below is executable yet"* about a program with a green
   `pnpm verify`, and a wrong `--` filter form sitting in the authoritative
   table while the correct form lives only in STATE. *Suggested:* have
   `JIKIJITSU.md`'s post-baseline step reconcile the FORGE-CONFIG verification
   table against the proven Verification Baseline, or state explicitly that
   STATE's baseline supersedes it once proven and mark the table advisory.
   **1 cycle, 2 in-cycle instances.**

3. **Roshi's Orchestration Envelope write set omits the cleanup ledger that
   `ROSHI.md` Vow 5 requires.** `ROSHI.md` says Roshi owns
   `program/{P_SLUG}/CLEANUP-LEDGER.md`; the final-pass envelope granted
   `arch/`, FORGE-CONFIG conventions and `ROSHI-LOG.md` only. This pass
   resolved the conflict conservatively by carrying the cleanup ledger inside
   this log entry rather than creating an unsanctioned file. That works while
   nothing crosses a campaign threshold; it will not once a Forge brief is due.
   *Suggested:* add `CLEANUP-LEDGER.md` to the Roshi envelope's write set in
   `JIKIJITSU.md`, or drop the file from `ROSHI.md` Vow 5 and make the log the
   ledger by design. **1 cycle, 1 instance.**

### Cleanup scout (read-only; nothing deleted, nothing rewritten)

No campaign crossed a briefing threshold, so **no Forge cleanup brief is
emitted**. Ledger carried here (see framework recommendation 3):

| ID | Finding | Evidence | Confidence | Blast radius | Proposed check | Status |
|---|---|---|---|---|---|---|
| CL-01 | `@types/libsodium-wrappers-sumo@0.8.2` is inert | Deprecated upstream; the stub ships no `.d.ts`; `libsodium-wrappers-sumo` carries its own types. S01 surprise 6; Final Report residual | medium | root manifest (owner-seam lease) | remove the pin, then `pnpm install --frozen-lockfile=false && pnpm typecheck` | tracking |
| CL-02 | `tests/browser/fixtures/smoke.module.css` proves a **unit**-runner setting (`css: true`) from the browser fixtures directory | S01 surprise 4: placed there only because S01's lease had no `tests/unit/fixtures/**` path. Lease-shape artifact, not a design choice | medium | one fixture + one vitest include glob | relocate, then `pnpm test` | tracking |
| CL-03 | ~22 value exports with no consumer anywhere in `src/` or `tests/` | Whole-word grep across `src` + `tests` at `2c0248a`: `COUNTDOWN_TICK_MS`, `hkdfExtract`, `hkdfExpand`, `KDF_SALT_BYTES`, `ARGON2ID_MEMORY_CEILING_KIB`, `ARGON2ID_ITERATION_CEILING`, `SECRET_KEY_BYTES`, `RECOVERY_CODE_{DATA_CHARS,CHECKSUM_CHARS,GROUP_SIZE}`, `isDomainError`, `isEnvelopeScopeV1`, `isEnvelopePayloadKindV1`, `REVISION_PAGE_SIZE`, `REVISION_CHANNEL_NAME`, `IDLE_TIMEOUT_MINUTES_V1`, `DEFAULT_REQUEST_TIMEOUT_MS`, `SHELL_COLOR_SCHEMES`, `isConfirmationPhraseMatched`, `PASSPHRASE_MINIMUM_WORDS`, three VM scope constants | **low** | none today | re-run the scan after F02 lands its consumers | tracking |

CL-03 is deliberately low-confidence and must not be swept. Most of these are
named in an arch fragment as F01's declared public surface with a planned F02+
consumer (`getEnvelopesByRevision`/`REVISION_PAGE_SIZE` for projection paging,
`IDLE_TIMEOUT_MINUTES_V1` for the settings union, the KDF ceilings for
calibration bounds). "No consumer inside F01" is not evidence of dead code in a
foundation feature. `COUNTDOWN_TICK_MS` is the one with an independent reason
to look again: M36's `recoveryMachine` has no ticking countdown, which is the
lift that would consume it.

Explicitly **not** cleanup, recorded elsewhere with owners: F08 precache
exclusion of `harness.html` + the ~534 kB probe-worker chunk; CSP/egress
allowlist + M64; the F02/F05/F06 disabled library actions.

### Standing recommendations (full open backlog — carried forward from here)

| pattern | cycles | in-cycle instances | first seen | status |
| --- | ---: | ---: | --- | --- |
| A dependency must-not ships as a test, not a review note | 1 | 5 | F01 | promoted → FORGE-CONFIG Conventions |
| Encode a must-not as a type or a runtime throw | 1 | 5 | F01 | promoted → FORGE-CONFIG Conventions |
| Test filters take no bare `--` | 1 | 3 | F01 | promoted → FORGE-CONFIG Conventions |
| `Owns` authoritative, Files table indicative | 1 | 4 | F01 | promoted → FORGE-CONFIG Custom Rule 7 |
| Arch fragment head contract superseded by its own delta | 1 | 4 | F01 | promoted → FORGE-CONFIG fragment policy |
| No interim drift check scheduled below 16 sessions | 1 | 4 | F01 | open (Vow 3 → JIKIJITSU.md) |
| FORGE-CONFIG Verification Commands has no post-baseline maintainer | 1 | 2 | F01 | open (Vow 3 → JIKIJITSU.md) |
| Roshi envelope write set omits ROSHI.md's cleanup ledger | 1 | 1 | F01 | open (Vow 3 → JIKIJITSU.md / ROSHI.md) |
| Checkpoint boundary blur: capability bodies and their proofs split across checkpoints | 1 | 2 | F01 | open — below Vow 4's bar; watch at F02 |
| Files staged in the shared index from outside any lease | 1 | 3 | F01 | **retired as an agent concern** — proven environmental this pass; mitigation already mandated and held every time |

**On that last row — this pass produced the deciding evidence.** S03 and S06
each reported their own files appearing already staged before any `git add`,
and S03 read it as *"consistent with a `git add -A` somewhere outside this
lease"* — that is, as a suspected agent defect, which is what put it in the
Final Report as a near-miss. It is not one. `ROSHI-LOG.md` was created by this
pass and was **already staged before Roshi ran a single git command**, verified
by `git diff --cached --name-only` returning exactly that one path. No Mu was
running; no agent but Roshi had touched the tree. The stager is the editor
watching the workspace, not any worker. That closes the near-miss honestly:
no worker ever ran an unscoped `git add`, the two sightings were never evidence
that one did, and the standing mitigation (explicit pathspec on both `add` and
`commit`) is exactly the right defence against an *environment* that stages
files nobody asked it to. Future passes should not re-raise this as a
discipline problem.

The boundary-blur row is the Final Report's granularity feedback, read: S05
reported CAP-04..07 handler bodies in CP2 with their proofs in CP3
(coherent-file pressure), and S07 absorbed screens + routes + entry + e2e
contract + e2e a11y in three checkpoints where four would have matched effort.
Both held; neither is yet a rule. Two instances in one cycle is under the bar,
and F01's real granularity signal is the opposite one — 7/7 sessions accepted
on first dispatch, 0 corrective commits after acceptance, 0 checkpoint
re-slices, 0 context exhaustions. Recording it as *open* rather than promoting
it is the honest reading; if F02 repeats it, it crosses.

### Verification of this pass

- Every claim above traces to `git`, `STATE.md`, or a run report; the F-01..F-11
  closures and the M39/M42 correction were each re-checked against source at
  `2c0248a`, not taken from a session's own report.
- Fragments re-read after writing; no fragment contradicts a sibling. Nineteen
  files, one `## Change History` each, zero remaining session staples.
- `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` byte-identical — verified by
  `git status` and by having opened them read-only.
- `STATE.md`, `MASTER.md`, `specs/`, `mocks/`, `src/`, `tests/`, session files
  and `.forge/` untouched.
- Roshi did not choose product behavior, clear dispatch, mark evidence
  verified, or turn any finding into a mid-run human prompt. GATE-F01 remains
  the human's, unchanged.

---

## 2026-09-08 — interim drift check, cycle **F02 / csv-import-first-app** (after S01–S04, 4 of 8)

Quiet boundary, no Mu running. Read before writing: `.forge/{ledger,blockers,decisions,roshi-notes}.md`,
`.forge/results/{ROSHI-PLANNING,REPLAN-F02-COMPLETENESS,SESSION-01,SESSION-02,SESSION-03,SESSION-04.attempt1,SESSION-04}.result.md`,
`STATE.md` end to end, `PROGRAM-CONFIG.md`, this log's F01 entry, and `git log` from `2c0248a`
forward. Code inspected at HEAD `cd74e6d` (tree clean). `pnpm typecheck` re-run: exit 0.
**No `arch/` fragment was touched** — the `<!-- csv-import-first-app SESSION-NN -->` deltas are
correct mid-run form and folding them is the final pass's work, per the envelope.

### 1. Documentation drift — STATE.md vs the committed tree

Three findings; all are Jikijitsu's to correct, none blocks S05.

**D-01 (systematic). Seven "Proof / checked sources" cells still read `planned:` for legs that
landed and were the evidence for their own row's status change.** Verified present on disk at
`cd74e6d`: CAP-09's sniff suite (`tests/unit/import/sniff.test.ts`, S03 CP1) and worker refusal
leg (S04 CP3); CAP-10's preflight suite (`tests/unit/import/preflight.test.ts`, S03 CP3);
CAP-11's cancel/cleanup browser specs (`tests/browser/worker/staging.spec.ts`, S04 CP3);
CAP-12's pinned demo proposal (S03 CP4) and worker proposal leg (S04 CP4); CAP-13's
import-journey browser spec (`tests/browser/worker/import-journey.spec.ts`, S04 CP5); CA-10's
staging unit order-proofs and backpressure browser spec (`tests/unit/staging/cleanup.test.ts`;
`staging.spec.ts:156-162` asserts `Math.max(ackTrace) === batchesSent`). Only the S06/S07/S08
legs in those same cells are genuinely still planned. A reader taking the current record
top-down under-counts F02's landed evidence by five sessions' worth.

**D-02. CA-10's row contradicts itself inside one line.** Agreement cell: *"agreed (**ready
@ cd74e6d** both halves)"*. Producer cell, two columns later: *"S04 stage/channel half planned"*.
The tree agrees with the first: `src/import/staging/{stage,lifecycle,cleanup,promotion}.ts`,
`src/workers/protocol/stage-channel.ts` and the four-step cancel all exist at `cd74e6d`, with the
step-1 unreachability proven by failed decryption rather than by a spy. The Producer cell is
stale S03-era text.

**D-03. A cleared blocker's body is stapled inside an active watch, and claims a false stall.**
STATE § Current Blockers opens *"None open. S01 received done 4/4 @3ffee63"* (stale since three
sessions), then line 210 records the S04 lease-r2 blocker as **CLEARED**, and then line 211's
**ACTIVE WATCH → S05/S06 (M37 error-kind map)** bullet continues with that same cleared
blocker's text — *"Declared-blocked at CP2: M11 has no envelope-delete path… Stalls: S05→S08
chain."* Two errors: the M11 seam is closed (`deleteStorageIds` landed at `978f4ff`,
`src/persistence/envelope-store/commit.ts:54,63`), and nothing stalls the S05→S08 chain now.
The armed watch itself is real and correctly worded in `.forge/blockers.md`; only STATE's copy
is contaminated.

### 2. PC-11 (checkpoint-boundary blur) — recurrence accounting, honestly flat

**No new instance in S01–S04.** The pattern is "capability bodies and their proofs split across
checkpoints"; what F02 has produced so far is the opposite evidence. S04 ran five checkpoints,
each with its own proof landing in the same commit (CP3 = channel + its browser spec, CP5 =
promotion + the root-decoding journey), took a lease revision without a single checkpoint
re-slice, and self-caught three real defects with its own tests. S03's two corrections were
truthfulness fixes found after CP4, not boundary blur. S04's blocked→r2→resumed arc belongs to
the **lease-shape** class below, not this one — counting it here would inflate the ledger with
an instance of a different pattern.

Accounting therefore stands at **1 cycle / 2 in-cycle instances (both F01), plus 2 *planned*
instances not yet observed** — S07 CP4 (e2e for CAP-09/10/11/12/14 + axe on nine screens + 320px/44px
+ the guard-matrix extension) and S08 CP4 (gate demo + offline-guard extension + axe on seven
screens and the sheets/dialogs + 200% text + the demo-readiness record). Below Vow 4's bar; the
watch stays armed and is the final pass's to settle. If either returns with a re-slice, a
shortfall, or context exhaustion, it crosses on the in-cycle axis and gets promoted **at that
pass**.

### 3. Lease-shape recurrence — crossed, promoted this pass (Vow 4)

The class is *a lease or a boundary sweep drawn over the wrong tree*. Fourth instance overall,
third **inside F02**, which is the axis that crosses:

| # | instance | cost |
|---|---|---|
| 1 | F01 replan F-01 — harness entry in no lease | pre-dispatch |
| 2 | F01 replan F-08 — test deps in no lease | pre-dispatch |
| 3 | F02 PC-01 — S01's lease lacked `tests/browser/fixtures/**`, which its own CP1 proof had to create | pre-dispatch |
| 3b | F02 PC-07 — same lease lacked the five configs D16 required | pre-dispatch |
| 4 | F02 S04 — S03's `tests/unit/import/module-boundaries.test.ts` swept **all** of `src/import`; landed M23 imports M09 exactly as `M23-staging.md` declares; `pnpm verify` red in a file outside the failing session's lease | **one blocked return, one lease revision, one resumed session** |
| 4b | F02 S04 — `tests/fixtures/workbooks/**` is S03's, so volume cases were built as synthetic in-page fixtures | workaround |

Vow 4's in-cycle axis (three distinct sessions, recoveries, or checkpoint returns in one cycle)
is met by 3, 3b and 4 alone, and 4 is a *recovery*, the strongest form of the evidence. Promoted
now rather than queued for the Final Report, because the queue would sit behind exactly the kind
of blockage the pattern produces. Convention added to `PROGRAM-CONFIG.md` § Conventions with all
three rules and their instances. Pleasingly, the re-scoped sweep already states the principle in
its own header: *"`src/import` is not one module."*

### 4. CA-12 deviation (no new error kinds) — sound, with one untruthful residue

CA-12 requires the RPC to stay byte-free and redacted, validation failures to be typed results
(D23), and *"new error kinds closed + mechanical."* S04 added none, so the union is trivially
closed and every F01 consumer of `DataWorkerErrorKindV1` is untouched — verified: the sixteen
kinds at `messages.ts:655-672` are byte-identical to F01's, and `REFUSAL_ANNOUNCEMENT` in
`src/application/view-models/security.ts:97` still keys them exhaustively. **The disposition
recorded in STATE and `decisions.md` is the right reading and hides no consumer break in the
contract's own terms.** `getImportStage` returning `stage: null` and `cancelImportStage`
returning `deletedCount: 0, completed: true` for an unknown id are both truthful: "is anything
left behind?" has the same true answer whether the sweep already ran or the stage never existed.

**What is not recorded anywhere, and should be:** the three *mutating* stage calls do not share
that idempotence. `runInference`, `applyReviewEdit` and `promoteImport` each throw
`DataWorkerCommandError("integrity")` on an absent stage (`import-handlers.ts:811-813, 856-858,
902-904`), and `integrity` announces to the user *"The local store did not pass its integrity
check. Nothing was changed."* (`security.ts:117-118`). That sentence is false for the ordinary
path that produces it: `sweepStaleImports` abandons **every** active workflow at unlock
(`cleanup.ts:464-476`, called from `handlers.ts:289` before the session view is returned), so a
device that reloads mid-import and unlocks again has a legitimately-swept stage, and a resumed
machine that calls any of the three is told its local store failed an integrity check.

Classification: **machine-actionable, owner S06** — it owns both `security.ts` and the import
machine, so it can either gate every mutating stage call on `getImportStage` (no new kind, the
D23/idempotent-read pattern extended one step) or add the kinds *with* their copy in the single
lease that holds both files, which is what the armed M37 watch already anticipates. Not a
product-design decision: the truthful copy for "that import is gone" is composable from existing
facts (the cancel receipt already says it). Not a defect in S04's work — S04 reported the seam,
did not absorb it, and had no path to the file. Reported to Jikijitsu for the S06 envelope; the
S05 watch text needs no change.

### 5. Upcoming-consumer readiness for S05 — surfaces check out, two seams to name

Spot-checked against the real files at `cd74e6d`, not against headings.

- **S02's projection API is exactly as STATE records it.** `src/persistence/projection/index.ts`
  exports `openProjection`/`disposeProjection`/`hydrateApp`/`applyEvents`/`executeQuery` and the
  three key-version constants and nothing else; `ProjectionCommitV1 = {commit, events,
  issuesByEventIndex?}` at `types.ts:193-203` matches the recorded contract change; the closed
  query surface is the eleven kinds STATE lists, `list-validation-rules` and `record-by-id`
  included.
- **S04's RPC surface is byte-for-byte what the handoff pinned.** Every request/response name and
  field in STATE's S04 note appears in `messages.ts` as written — `beginImportStage → {stageId}`
  and nothing else, `getImportStage → {stage|null}`, the `applied|rejected` and
  `promoted|rejected` result unions, `LibraryAppV1`'s nine fields, `cancelImportStage`'s receipt.
  S05/S06/S07 may bind to STATE's text directly.
- **`src/application/ports/**` holds five ports** (clock, entropy, envelope-store, envelope-crypto,
  staging-catalog); the serial handoff to S05 is clean and `src/workers/data.worker.ts` still
  imports no projection module, so STATE's "production ENTRY-graph proof due when data.worker
  imports M12 (S05)" is still exactly the open item it says it is.
- **Seam A — `validationRules` has no producer in the checkpoint root.** S02's
  `ProjectionCheckpointV1` requires `validationRules` (`types.ts:180`); S04's landed
  `CheckpointManifestV1` (`roots.ts:676-693`) carries appState, tables, enumOptions, sheetSnapshots
  and recordPages — no rules field. This is *correct and truthful*: F02 has no rule-authoring
  event (`F02_EVENT_KINDS` has eleven members, none of them a rule), and editors are F04. But
  S04's attempt-1 CP0 note listed `validationRules` among what the manifest would decode into, so
  S05's CP0 could read the absence as a missing producer and stall. It is not: S05 supplies `[]`
  and `list-validation-rules` truthfully answers empty. Recorded here so no one re-derives it
  under pressure.
- **Seam B — page shape mapping is S05's, and unowned by any test yet.** `RecordPageV1`/
  `StoredRecordV1` (roots.ts) and `ProjectionRecordPageV1` (projection types) are different
  shapes; the hydrate path S05 writes is the only place they meet. Expected work, named so it
  gets a checkpoint rather than being discovered at CP2.

### Conventions promoted to FORGE-CONFIG (Vow 4)

- **A lease and a boundary sweep are drawn over the module map, never over the directory tree** —
  4 instances / 2 cycles, 3 in-cycle in F02, one of them a blocked return. Three sub-rules with
  their evidence written into the file.

Nothing else crossed. The M37 exhaustive-map coupling is at one instance and stays a watch.

### Proposed for the framework (Vow 3 — recommendations only, never edits)

Adoption checked before carrying anything forward. `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md`
are untracked in this repo, so `git log` yields nothing for them; adoption was checked by reading
their **current content** and their mtimes (`2026-09-07 20:11`, i.e. unchanged since before F01's
final pass). That is a claim about the human's action, not about Roshi's restraint.

**Now adopted — stop carrying:**

- *"FORGE-CONFIG's Verification Commands block has no post-baseline maintainer"* (F01 #2) is
  **adopted in the alternative form the recommendation itself offered.** `PROGRAM-CONFIG.md`
  §Verification Commands now opens *"Status: proven"*, states that *"the active feature's STATE.md
  Verification Baseline supersedes this table whenever they disagree; Forge/Jikijitsu reconcile
  this table after each feature's baseline lands,"* and carries the corrected no-`--` filter
  forms. Acted on by Forge at F02 planning. Row marked adopted.

**Still open, re-checked and re-raised:**

1. **`JIKIJITSU.md` — no interim drift check is scheduled below 16 sessions** (F01 #1). The text
   at `JIKIJITSU.md:691` is unchanged: *"1-15 sessions: no additional interim drift checks by
   default."* **This pass is itself the evidence:** F02 is an 8-session run, and the interim check
   happened only because Jikijitsu wrote it into `.forge/ledger.md` § Preflight step 2 by hand,
   citing "per Roshi F01 recommendation." It found three documentation contradictions and a
   crossed convention while the owning sessions are still live. An orchestrator honouring a
   recommendation ad hoc is not the same as the cadence saying so. **2 cycles, 5 in-cycle
   instances** (F01's four superseded fragment heads; F02's D-01/D-02/D-03 found at exactly the
   boundary the recommendation predicted).
2. **Roshi's envelope write set still omits the cleanup ledger `ROSHI.md` Vow 5 requires**
   (F01 #3). `JIKIJITSU.md` contains no occurrence of `CLEANUP-LEDGER`; this interim envelope again
   granted `ROSHI-LOG.md` + FORGE-CONFIG conventions only. Resolved conservatively again — the
   ledger is carried inside this entry. **1 cycle, 2 instances.** Still costs nothing until a
   campaign crosses a briefing threshold.
3. **New — `FORGE.md`: a closed union and every exhaustive map over it must land in one lease.**
   `DATA_WORKER_ERROR_KINDS_V1` (M32) is keyed exhaustively by `REFUSAL_ANNOUNCEMENT` (M37), so
   *any* extension of the union breaks a file in a different session's lease. F02's plan put the
   producer (S04/S05) and the exhaustive consumer (S06) in different sessions in that order, which
   converted a routine contract extension into a recorded CA-12 deviation, an armed watch across
   two sessions, and the untruthful `integrity` announcement above. Decomposition should treat
   "exhaustive map over a closed union" as a lease-joining constraint the same way a serial
   takeover is — or require the plan to name which session may extend the union. **1 cycle,
   1 instance** — recorded now because Vow 3 has no threshold and the S05/S06 boundary is the next
   place it can fire.
4. **New — `JIKIJITSU.md`: a landed proof leg must leave the "planned" list at receive.** Finding
   D-01 is seven rows deep and entirely mechanical: the receive step updates the status column and
   the agreement cell but not the proof cell, so STATE reads as though five sessions' evidence is
   still ahead of it. One line in the receive checklist ("move each proof leg the handoff proved
   out of `planned:` and cite its file") would close it. **1 cycle, 7 instances.**

### Cleanup scout (read-only; nothing deleted)

No campaign crossed a briefing threshold — **no Forge cleanup brief.** Ledger carried forward:

| ID | Finding | Evidence at `cd74e6d` | Confidence | Blast radius | Proposed check | Status |
|---|---|---|---|---|---|---|
| CL-01 | `@types/libsodium-wrappers-sumo@0.8.2` is inert | Still pinned (`package.json:34`) beside `libsodium-wrappers-sumo@0.8.4`, which ships its own types; unchanged through F02's root-manifest session | medium | root manifest (owner-seam lease) | remove the pin, then `pnpm install --frozen-lockfile=false && pnpm typecheck` | tracking |
| CL-02 | `tests/browser/fixtures/smoke.module.css` proves a **unit**-runner setting from the browser fixtures dir | Still there; F02's PC-01 amendment leased that directory to S01 for the sqlite fixture and did not relocate this one | medium | one fixture + one include glob | relocate, then `pnpm test` | tracking |
| CL-03 | ~22 F01 value exports with no consumer | **Evidence weakened, as predicted.** `getEnvelopesByRevision` now has a real consumer (`src/workers/data/import-handlers.ts`, S04); `COUNTDOWN_TICK_MS`, `REVISION_PAGE_SIZE`, `IDLE_TIMEOUT_MINUTES_V1`, `isEnvelopeScopeV1` remain definition-only | **low** | none today | re-scan after S05–S08 land their consumers | tracking |

CL-03's F01 reading is holding: "no consumer inside the feature that built it" was never evidence
of dead code. It must not be swept before F02 closes.

### Standing recommendations (full open backlog)

| pattern | cycles | in-cycle instances | first seen | status |
| --- | ---: | ---: | --- | --- |
| A dependency must-not ships as a test, not a review note | 1 | 5 | F01 | promoted → FORGE-CONFIG Conventions (fired again in F02: S03's sweep caught the M22/M23 edge question in code, not review) |
| Encode a must-not as a type or a runtime throw | 1 | 5 | F01 | promoted → FORGE-CONFIG Conventions |
| Test filters take no bare `--` | 1 | 3 | F01 | promoted → FORGE-CONFIG Conventions |
| `Owns` authoritative, Files table indicative | 2 | 7 | F01 | promoted → Custom Rule 7 (F02: S04 +3 files, S03 +1, each disclosed) |
| Arch fragment head contract superseded by its own delta | 1 | 4 | F01 | promoted → FORGE-CONFIG fragment policy |
| **Lease or boundary sweep drawn over the wrong tree** | **2** | **3 (F02)** | **F01 (F-01/F-08)** | **promoted this pass → FORGE-CONFIG Conventions** |
| No interim drift check scheduled below 16 sessions | 2 | 5 | F01 | open (Vow 3 → JIKIJITSU.md) — honoured ad hoc by ledger this cycle; text unchanged |
| FORGE-CONFIG Verification Commands has no post-baseline maintainer | 1 | 2 | F01 | **adopted** — FORGE-CONFIG §Verification Commands now proven + supersession rule + owner named (Forge, F02 planning) |
| Roshi envelope write set omits ROSHI.md's cleanup ledger | 1 | 2 | F01 | open (Vow 3 → JIKIJITSU.md / ROSHI.md) |
| Checkpoint boundary blur: capability bodies and proofs split across checkpoints | 1 | 2 | F01 | open — no new instance in S01–S04; watch armed on S07 CP4 / S08 CP4 |
| Closed union and its exhaustive map split across leases | 1 | 1 | F02 | open (Vow 3 → FORGE.md); watch armed at the S05/S06 boundary |
| Landed proof legs left in STATE's `planned:` list at receive | 1 | 7 | F02 | open (Vow 3 → JIKIJITSU.md); D-01 is the instance list |
| Files staged in the shared index from outside any lease | 1 | 3 | F01 | retired as an agent concern (environmental, proven F01) — recurred in F02 S03/S04, pathspec defence held both times; **do not re-raise** |

### Verification of this pass

- Every claim traces to `git`, `STATE.md`, a result file, or a line of source read at `cd74e6d`;
  the five landed-proof claims in D-01, the M11 delete path, the re-scoped sweep, the `integrity`
  mapping and the unlock sweep were each read in source, not taken from a session's own report.
- `pnpm typecheck` exit 0. No browser suite run, no server started, no subagent spawned.
- Files written: this entry and `PROGRAM-CONFIG.md` § Conventions only. `STATE.md`, `MASTER.md`,
  session prompts, `arch/**`, `specs/`, `mocks/`, `src/**`, `tests/**` and `.forge/**` untouched;
  **no git commit made** — `program/sheaf/**` is untracked by user intent (`81e0479`).
- `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` byte-identical to how this pass found them —
  and, separately, checked for *adoption* by reading their current text, which is how row 8 above
  changed status and row 7 did not.
- Roshi did not choose product behavior, clear dispatch, mark evidence verified, re-slice anything,
  or turn a finding into a human prompt. GATE-F02 remains armed and the human's.

---

## 2026-09-08 — final pass, cycle **F02 / csv-import-first-app** (the Elder's Note)

Base `2c0248a` (run HEAD `81e0479`, identical code tree), final
`5ab3b07fab3ea5384ff428248929aef8efbea923`. Read in full before writing:
`.forge/FINAL-REPORT.md`; `.forge/results/{ROSHI-PLANNING,REPLAN-F02-COMPLETENESS,
ROSHI-INTERIM-1,SESSION-01..08,SESSION-04.attempt1,OWNER-M23-EPOCHDAY}.result.md`;
`.forge/{ledger,blockers,decisions,roshi-notes}.md`; `STATE.md` end to end;
`PROGRAM-CONFIG.md`; this log's F01 and F02-interim entries; `git log` from
`2c0248a` forward; all thirty-one `arch/` fragments. Source read at `5ab3b07`,
tree clean. `pnpm typecheck` re-run: **exit 0**. No servers, no browser suites,
no subagents. **No git commit** — `program/sheaf/**` is untracked by user intent
(`81e0479`), so every edit below is a file edit.

### Verdict on the cycle

Eight sessions, thirty-two checkpoints, nine corrections, zero sessions ended
blocked, zero corrective commits on an already-accepted checkpoint. The record
now reads as one description of the system; the two things still wrong are in
`STATE.md`, which is Jikijitsu's alone, and are reported below rather than
edited. Nothing found in this pass contradicts a capability claim.

Checked in source rather than taken from a session's report: the sixteen
`DATA_WORKER_ERROR_KINDS_V1` are byte-identical to F01's
(`messages.ts:1024-1041`); the `stage-missing` gate lives in the *machine*
(`import.machine.ts:73,208,218,592,671,725`), not in the worker, which is what
lets the union stay closed; `deleteStorageIds` is real in `commit.ts`; the
signed epoch-day reader and its comment sit at `roots.ts:120-134`;
`PARSER_STOP_TIMEOUT_MS = 5_000` and its `after` fallback at
`import.machine.ts:159,808`; the re-scoped import sweep names four directories
and says why in its own header; `tests/fixtures/workbooks/.gitattributes`
carries `* -text` with the reason; the guard matrix is 46 rows across three
tables plus the app-path cases; `DEFAULT_APP_THEME` stores six **colour values**
copied from `tokens.css` (not token ids — the accent list is the one that stores
ids), and `theme.test.ts` reads the stylesheet as text to keep them equal.

### Drift found and reconciled (`arch/`)

Thirty-one staples across twenty-five fragments, all folded and removed; six
further fragments were reconciled from the tree and the session returns. Nine
were substantive rather than cosmetic:

1. **`M23-staging.md` carried its own supersession instructions.** The delta was
   written in two parts, and part 2 opened by telling the reader that part 1's
   closing "Not landed" list and its "M11 has no delete today" aside were both
   false. A fragment that has to explain which half of itself to believe is the
   exact failure Vow 2 exists for. Folded to one description; both superseded
   notes deleted, the landed delete path recorded where `commit.ts` is described.
2. **`M07-ports.md` still said `EnvelopeStorePort`'s delete "has no adapter".**
   It landed at `978f4ff`.
3. **`M21-inference.md` still described the boundary sweep that S04's blocked
   return corrected** — "asserts that `src/import/**` imports nothing from
   `src/persistence/`" — inside the fragment of the module whose *correct*
   import triggered the red gate. Replaced with the landed four-directory sweep
   and the reason, taken from the test's own header.
4. **`M32-worker-protocol.md`'s head said "`messages.ts` is the whole wire
   contract".** The module is six files, and the byte-carrying half
   (`import-messages.ts`, `stage-channel.ts`) is deliberately *not* that file —
   which is precisely why the key-and-byte type exclusion still holds.
5. **`M42-ui-library.md` described a subset that no longer exists** ("F01
   subset: SCR-011 empty state only") and carried "F02: enable the upload
   action" as residual debt in the same file that documents the flip.
6. **Three deltas described a different module than the fragment they sat in.**
   M58's fixture-byte contract was inside `M19-delimited.md`; M61's e2e contract
   inside `M51-platform.md`; M54's whole CA-07 amendment 2 inside
   `M44-ui-records.md`. Moved to their own modules; `M58-workbook-fixtures.md`
   and `M61-e2e-tests.md` created for the two that had no fragment.
7. **`M51-platform.md` ended with an empty `# SESSION-07 lease r2 — correction
   delta` heading and no body.** Its content is M36's cancel-ordering fix, which
   is recorded there. Heading removed.
8. **Six fragments no session wrote a delta into had changed anyway.** M53
   gained a second composition root (`import-worker.ts`); M38 gained a
   three-item backlog (CTL-044, `TextArea`, the still-throwing
   `externalHandoff`) it can only learn from S07/S08's returns; M39 gained the
   `top: 68px` literal that exists because M39 publishes no top-bar height
   token; M40 gained a *durable-data* coupling — an app's stored theme is six
   colour values copied out of `tokens.css`, so editing that palette is a change
   to data already written into encrypted app roots, not a restyle. M41 and M50
   were verified untouched (`git diff --name-only 2c0248a 5ab3b07 -- src/`).
9. **Fragment heads still scoped "F01"** across nine files where the module has
   since grown. De-scoped, with the landed surface stated once.

`PROGRAM-CONFIG.md`: added the **F02 landed-module table** (twelve new, thirteen
extended, six product modules untouched, git-verified at `5ab3b07`), noted that
arch fragments now exist for M58 and M61, and extended the fragment-policy rule
(below). The **Verification Commands** block still says its rows were
"re-verified at the F01 final revision `2c0248a`" — one cycle behind. That
section is outside Roshi's charter by ROSHI.md, and its own supersession rule
already names Forge/Jikijitsu as the reconcilers, so it is reported here, not
edited.

### Findings for Jikijitsu — `STATE.md` is not Roshi's to edit

**S-01 (mechanical, five rows). Five Capability Readiness rows are seven cells
in an eight-column table.** `CAP-09`, `CAP-10`, `CAP-12`, `CAP-14` and `CAP-18`
are missing the **Status** cell, so read positionally the table says CAP-14's
*status* is "planned: library VM type-negatives…" and its *proof* is "none
known", and its Open-gaps cell does not exist. CAP-11/13/15/16/17 have eight
cells and read correctly. This is the same defect class as interim finding D-02,
where one shifted row was found and repaired; the repair did not generalise. A
one-line check at receive — every row's cell count equals the header's — closes
it permanently.

**S-02 (systematic, recurrence of D-01). Landed proof legs are still listed as
`planned:` at the final receive.** In Capability Readiness: CAP-09's e2e refusal
legs, CAP-10's e2e target+fits leg and over-budget VM tests, CAP-12's review e2e,
CAP-14's library VM negatives and e2e legs, CAP-18's usage-journey reset leg —
all landed (`8a665c1`, `5867b02`, `d47b3d2`). In Contract Agreements: CA-09's
"count half awaits S05" (landed `d47b3d2`, `event-store.ts:324,537`), CA-10's
e2e cancel leg (`import-flow.spec.ts:279,355`), CA-11's hydrate/restart legs,
CA-13's S08 surface leg, CA-14's VM negatives and copy assertions, CA-16's
worker proposal leg and review e2e. The interim pass found seven instances of
this and Jikijitsu fixed those; six more accumulated in the second half. It is
not a discipline failure — it is a missing line in the receive checklist.

**S-03 (scope of a claim). "Every root decoded from raw IndexedDB" overstates by
two root classes.** `tests/browser/worker/runtime.ts` opens and decodes the head,
the checkpoint manifest, every record page and the event segment, recomputing
`semanticSha256` for the first two — genuinely strong evidence. It **counts**
`sourceManifests` and `snapshotManifests` (`runtime.ts:601-602`) without opening
either envelope, and `decodeSourceManifest`, `decodeSnapshotManifest` and
`decodeSnapshotChunk` have **no consumer anywhere in `src/` or `tests/`**.
Promotion writes those roots (`promotion.ts:530,554`), so D21's "the original
import stays recoverable" currently rests on encode-side evidence only. CAP-13's
status is unaffected — hydration never reads them, and the restart legs that
prove CAP-13 do not touch them — but the sentence in the Final Report and the
D21 promise should not be read as decode-proven. Owner: F03's viewer, or a
bounded round-trip proof at F03 planning. Recorded as CL-04 below.

### Recurrence accounting

**PC-11 (checkpoint-boundary blur) did not recur, and the watch is now settled
negative.** It entered F02 at 1 cycle / 2 in-cycle instances (both F01) with two
*planned* instances armed on S07 CP4 and S08 CP4 — the two heaviest checkpoints
in the plan. Both held: S07 CP4 carried screens + routes + entry + the e2e
contract + axe over ten surfaces and returned without a re-slice; S08 CP4
carried the gate demo + offline extension + axe + 200% text and did the same.
Across the whole cycle: 32 checkpoints, **0 re-slices, 0 checkpoint shortfalls,
0 context exhaustions, 0 boundaries reported drawn wrong**. Three sessions
returned blocked mid-run, and each was a capability or lease correction, not a
sizing failure. The row is **retired**: two cycles of evidence, the second
actively contradicting the first. If it reappears it starts again at one.

**The lease-shape convention held after it was minted.** Promoted at the interim
pass (S05–S08 were still ahead); no further instance occurred in those four
sessions.

**The closed-union pattern crossed the in-cycle axis and is promoted this pass.**
Three distinct sessions, three different costs: S04 could not add the two error
kinds it wanted and shipped idempotent reads as a recorded CA-12 deviation; S05
was told by an auto-decision not to extend the union, a plan constraint standing
in for a lease it did not hold; S06 cleared the seam only because it was the
first session holding both files. Between S04 and S06 the shipped product told a
user who reloaded mid-import that "the local store did not pass its integrity
check" — a false sentence, found by the interim drift check rather than by any
session, because no session owned both halves of the contract that produced it.

### Conventions promoted to FORGE-CONFIG (Vow 4)

- **A closed union and every exhaustive map over it are one lease.** In-cycle
  axis: S04, S05, S06, cited in the file with what each cost. Co-lease,
  sequence consumer-first, or name in the plan which session may extend the
  union — the same treatment a serial takeover gets, because that is what it is.
- **A delta describing a *different* module belongs in that module's fragment**
  (fragment-policy addition). 2 cycles / 4 instances: F01's M42-carrying-an-M39
  defect, and F02's three moved deltas. A fragment may therefore be created by
  the final pass, not only by Forge at planning time.

### Proposed for the framework (Vow 3 — recommendations only, never edits)

Adoption was checked by **reading the current text** of `FORGE.md`, `MU.md`,
`ENSO.md` and `JIKIJITSU.md`, not by observing that Roshi did not write them.
They are untracked here, so `git log` yields nothing; mtimes are `2026-09-07
20:11` (FORGE/JIKIJITSU/MU) and `2026-09-06 16:44` (ENSO/ROSHI) — unchanged
since F01's final pass. That is a claim about the human's action, and it is
based on having read the files.

**Checked and NOT proposed, because the substance is already present:**

- *"An authorized contract change should carry its consumer list into the
  session prompt"* — the Final Report's granularity item about the D5 flip
  breaking its one F01 consumer. **`FORGE.md:346` already says exactly this**:
  *"Contract changes include their affected consumers… Record exact affected
  paths and the mechanical adaptations in the checkpoint's Files table and
  lease, even when they cross module boundaries."* `MU.md:329` covers the
  worker's half, and S06 followed it precisely — swept, named the exact path,
  returned blocked, took a two-path lease revision. F02's miss is a
  plan-application gap, not a framework gap, and minting a rule that already
  exists would make the real one cheaper to skip.

**Open, re-checked and re-raised:**

1. **`JIKIJITSU.md` — no interim drift check is scheduled below 16 sessions.**
   Line 691 is unchanged: *"1-15 sessions: no additional interim drift checks by
   default."* F02 ran eight sessions and had its interim check only because
   Jikijitsu wrote it into `.forge/ledger.md` by hand, citing the F01
   recommendation. That check found three documentation contradictions and a
   crossed convention while the owning sessions were live; this final pass then
   found five more shifted rows and six more stale proof cells that accumulated
   in the *second* half, with no boundary left to catch them before the gate.
   **2 cycles / 10 in-cycle instances** (F01: four superseded fragment heads;
   F02: D-01/D-02/D-03 at interim, S-01/S-02/S-03 at final).
2. **Roshi's envelope write set still omits the cleanup ledger `ROSHI.md` Vow 5
   requires.** `JIKIJITSU.md` contains no occurrence of `CLEANUP-LEDGER`; this
   final envelope again granted `arch/`, FORGE-CONFIG conventions and
   `ROSHI-LOG.md` only. Resolved conservatively for the third time — the ledger
   is carried inside this entry. It now matters: this pass emits a Forge cleanup
   brief, and the brief has nowhere canonical to live. **2 cycles / 3 instances.**
3. **`FORGE.md` — treat an exhaustive map over a closed union as a lease-joining
   constraint at *decomposition* time.** Narrower than the interim framing, now
   that the existing text has been read carefully: `FORGE.md:346` already
   handles a contract change that is *known* at planning. This one is not — the
   union is unchanged when the plan is written, and the constraint only fires
   when a later session discovers it needs a new member. What decomposition can
   see in advance is the *shape*: a closed union plus a total map over it, in
   two different sessions' leases. **1 cycle / 3 instances** (S04, S05, S06).
4. **`JIKIJITSU.md` — a landed proof leg must leave the `planned:` list at
   receive.** One line in the receive checklist. **1 cycle / 13 instances**
   (7 at interim, 6 more at final; enumerated under S-02).
5. **NEW — `JIKIJITSU.md`: check a Markdown table's row shape at receive.** A
   row that loses a cell is invisible to a human reader and silently re-labels
   every column after the gap. Interim D-02 found one and it was repaired; five
   more exist at the gate, in the table that answers "is this capability
   verified?". `len(row.cells) == len(header.cells)` is a one-line check.
   **1 cycle / 6 instances.**
6. **NEW — `JIKIJITSU.md`: a module no session leased has no route into its own
   fragment.** Deltas are written by sessions about the module they were editing,
   so a fact *about* M38, M39, M40 or M53 discovered by a session leasing M43 or
   M44 lands in a handoff and stops there. F02 produced six such facts, four of
   them contracts a future session needs (the M38 primitive backlog, M39's
   missing height token, M40's durable-token coupling, M53's second composition
   root). Roshi recovered them this pass by reading eight session returns — which
   works, and works only at the end of a cycle. *Suggested:* the receive step
   routes a handoff fact naming another module into that module's fragment, the
   same way it routes a blocker. **1 cycle / 6 instances.**

### Cleanup scout (read-only; nothing deleted, nothing rewritten)

Scanned at `5ab3b07`: every `export const|function|class` under `src/` (M10
excluded — DB-phase-owned) against all of `src/` and `tests/`.

| ID | Finding | Evidence at `5ab3b07` | Confidence | Blast radius | Proposed check | Status |
|---|---|---|---|---|---|---|
| CL-01 | `@types/libsodium-wrappers-sumo@0.8.2` is inert | Still pinned (`package.json:34`) beside `libsodium-wrappers-sumo@0.8.4`, which ships its own types. **A second root-manifest session (S01-F02) has now passed over it** without touching it | medium | root manifest (owner-seam lease) | remove the pin, then `pnpm install --frozen-lockfile=false && pnpm typecheck` | tracking |
| CL-02 | `tests/browser/fixtures/smoke.module.css` proves a **unit**-runner setting from the browser fixtures dir | Still there; F02's PC-01 amendment leased that directory to S01 for the sqlite fixtures and added four files beside it rather than relocating this one | medium | one fixture + one include glob | relocate, then `pnpm test` | tracking |
| CL-03 | F01 value exports with no consumer | Re-scanned: 17 of the original ~22 are still definition-only (`COUNTDOWN_TICK_MS`, `hkdfExtract/Expand`, the KDF ceilings, `SECRET_KEY_BYTES`, `REVISION_PAGE_SIZE`, `REVISION_CHANNEL_NAME`, `IDLE_TIMEOUT_MINUTES_V1`, `SHELL_COLOR_SCHEMES`, …). `getEnvelopesByRevision` gained its consumer in F02. **The F01 prediction weakened for two of them**: F02 shipped projection paging without `REVISION_PAGE_SIZE` leaving `read.ts` | low | none today | re-scan at F03; classify per module rather than sweep | tracking |
| CL-04 | **NEW.** The source and snapshot manifest **decoders have no consumer at all** | `decodeSourceManifest`, `decodeSnapshotManifest`, `decodeSnapshotChunk` are referenced only by their own definitions; promotion encodes and stores both roots (`promotion.ts:530,554`) and the browser journey counts the refs without opening them (`runtime.ts:601-602`) | medium | D21's recoverability claim; F03's snapshot viewer | a bounded encode→store→decode round-trip, or F03's viewer consuming them | tracking |
| CL-05 | **NEW.** Exported-but-unconsumed value surface is growing | 92 `export const|function|class` symbols under `src/` have no reference outside their own file, up from ~22 at `2c0248a`. Most are deliberate — closed-set constants (`IMPORT_STAGE_STATUSES`, `CLEANUP_REASONS`, `REFUSAL_REMEDIES`) exported so a test *could* pin them, and screen helpers (`describeEvidence`, `describeOverBudget`) exported for a unit test that never came. This is a **measurement, not a sweep list** | low | none today | classify per module at F03 planning; each symbol either gains a consumer, gains a named future consumer in its arch fragment, or goes | tracking |

**Cleanup brief for Forge — "Prove or name every unconsumed export".** Emitted
under the fourth threshold: a repeated cleanup pattern already standing in the
ledger (CL-03 at F01, CL-03 + CL-04 + CL-05 now). It is a *classification*
campaign, not a deletion campaign.

- **Title:** Prove or name every unconsumed export.
- **Target area:** `src/**` (excluding `src/migrations/**`), with the arch
  fragments as the place a "named future consumer" is recorded.
- **Reason:** the unconsumed-export surface quadrupled in one feature. Some of
  it is honest declared API with a named later consumer; some of it — CL-04's
  three decoders — is a *proof* gap wearing the same clothes, and today nothing
  distinguishes them mechanically.
- **Proposed strategy:** a script that lists every value export with no
  reference outside its defining file; each result is dispositioned as
  (a) consumed — add the missing test that consumes it, (b) declared surface —
  record the named future consumer in the module's arch fragment, or (c) dead —
  remove. CL-04's three decoders go in bucket (a) and are the highest-value item
  in the campaign.
- **Required checks:** `pnpm verify` (typecheck + lint + unit/property + build)
  after every removal; the browser and e2e suites once at the end; no `Owns`
  path outside the campaign's lease.
- **Risks:** deleting deliberate future surface (F03–F07 consumers are real and
  named in fragments — bucket (b) exists for exactly this); a type-only export
  removed on value-export evidence; and the campaign touching many leases at
  once, which argues for one module per checkpoint.

Explicitly **not** cleanup, recorded elsewhere with owners: the F08 precache
exclusions (now including `dist/__sqlite__/`, `dist/__projection__/` and
`test-results/`); CSP/egress + M64; the F02/F05/F06 disabled library actions;
M37's live-region pluralization; M39's top-bar height token.

### Standing recommendations (full open backlog)

| pattern | cycles | in-cycle instances | first seen | status |
| --- | ---: | ---: | --- | --- |
| A dependency must-not ships as a test, not a review note | 2 | 5 (F01) + 3 (F02) | F01 | promoted → FORGE-CONFIG Conventions (F02: the import sweep, the staging sweep, and M36/M37's self-checking sweep) |
| Encode a must-not as a type or a runtime throw | 2 | 5 (F01) + 8 (F02) | F01 | promoted → FORGE-CONFIG Conventions (F02: `isEstimate`/`isRowCountExact` literals, `AuthoredCellWireValueV1`, `ProposedFieldTypeV1`, the VM absences, `appThemeStyle`) |
| Test filters take no bare `--` | 1 | 3 | F01 | promoted → FORGE-CONFIG Conventions; no F02 instance |
| `Owns` authoritative, Files table indicative | 2 | 7 (F01) + 9 (F02) | F01 | promoted → Custom Rule 7 (F02: S03 +1, S04 +3, S07 +3, S08 +2, each disclosed with a structural reason) |
| Arch fragment head contract superseded by its own delta | 2 | 4 (F01) + 6 (F02) | F01 | promoted → fragment policy; **still firing** — see drift items 1–5 |
| Lease or boundary sweep drawn over the wrong tree | 2 | 3 (F02) | F01 | promoted at F02 interim → FORGE-CONFIG Conventions; **held**: no instance in S05–S08 |
| **Closed union and its exhaustive map split across leases** | **1** | **3** | **F02** | **promoted this pass → FORGE-CONFIG Conventions**; also open as a narrower Vow 3 note to `FORGE.md` |
| **A delta describing another module** | **2** | **4** | **F01** | **promoted this pass → FORGE-CONFIG fragment policy** |
| No interim drift check scheduled below 16 sessions | 2 | 10 | F01 | open (Vow 3 → JIKIJITSU.md); text at line 691 unchanged; honoured ad hoc by the ledger both cycles |
| Roshi envelope write set omits ROSHI.md's cleanup ledger | 2 | 3 | F01 | open (Vow 3 → JIKIJITSU.md / ROSHI.md) — **now blocking**: this pass emits a cleanup brief with no canonical home |
| Landed proof legs left in STATE's `planned:` list at receive | 1 | 13 | F02 | open (Vow 3 → JIKIJITSU.md); S-02 is the instance list |
| **STATE table rows that lose a cell go unnoticed** | **1** | **6** | **F02** | **open (Vow 3 → JIKIJITSU.md)**; S-01 is the instance list |
| **A module no session leased has no route into its own fragment** | **1** | **6** | **F02** | **open (Vow 3 → JIKIJITSU.md)**; drift item 8 is the instance list |
| FORGE-CONFIG Verification Commands has no post-baseline maintainer | 1 | 2 | F01 | **adopted** (F02 planning) — but the table is now one cycle behind again; its own supersession rule names the reconcilers |
| Checkpoint boundary blur: capability bodies and proofs split across checkpoints | 2 | 2 (F01) + 0 (F02) | F01 | **retired** — watch settled negative: 32 checkpoints, 0 re-slices, 0 shortfalls, 0 exhaustions, both armed heavy CP4s held |
| Authorized contract change breaks a consumer outside the lease | 1 | 1 | F02 | **not proposed** — `FORGE.md:346` and `MU.md:329` already carry the substance; F02's miss was plan application |
| Files staged in the shared index from outside any lease | 1 | 3 | F01 | retired as an agent concern (environmental, proven F01); recurred environmentally in F02 (×5 sessions), pathspec defence held every time; **do not re-raise** |

### Verification of this pass

- Every claim traces to `git`, `STATE.md`, a run report, or a line of source
  read at `5ab3b07`. The nine drift items, the five column-shifted rows, the six
  stale proof cells, the error-kind list, the `stage-missing` gate, the epoch-day
  reader, the manifest-decoder gap and the theme-token coupling were each read in
  source, not taken from a session's own report. One claim was corrected during
  writing: the app theme stores copied colour **values**, not token ids — the
  first draft of `M40-ui-theme.md` said the reverse.
- Fragments re-read after writing. Thirty-three fragments now (thirty-one found,
  two created), zero remaining `<!-- csv-import-first-app SESSION-NN -->`
  markers, exactly one `## Change History` heading per file (checked
  mechanically), no fragment contradicting a sibling.
- `pnpm typecheck` exit 0. No server started, no browser suite run, no subagent
  spawned, no code changed — GATE-F02 is ACTIVE and nothing was started.
- `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` byte-identical to how this pass
  found them — and, separately, read for **adoption**, which is how the
  "authorized contract change" recommendation was withdrawn before being made.
- Files written: `arch/**` (29 reconciled, 2 created), `PROGRAM-CONFIG.md`
  (Module Registry + fragment policy + Conventions), and this entry.
  `STATE.md`, `MASTER.md`, session prompts, `specs/`, `mocks/`, `src/**`,
  `tests/**` and `.forge/**` untouched; **no git commit made**.
- Roshi did not choose product behavior, clear dispatch, mark evidence verified,
  re-slice anything, or turn a finding into a mid-run human prompt. GATE-F02
  remains the human's, unchanged.


---

## 2026-09-22 — planning-completeness pass, cycle **F03 / workbook-fidelity** (before wave 1: S01 ∥ S03)

Scoped, read-only pass per the envelope. Read in full before writing: `STATE.md`
(workbook-fidelity), all eight `SESSION-NN.md` prompts, `PROGRAM-CONFIG.md`,
this log's F01/F02 entries, and `src/migrations/005_projection_v1.sql` (to
check two contract claims against the actual SQL, not against the prompt's own
restatement of it). Orchestrator's own typecheck/lint/test re-run at `04e09b7`
(code ≡ `5ab3b07`) is taken as given. No `arch/` fragment touched, no session
file or `STATE.md` edited, no product code read for correctness beyond the two
migration checks below.

### Verified clean (no defect found)

- **Wave-1 `Owns` are disjoint.** S01's fourteen paths and S03's twenty-six
  paths share no path; the Wave Plan's prose claim matches the Files/Owns
  tables exactly.
- **Two contract claims checked against the actual SQL, not restated prose.**
  S02's `decisionKindOf` table (10 subjects) is byte-identical to migration
  005's `decision_kind` CHECK list (`005_projection_v1.sql:309-310`). S03's
  CA-20 description of the relationship guard ("source field is a `reference`
  field of the source table; target field is the target table's
  `keyFieldId`") is exactly `trg_relationships_insert_guard` /
  `_update_guard` (`005_projection_v1.sql:623-652`), and `detection_source`'s
  CHECK (`declared`,`lookup-formula`,`key-match`,`user`) matches S03's prompt
  verbatim. No contract mismatch in either.
- **Named envelope paths checked for owner gaps — none found.** No session
  touches `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`,
  `index.html`, or `src/application/view-models/security.ts` (correct: D42
  adds no new `DATA_WORKER_ERROR_KINDS_V1`/`RefusalV1` member, so the
  exhaustive map that file holds needs no edit). `src/bootstrap/**` beyond
  `import-worker.ts` (S06's one file) is untouched — nothing in the plan needs
  more of it. `harness.html` needs no edit (`import.meta.glob` reachability,
  already the standing fragment-policy fact). `tests/browser/worker/runtime.ts`
  is not owned by anyone in wave 1 (S03 is explicitly told not to edit it) and
  becomes reachable to S06 only via S06's `tests/browser/worker/**` glob later
  — S06's own prompt text confirms this ("edit `runtime.ts` only if you must,
  it is in your lease now"). All committed fixture directories
  (`tests/fixtures/workbooks/{build,ooxml,unsafe}/**` S01,
  `{biff,xlsb}/**` S04, `{ods,html-table}/**` S05, `append/**` S06) are
  disjoint and each written by exactly one session — the lease-shape
  convention holding without needing to fire.
- **The named shared-`dist/` hazard is real but already covered, and does not
  widen.** S01 (CP4) and S03 (CP2–CP4), the two wave-1 sessions, both run
  `pnpm test:browser` against the shared webServer/`dist/` build — exactly the
  hazard the envelope names, mitigated by Orchestrator's `.program/locks/dist`
  serialization. Wave 2 (S02, S04, S05) runs **no** browser suite at all — checked
  each session's own Verification section — so the exposure does not grow past
  wave 1. No other shared mutable path found.
- **The first narrow journey (S06 CP3) is reachable.** Real entry
  (`import.worker.ts` → `data.worker.ts`), real bridge (protocol v2 /
  stage-channel), a named seed (S01 CP4's pinned `fieldwork-q3.xlsx`, reused
  verbatim by S02's CP3/CP4 pins and by S06's journey spec — not
  re-described), reset/reopen (fresh worker + raw IndexedDB decode of every
  root, explicitly including source + snapshot manifests, closing this log's
  standing CL-04 finding's source half), an exact invocation
  (`SHEAF_PW_PORT=<port> pnpm test:browser workbook-journey`), and a named
  harness owner (S06, with explicit permission to edit `runtime.ts`). Every
  fact it depends on (S02's `inferWorkbook`/`decisionKindOf`, S03's
  queries/resolver/snapshot format, S01's fixture + OOXML adapter) is produced
  by a session strictly before S06 in the Dependency Graph. No gap.

### Findings

**F1 (mechanical owner-correction; does not touch wave 1).** STATE's
Dependency Graph names five serial lease handoffs explicitly, but four real
ones — all downstream of wave 1, all already correctly *sequenced* by
`S01→{S02,S04,S05}→S06→S07→S08`, so none is a concurrency risk — are missing
from that list:

1. `src/import/inference/**` (S02 → S06) is entirely absent; S06's Files
   table modifies `src/import/inference/infer.ts` and its Owns includes the
   whole directory.
2. `tests/unit/import/{refusal,preflight,sniff}.test.ts` (S01 → S06) is
   omitted — the paired *source* move (`src/import/{facts,preflight,...}/**`
   S01 → S06) is listed, but not these three test files S01 also owns and S06
   also owns.
3. `tests/browser/worker/{app,usage-journey,relationships}.spec.ts` +
   `workbook-app-fixture.ts` (S03 → S06, subsumed into S06's
   `tests/browser/worker/**` glob) is omitted; only `src/workers/**` is
   listed for the S03 → S06 handoff, a different tree.
4. `tests/unit/ui/primitives/**` (S07 → S08) is omitted alongside the listed
   `src/ui/primitives/**` move.

The pattern is the same shape each time: a serial handoff is declared for a
*source* directory and its paired *test* directory is left off the list. This
is a documentation-completeness gap in STATE.md's own summary, not a lease
conflict — every one of these paths is genuinely serial by the Dependency
Graph's own topological order, and no two sessions holding it can run
concurrently. Recommend Orchestrator add the four lines the next time it
touches STATE.md; nothing here changes a wave-1 lease or blocks dispatch.
**Worth a Vow-3 note** (no threshold applies, recording once): `PLANNER.md`
could state that a declared serial-lease-handoff line for a source directory
should name its paired test directory in the same line. 1 cycle, 4 in-plan
instances (all within this one Dependency Graph).

**F2 (mechanical owner-correction; stale inherited-obligation disposition,
evidence-backed).** STATE's inherited-obligations table carries: *"F02 S07 |
promotionIssues fieldId mapping → M37 | Assigned S06 CP3 (wire carries
fieldId) → S07 CP3 (VM)."* Checked against the current tree at `04e09b7`: the
wire-and-VM half is **already landed**, not open work. `fieldId` is carried
end to end today — `src/import/staging/promotion.ts:334` (`fieldId:
issue.fieldId` on every promotion-rejection record), through
`RecordIssueViewV1.fieldId` (`src/application/view-models/import.ts:427`),
mapped at `import.ts:838-839` (`promotionIssues: (…).map((issue) => ({
fieldId: issue.fieldId, … }))`). What is **not** landed: `src/ui/import/
review-screen.tsx:339-345` (the current F02 surface) renders only an
aggregate count ("N values were refused…"), never the per-field detail the
data already carries. So "S06 CP3 (wire carries fieldId)" describes work
that is already done and should not be read as new F03 scope for S06; the
open item is entirely S07 CP3's — consuming the already-present `fieldId` in
the rewritten multi-table "Needs attention" section to name the specific
field. Recommend Orchestrator correct the disposition text so S06 is not
asked to redo satisfied work and S07 knows precisely what remains open.

No other gap found in the reviewed scope: every CAP-19..27 row names a
producer/integration-owner/checkpoint; every CA-17..24 + CA-07 am.3 row names
a producer and correction owner; every inherited obligation besides F2 above
carries a named assignment, owned deferral, or an explicit "not F03 scope"
disposition; no circular prerequisite in the Dependency Graph; no capability
split avoidably across sessions beyond the architecture's own layering
(library → stage → surface, unchanged from F02's shape).

### Verification of this pass

- Both migration-SQL checks (F1's decision-kind list, F2's fieldId chain) were
  read from `src/migrations/005_projection_v1.sql` and the current `src/`
  tree directly, not taken from a session prompt's own restatement.
- No `arch/` fragment touched (out of scope for a planning-completeness pass);
  `STATE.md`, `MASTER.md`, session prompts, `src/`, `tests/`, `specs/`,
  `mocks/` untouched. This entry and nothing else was written.
- Did not redesign the plan, edit a session file or `STATE.md`, choose
  product behavior, or clear dispatch. F1/F2 are reported for Orchestrator to
  route; neither changes a wave-1 lease, so nothing here need block S01 ∥ S03.
---

## 2026-09-23 — final pass, cycle **F03 / workbook-fidelity**

Base `04e09b7` (planning review revision), final `425562d` (code ≡
`30396a9`). Read in full before writing: `FINAL-REPORT.md`
(`prompts/workbook-fidelity/`); `STATE.md` end to end (375 lines, all nine
session handoffs, Capability Readiness, Contract Agreements, Current
Blockers, Design Decisions D30–D48, Planning Review); all thirty-nine
`arch/` fragments; `PROGRAM-CONFIG.md`; this log's F01, F02-interim and
F02-final entries, and the F03 planning-completeness entry immediately
above; `program-agents/ORCHESTRATOR.md` and `program-agents/PLANNER.md`
(read for Principle 3 adoption checks, grepped for specific evidence, not
skimmed). No product code read for correctness beyond spot checks already
performed by the fragments' own session evidence and two independent greps
(`@types/libsodium-wrappers-sumo` absence, the three snapshot/source-
manifest decoders' consumers) reported below under the cleanup ledger.

### Verdict on the cycle

Eight Planner sessions, thirty-one planned checkpoints, two owner
corrections, one crash recovery — zero sessions ended blocked at final
receive, every planned checkpoint landed. All nine capabilities (CAP-19
through CAP-27) and all eight new/amended contract agreements (CA-17..CA-24,
CA-07 am.3) are verified at the F03 tier against current sources, per
Orchestrator's own re-run gates recorded in STATE.md (typecheck 0, lint 0,
155 files / 1728 passed / 3 skipped, 57 e2e passed at `30396a9`). The feature
now halts at GATE-F03, a standing human product-design gate; nothing here
changes that.

### Drift found and reconciled (`arch/`)

Thirty-one fragments touched by F03 deltas (seven new-module fragments
seeded at planning — M03, M15, M16, M17, M18, M20, M65 — plus twenty-four
extended F01/F02 fragments), all reconciled: every
`<!-- workbook-fidelity SESSION-NN -->` / `<!-- workbook-fidelity OWNER-* -->`
marker folded into its head contract and removed (verified by
`grep -rl "<!--" arch/` returning nothing). Five were substantive rather than
cosmetic:

1. **`M12-projection.md` carried a closed gap as open.** The F02 final
   fragment said `import_lineages`/`inference_decisions` had "no
   constructible F02 input" and named F06/F03 as the feature that would
   supply one. F03 did: the checkpoint carries both as projectable roots and
   M23's promotion/append write them. Moved to a "Closed in F03" section with
   the producer named, and the tail-commit "no schema row" sentence corrected
   to name F03's one exception (`table.created` in an append tail, which the
   F02 text predates and would otherwise read as contradicting M23's landed
   append path).
2. **`M37-view-models.md` carried two closed gaps as open and a file that
   was never created as an unexplained absence.** The F02 final fragment's
   "Known gaps" section listed live-region pluralization and the missing
   `promotionIssues.fieldId` mapping as open; both closed inside F03 (S08 CP1;
   S06's wire + OWNER-PROMOTION-SEAMS's field/table naming) without a return
   trip through this file. Both moved to "Closed in F03" with their closing
   commits. Separately, S08's own delta noted `view-models/snapshots.ts` "never
   created — snapshot VMs live in `records.ts`" as a bare surprise; promoted
   into the fragment's own Files/Contract section as the current, permanent
   fact about the module's shape, not a residual curiosity.
3. **`M44-ui-records.md` carried three closed gaps as open.** MOD-10's
   missing deleted-record read, the single-table change history, and
   unit-only paging were all F02-recorded gaps F03 closed (S03's query, S08's
   consumption; S03/S08's `tableId`; S08 CP4's full-selection e2e exercising
   Jobs' 61-row paging past 50). Moved to "Closed in F03".
4. **`M36-workflows.md` and `M43-ui-import.md` each carried a delta that
   described an already-superseded intermediate state as though it were the
   landed one.** S06's mechanical single-table adaptation of the import
   machine and review screen was staple #1 in both fragments; S07's real
   two-branch/multi-table rewrite fully replaced that adaptation two
   checkpoints later, staple #2. A reader taking either fragment top-down
   would land on S06's now-superseded shape. Folded into one description of
   the module as it now stands, per Principle 2 — "the head contract is the
   authoritative statement; a delta that supersedes it is folded in, not left
   below it" applies to a delta superseding a **sibling delta** exactly as it
   applies to a delta superseding the seeded head.
5. **`M18-ods.md` and `M65-workbook-facts.md` each described a defect and its
   fix as two separate, chronologically ambiguous notes.** The ODS
   declared-table-after-rows defect (S05's landed order) and its correction
   (OWNER-IMPORT-F03-SEAMS) sat as sibling deltas with no stated relationship.
   Folded into one "F03 correction" section per fragment stating the
   **current**, corrected stream order once, with the defect's shape and
   evidence kept as history underneath it — not the defective order followed
   by a patch note a reader has to resolve themselves.

Everything else was merge-and-normalize: session-level facts promoted into
the fragment that owns them (M13's CFB no-ranged-read known limit
cross-referenced from M17 rather than restated; M20's HTML key-match known
limit cross-referenced from M21 rather than restated; M38's backlog carried
forward with an explicit note that F03 touched the module twice without
closing any of its three open items). No fragment was created by this pass
(unlike F02's three moves) — **F03 needed no move**: every session's delta
landed in the fragment its own module owns, confirmed by inspection of all
thirty-one touched fragments.

`PROGRAM-CONFIG.md`: added the F03 landed-modules table (seven new modules,
twenty-four extended, nine unchanged, git-verified at `425562d`); corrected
the Stack table's Containers row — **D30's fallback is what shipped**, not
the primary plan (`@zip.js/zip.js` was never installed; `src/import/source/
{zip,xml,cfb,opc}.ts` is a from-scratch reader with no third-party package),
verified by `grep` finding no `@zip.js` entry in `package.json`/
`pnpm-lock.yaml`; extended Custom Rule 7 with F03's first observed
**mirror-direction** instance (a planned file, `view-models/snapshots.ts`,
that no checkpoint needed — the rule already covers this without amendment);
recorded F03 evidence for the three already-promoted Vow-4 conventions
(closed-union-and-exhaustive-map held with zero new instances because D42
named the sole extender at planning time; the lease/module-map rule held
with zero new instances because S01's fixture toolkit was planned into its
own lease from the start). No PROGRAM-CONFIG convention crossed a **new**
promotion threshold this pass — see "Conventions promoted" below for why,
stated rather than left to silence.

### Findings reconciled outside `arch/` (reported to Orchestrator, not edited)

Reported here because Roshi/Archivist does not edit `STATE.md`; both were
already corrected before dispatch, at the F03 planning-completeness pass
(this log, 2026-09-22, log commit `2b16638`), and are confirmed landed as
recorded, not re-opened:

- The Dependency Graph's four missing serial-handoff lines (source
  directories listed without their paired test directories) — completed.
- The stale `promotionIssues` inherited-obligation disposition (a satisfied
  F02 obligation reading as open F03 work) — corrected.

### Conventions promoted to PROGRAM-CONFIG (Vow 4)

**None this pass.** Every pattern that fired in F03 either (a) is already
promoted and held (zero new instances — the closed-union rule, the lease/
module-map rule), (b) fired but stayed below both of Vow 4's axes (the
sequential-delta-supersession shape in item 4 above: two instances, not
three), or (c) is a planning-time documentation-completeness gap without a
mechanically-checkable shape a `module-boundaries.test.ts`-style assertion
could enforce (the serial-handoff paired-test-directory omission — see
Proposed for the framework, below). Recording "none" here is a claim I can
defend line by line, not a default.

### Proposed for the framework (Vow 3 — recommendations only, never edits)

Adoption checked by **reading the current text** of `program-agents/
ORCHESTRATOR.md` and `program-agents/PLANNER.md` (this program's copies —
`CODER.md`/`UI-CODER.md` were not implicated by any carried recommendation)
and grepping for the specific substance each recommendation names, not by
observing that Archivist did not write them. These files are untracked in
this repository (`git log` on them returns nothing), so adoption is a claim
about the human's action based on content read at this pass, exactly as
every prior Roshi pass recorded it.

**Now adopted — stop carrying:**

- id `b06241fe8526baa2` **"Landed proof legs left in STATE's `planned:` list
  at receive"** (F02, 13 in-cycle instances). `ORCHESTRATOR.md`'s "Receiving
  a Coder" step 7 now reads: *"**CA/CAP status invariant — check before
  commit.** No Contract Agreement row may read `Producer: planned` or `Proof:
  planned` when the producer or proof has landed... This has been the
  largest single-cycle drift row in the log."* The rule is stated, cites its
  own evidence, and names the exact defect class D-01/S-02 recorded. **F03 is
  positive corroborating evidence it worked**: across nine session receives
  and two owner-correction receives, this pass found zero stale `planned:`
  cells in F03's Capability Readiness or Contract Agreement tables — every
  row I checked already named its landing commit. Row marked adopted.

**Still open, re-checked and re-raised:**

1. id `442cb40af6e1a830` **"No interim drift check scheduled below 16
   sessions."** `ORCHESTRATOR.md:725-726` is unchanged: *"1-15 sessions: no
   additional interim drift checks by default. 16+ sessions: run interim
   Archivist after every completed wave..."* F01 and F02 each got an ad-hoc
   interim check anyway (Jikijitsu/Orchestrator wrote one into the ledger by
   hand, citing this very recommendation) and both caught real drift while
   sessions were still live. **F03 did not get even the ad-hoc mitigation**:
   Final Report states plainly, *"With 8 sessions, no interim drift checks
   were configured."* This pass then found five fragments (M12, M37×2, M44×2)
   still recording gaps their own F03 sessions had closed — exactly the
   shape an interim check would have caught mid-run, as F01's four and F02's
   ten instances already demonstrated. **3 cycles, 5 new in-cycle instances**
   (15 total across F01+F02+F03). The pattern is not weakening; the ad-hoc
   mitigation that partially covered it in the first two cycles did not fire
   in the third.
2. id `f1442f23b7f0949d` **"Archivist's envelope write set omits the cleanup
   ledger `ARCHIVIST.md`/`ROSHI.md` requires it to own."** The final-pass
   envelope template in `ORCHESTRATOR.md`'s "Calling Archivist" section
   (~line 878) lists exactly `STATE.md`, `arch/`, `PROGRAM-CONFIG.md`,
   `ARCHIVIST-LOG.md` — no `CLEANUP-LEDGER.md`. Resolved conservatively a
   fourth time: this pass's cleanup findings are carried inside this entry
   (below), and no file named `program/sheaf/CLEANUP-LEDGER.md` exists on
   disk. It still costs nothing this cycle (no campaign crossed a briefing
   threshold), but the gap between the role contract and the envelope
   template has now stood through three full cycles unchanged. **3 cycles, 4
   instances** (one per final/near-final pass that had to work around it).
3. id `f279893d1ad0a40d` **"`Owns` authoritative, Files table indicative"**
   — already promoted (Custom Rule 7); no new Vow-3 action needed, but F03
   produced this rule's first confirmed **mirror-direction** instance (a
   planned file no checkpoint needed, S08's `view-models/snapshots.ts`),
   recorded in PROGRAM-CONFIG's Custom Rule 7 text itself rather than here,
   since the promoted rule already covers it without amendment.
4. **NEW — id `1f54dec2254e8f15`.** `PLANNER.md`: a declared serial-lease-
   handoff line for a source directory should name its paired test-directory
   handoff in the same line. The F03 planning-completeness pass (this log,
   2026-09-22) found four instances of the same gap shape inside one
   Dependency Graph: `src/import/inference/**` was listed for its S02→S06
   handoff without `tests/unit/import/infer.test.ts`; the S01→S06 source
   move omitted its three paired refusal/preflight/sniff test files; the
   S03→S06 worker-file handoff omitted the three paired browser-worker
   specs; the S07→S08 primitives move omitted `tests/unit/ui/primitives/**`.
   None was a lease conflict (all four were already correctly sequenced by
   the Dependency Graph's own topological order) — purely a documentation-
   completeness gap in the plan's own summary, corrected before dispatch and
   costing nothing. **1 cycle, 4 in-plan instances**, all within one
   Dependency Graph — recorded once, per Vow 3's no-threshold rule, exactly
   as that pass itself flagged it.
5. **NEW — id `1c51a85390a3f964`.** `PLANNER.md`: when two sessions
   scheduled in the **same wave** both produce into a shared fact vocabulary,
   and a downstream consumer session states an ordering/shape rule for that
   vocabulary, a rule one of the wave-mates discovers **mid-session** (not
   already stated in either's own plan) has no channel to reach the other
   wave-mate, because they are running concurrently by construction. F03's
   S02 (inference) discovered, from reading M65's fact stream, that a
   declared table's fact must precede its sheet's first row fact — and wrote
   this into its own followUp for S06. S05 (ODS adapter), dispatched in the
   **same wave** as S02, had no way to receive that followUp before building
   its own adapter, and shipped an ODS stream with declared-table facts
   *after* the rows — closed only by an owner correction
   (OWNER-IMPORT-F03-SEAMS) after S06 caught the mismatch at the worker tier.
   Contrast with D35 (M14 never imports an adapter): a *structural* rule the
   plan stated in advance for every adapter session, and which held for all
   five formats without incident. The lesson is about the *undeclared* rule a
   sibling only discovers by doing the work — decomposition cannot always
   see this in advance, but the plan can reduce the blast radius by
   sequencing a wave so that a downstream consumer's own early checkpoint (if
   one exists before the full wave completes) is available to writeback into
   siblings' followUps, or by explicitly flagging "shared fact vocabulary,
   ordering unconfirmed" as a checkpoint-0 cross-check for every adapter
   session sharing one. **1 cycle, 1 instance** — recorded now because Vow 3
   has no threshold and the next multi-adapter or multi-producer wave is
   exactly where it can fire again.

### Cleanup scout (read-only; nothing deleted, nothing rewritten)

Spot-checked two standing ledger items directly in source at `30396a9`
(not re-derived from a session's own claim):

| ID | Finding | Evidence at `30396a9` | Confidence | Blast radius | Proposed check | Status |
|---|---|---|---|---|---|---|
| CL-01 | `@types/libsodium-wrappers-sumo` inert pin | **Resolved.** `grep -n "@types/libsodium" package.json` returns nothing; only the real runtime dependency `libsodium-wrappers-sumo@0.8.4` remains. STATE.md's inherited-obligations table assigned this to S01 CP1 (S01 held the root manifests in F03) and the pin is gone. | high | root manifest | `pnpm install --frozen-lockfile && pnpm typecheck` (confirmatory only, not required) | **retired — resolved** |
| CL-02 | `tests/browser/fixtures/smoke.module.css` proves a **unit**-runner setting from the browser fixtures dir | Still present at `tests/browser/fixtures/smoke.module.css`; no F03 session touched `tests/browser/fixtures/**` | medium | one fixture + one include glob | relocate, then `pnpm test` | tracking |
| CL-03 | F01 value exports with no consumer (~17 at F02 close) | **Not re-scanned this pass** — a full whole-word grep across `src/`+`tests/` for the F02 list was not repeated; not re-derived without doing the check | low | none today | re-scan at F04 planning; classify per module | tracking (unchanged) |
| CL-04 | Source and snapshot manifest decoders had no consumer | **Resolved.** `grep -rn "decodeSourceManifest\|decodeSnapshotManifest\|decodeSnapshotChunk" src tests` shows `decodeSnapshotManifest`/`decodeSnapshotChunk` consumed by `src/import/snapshots/sheet-snapshot.ts` (F03's `readSnapshotPage`), and `decodeSourceManifest` consumed by `tests/unit/staging/promotion.test.ts` and `tests/browser/worker/workbook-roots.ts` (F03's worker-tier journey, which decodes it from raw IndexedDB). | high | none (was D21's recoverability claim; now proven) | none needed | **retired — resolved** |
| CL-05 | Exported-but-unconsumed value surface growing (92 symbols at F02 close) | **Not re-scanned this pass** — F03 added a large new surface (M03, M15–M20, M65) that a fresh scan would need to classify; not re-derived without doing the check | low | none today | re-scan at F04 planning per the standing Forge cleanup brief ("Prove or name every unconsumed export") | tracking (unchanged; likely larger, not measured) |

No campaign crosses a briefing threshold this pass (two items resolved, none
newly high-confidence). **No new cleanup brief emitted.** The standing F02
brief ("Prove or name every unconsumed export") remains open and unaccepted;
its scope (CL-03/CL-05) is unchanged in status, only unmeasured this pass.

### Standing recommendations (full open backlog — carried forward from here)

| id | pattern | cycles | in-cycle instances | first seen | status |
| --- | --- | ---: | ---: | --- | --- |
| `27bf4a350ec2f23c` | A dependency must-not ships as a test, not a review note | 3 | 5(F01)+3(F02)+5(F03) | F01 | promoted → PROGRAM-CONFIG Conventions |
| `33dba11758afa4e2` | Encode a must-not as a type or a runtime throw | 3 | 5(F01)+8(F02)+3(F03) | F01 | promoted → PROGRAM-CONFIG Conventions |
| `3e30962a53a57c2f` | Test filters take no bare `--` | 1 | 3 | F01 | promoted → PROGRAM-CONFIG Conventions; no F02 or F03 instance |
| `f279893d1ad0a40d` | `Owns` authoritative, Files table indicative | 3 | 7(F01)+9(F02)+12+(F03) | F01 | promoted → Custom Rule 7; F03's first mirror-direction instance recorded |
| `3ddf907567cd76e6` | Arch fragment head contract superseded by its own delta | 3 | 4(F01)+6(F02)+6(F03) | F01 | promoted → fragment policy; still firing each cycle |
| `b73d9bab7c196038` | Lease or boundary sweep drawn over the wrong tree | 2 | 3(F02) | F01 | promoted at F02 interim → PROGRAM-CONFIG Conventions; held — 0 new instances F03 |
| `d7d81c3b2cf8e9c9` | Closed union and its exhaustive map split across leases | 1 | 3 | F02 | promoted → PROGRAM-CONFIG Conventions; held — 0 new instances F03 (D42 pre-named the extender) |
| `f823e9a910b0a671` | A delta describing another module | 2 | 4(F01)+4(F02) | F01 | promoted → fragment policy; held — 0 new instances F03 |
| `442cb40af6e1a830` | No interim drift check scheduled below 16 sessions | 3 | 4(F01)+10(F02)+5(F03) | F01 | open (Vow 3 → ORCHESTRATOR.md); worsened in F03 — no ad-hoc mitigation applied at all |
| `f1442f23b7f0949d` | Archivist envelope write set omits the cleanup ledger it is asked to own | 3 | 1(F01)+2(F02)+1(F03) | F01 | open (Vow 3 → ORCHESTRATOR.md) |
| `b06241fe8526baa2` | Landed proof legs left in STATE's `planned:` list at receive | 1 | 13 | F02 | **adopted** — ORCHESTRATOR.md's receive step 7 CA/CAP status invariant; F03 shows zero recurrence |
| `b027c25ef168decb` | STATE table rows that lose a cell go unnoticed | 1 | 6 | F02 | open (Vow 3 → ORCHESTRATOR.md); no new instance found in F03 (not exhaustively checked) |
| `06e04ece038e736d` | A module no session leased has no route into its own fragment | 1 | 6 | F02 | open (Vow 3 → ORCHESTRATOR.md); 0 new instances F03 |
| `3261d808a9c412da` | FORGE-CONFIG Verification Commands has no post-baseline maintainer | 1 | 2 | F01 | adopted (rule + supersession text exist); table itself is now two cycles behind (`5ab3b07`, not `30396a9`) — reported to Forge/Jikijitsu per its own text, not re-opened as a new recommendation |
| `1a8974acd0d1350e` | Checkpoint boundary blur: capability bodies and proofs split across checkpoints | 2 | 2(F01)+0(F02) | F01 | retired — settled negative at F02; no F03 instance found either (32+31 checkpoints, one crash-driven recovery, not a sizing failure) |
| `26e3bdf9a1e6dd6f` | Authorized contract change breaks a consumer outside the lease | 1 | 1 | F02 | not proposed — substance already present in the role docs |
| `6fdb29d40829b4ec` | Files staged in the shared index from outside any lease | 1 | 3 | F01 | retired as an agent concern (environmental, proven F01); do not re-raise |
| `1f54dec2254e8f15` | A declared serial-lease-handoff line for a source directory should name its paired test-directory handoff | 1 | 4 | F03 | open (Vow 3 → PLANNER.md) |
| `1c51a85390a3f964` | A rule a concurrently-dispatched sibling session discovers mid-run has no channel to reach another concurrently-dispatched sibling building against the same shared fact vocabulary | 1 | 1 | F03 | open (Vow 3 → PLANNER.md) |

### Verification of this pass

- Every claim above traces to `git`/`STATE.md`/a run report/a line of source
  read at `30396a9`, or a grep re-run at this pass (the `@zip.js`,
  `@types/libsodium-wrappers-sumo`, and the three snapshot/source-manifest
  decoder consumer checks were each executed fresh, not taken from a
  session's own report).
- Fragments re-read after writing. Thirty-nine fragments total (thirty-one
  reconciled, eight untouched — M08, M09, M11, M39, M40, M41, M42, M50,
  M55, confirmed by their own F03 session notes reporting no change, or by
  the absence of any F03 delta), zero remaining
  `<!-- workbook-fidelity ... -->` markers (`grep -rl` confirms), one
  `## Change History` section per touched fragment, no fragment contradicting
  a sibling — cross-checked in particular for M12/M23 (checkpoint roots),
  M32/M37 (the closed-union contract), and M36/M43 (the import machine/review
  screen shape), which each describe the same landed fact from two module
  fragments and now agree.
- `program-agents/PLANNER.md`, `CODER.md`, `UI-CODER.md`, `ORCHESTRATOR.md`
  and `ARCHIVIST.md` byte-identical to how this pass found them — verified by
  reading them read-only and never invoking a write tool against
  `program-agents/**`. Read for adoption via targeted `grep`, which is how
  the `planned:` recommendation changed status and the interim-check and
  cleanup-ledger recommendations did not.
- `STATE.md`, `MASTER.md`, session prompts, `specs/`, `mocks/`, `src/**`,
  `tests/**` and the run folder untouched. Only `arch/**` (31 files),
  `PROGRAM-CONFIG.md`, and this log entry were written.
- Archivist did not choose product behavior, clear dispatch, mark evidence
  verified, re-slice anything, or turn a finding into a mid-run human prompt.
  GATE-F03 remains ACTIVE and the human's, unchanged by this pass.

