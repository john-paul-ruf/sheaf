# ROSHI-LOG — Sheaf

Append-only. One dated entry per Roshi pass. Newest last.

---

## 2026-09-08 — final pass, cycle **F01 / foundation-first-unlock**

First entry in this log; there was no prior backlog to carry forward. Base
`f0b1ec4`, final `2c0248a6f1764a67695c761bcb5df4dfc5b27714`, specs `3b836f2`.
Read in full before writing: `.forge/FINAL-REPORT.md`, all seven
`.forge/results/SESSION-NN.result.md`, `.forge/results/ROSHI-PLANNING.result.md`,
`.forge/{roshi-notes,decisions,ledger,blockers}.md`, `STATE.md` end to end, all
nineteen `arch/` fragments, `FORGE-CONFIG.md`, and `git log` from `e8cf9c9`
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

`FORGE-CONFIG.md` module registry: added the F01-landed module list
(git-verified), added `harness.html` + `src/harness/**` and the four missing
root manifests to the owner-seam paths, and corrected M33's Path — the shipped
leasing unit is `src/workers/**`, not `src/workers/*.worker.ts`, because the
entry is a composition root and every command body lives in `src/workers/data/`.

**Reported, not corrected — no owner:** `FORGE-CONFIG.md`'s **Verification
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

2. **`FORGE-CONFIG.md`'s Verification Commands block has no maintainer after
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
