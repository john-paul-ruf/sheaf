# Final Report — Sheaf / workbook-fidelity (F03)

## Summary

F03 "workbook fidelity" is **built**. All 8 planned sessions are done, all 31 planned checkpoints
are committed, and every in-scope required capability (CAP-19 through CAP-27) is **verified** at the
F03 tier against current sources. The feature now **halts at GATE-F03**, a standing human
product-design gate: nothing from F04 is dispatched or planned until the human records a verdict in
the ROADMAP Gate Log.

What a user can now do, through the real `index.html` entry and the production workers, fully
offline:
- **Import workbooks.** Pick a `.xlsx`, `.xlsb`, `.xls`, `.ods` or HTML-saved-as-`.xls` file. A
  metadata-only pre-flight names each sheet and its estimates. The user then chooses sheets that fit
  the budget or gets desktop-handoff instructions. Macro workbooks and unsafe containers are refused
  outright.
- **Review one proposal.** The selected sheets stream in with named progress. Inference produces one
  editable proposal covering tables, keys and labels, enums, relationships with named evidence,
  preserved formulas, sheet classifications and inert items. Relationships can be rejected,
  restored or retargeted.
- **Get a multi-table app.** Creating builds an encrypted multi-table app that survives restart.
  Records are navigable across relationships in both directions. Broken references keep their
  original key and can be repaired. A reference picker and a table switcher are available.
- **Read sheet snapshots.** Every imported sheet has a read-only snapshot with merges, inert
  markers, find and discarded rows, plus an inert-item inventory.
- **Append CSV/TSV.** A CSV or TSV file can be added to an existing app as a new table.

## Sessions

| S | Title | Status | Checkpoints | Commits |
|---|---|---|---|---|
| 01 | Container spine, fact vocabulary v2, OOXML adapter & workbook pre-flight | done | 4/4 (+CP0 probe) | `dd1ff9e` `a363041` `cbfb0c5` `64bc49a` |
| 02 | Workbook inference & the formula-reference parser | done | 4/4 | `43ba6a1` `8fe6d2b` `d53f182` `3e99aa1` |
| 03 | Relationship, snapshot & inventory read model | done | 4/4 + 1 correction | `f29ac33` `b64c70a` `0dc78a8` `712016b` `a2c4cf0` |
| 04 | Binary Excel adapters: BIFF/XLS, XLSB, shared Ptg decoder | done | 4/4 | `4805e2c` `8641da1` `56c125c` `5e92124` |
| 05 | ODS and legacy HTML-table adapters | done | 3/3 | `871924f` `c77edba` `5df4b01` |
| 06 | The workbook import column at the worker tier | done | 4/4 | `4287569` `4a6f01a` `2c978ca` `677b947` |
| 07 | Import journey surfaces | done | 4/4 + 1 correction | `2185774` `0ac34d3` `7572eda` `79e2c83` `e062f41` |
| 08 | App relationships, snapshots & the GATE-F03 journey | done | 4/4 | `eba5790` `36a33e7` `4adfe06` `30396a9` |
| OWNER-IMPORT-F03-SEAMS | owner correction (not a Planner session) | done | 2 | `3a32561` `87da253` |
| OWNER-PROMOTION-SEAMS | owner correction (not a Planner session) | done | 2 | `cd4fe9d` `0634e81` |

**Sessions done: 8/8.**

## Files

From planning base `04e09b7` to HEAD `425562d`, 48 commits:
- 404 files changed: 257 added, 146 modified, 1 deleted (`src/import/formats/delimited/facts.ts`, D32).
- +58,818 / −3,675 lines, including binary fixture corpora.

## Architecture impact

Arch deltas were integrated after every session under `<!-- workbook-fidelity SESSION-NN -->`
markers:
- **New modules:** M03 (formula parser subset), M16/M17 (XLSB/BIFF), M18/M20 (ODS/HTML-table) and
  M65 (workbook fact vocabulary v2).
- **Extended modules:** M01, M02, M07, M12–M15, M19, M21–M23, M32–M38, M43, M44, M51, M53, M54,
  M58 and M61.
- **SESSION-08 delta:** commit `425562d` (M36, M37, M38, M44, M54, M61).
- **Contract changes:**
  - CA-07 amendment 3 landed: the app area gains `#/app/{id}/snapshots` and
    `#/app/{id}/snapshots/{sheetId}`, both unlocked-only.
  - CA-11 was amended deliberately to multi-table plus D37.
  - Protocol changes are additive; `IMPORT_PROTOCOL_VERSION` is still 1.
  - `DATA_WORKER_ERROR_KINDS_V1` was not extended (D42).

## Verification (Orchestrator-run, exit codes read)

All results below are at code revision `30396a9` (HEAD `425562d`; the only change since is the arch
delta).

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Unit + property | `pnpm test` | exit 0; 155 files, 1728 passed, 3 skipped (baseline at planning: 104 files, 1024 passed) |
| E2E, full | `SHEAF_PW_PORT=8083 pnpm test:e2e` | 57 passed (baseline: 36), run under the `.program/locks/dist` lock; port freed afterwards |
| GATE-F03 demo spec | `SHEAF_PW_PORT=8083 pnpm test:e2e gate-f03` | 1 passed |
| Full chain | `pnpm verify` (typecheck + lint + test + build) | reported exit 0 by SESSION-08; Orchestrator ran each component separately |

The browser worker suites were re-run by Orchestrator at the receives of S03, S06 and
OWNER-PROMOTION-SEAMS, with results recorded in STATE.md.

## GATE-F03 demo package

- **Revision:** `30396a96511a997297f51aab64e12f2a86a2645f`
- **Command:** `SHEAF_PW_PORT=8080 pnpm build && pnpm preview --port 8080 --strictPort`. Coder
  reported HTTP 200 and served `window.__sheafBuildId` = `30396a96511a…` ≡ `git rev-parse HEAD` at
  the time. The server was killed and ports 8080 and 8081 were left free. Orchestrator did not
  re-run the preview; the demo spec passed on 8083 at the same code.
- **Executable script:** `tests/e2e/gate-f03-demo.spec.ts` runs the ROADMAP F03 script verbatim at
  320 px with the offline guard on:
  1. Import the multi-sheet `.xlsx`.
  2. Deselect Archive.
  3. Review the evidence ledger.
  4. Reject Visits→Jobs.
  5. Create the app.
  6. Navigate related records.
  7. Open the Overview snapshot.
  8. Pick the macro workbook → whole-import refusal.
  9. Pick the oversized workbook → the handoff card with its exact D31 conditional copy and a
     clipboard read-back.
- **Full 7-sheet selection** (Archive 2018 included) also works now. It is proven in
  `snapshots.spec.ts`: 7 snapshots, and Archive 2018 holds 2,000 records before and after reload
  plus unlock.
- **Intentionally absent at GATE-F03:**
  - Live formulas: preserved, not recalculated. **F04.**
  - Live charts and dashboard metrics: charts are preserved as inert items. **F04.**
  - Schema and relationship editing after creation. **F04.**
  - Device-sensitive import budgets. The handoff card's conditional "larger local budget" copy
    depends on this. **F07** (D31).
  - Desktop→phone adoption. **F06.**
  - Export sheet: SHT-016 shows it disabled with "Export arrives in a later release." **F07.**
  - Known limit: the legacy HTML demo pair produces no key-match relationship, because containment
    is 0.967, below the 0.98 threshold. This was a conservative default. The `.xlsx` demo shows the
    lookup-formula relationship.
- **For the reviewer's eye:**
  - **D43 composed copy (SESSION-08 surprise 7).** The notable departure from the mock is
    "Open in {table} →" where the mock has "Open customer →", because there is no singularization
    source.
  - **S07 mock departures (S07 surprise 7).**
  - **S07 captures** in `.program/scratch-s07/shots/*.png` (local scratch only).

## Residual gaps and follow-up (owners named)

- **Unit-level only:** `append-too-large` after a passing estimate is proven only in unit tests. It
  has no surface e2e. Owner: next session leasing the import machine/e2e (carry to F04 planning).
- **Unverified BIFF12 layouts (S04 surprise 4).** They are self-consistent with our own fixtures
  only. Owner: GATE-F03 reviewer or F04 planning, with a real Excel-authored `.xls`/`.xlsb`.
- **CFB ranged read.** A `streamStream(path, {offset})` would make the BIFF CA-18 proof byte-level.
  Owner: next session leasing `src/import/source/cfb.ts` (hardening, not required).
- **External-workbook names.** M03 refuses `[1]!Name`. Owner: F04 formula owner.
- **Single-id baseline field.** `import.accepted.originalBaselineStorageId` names only the first
  baseline page. Owner: M01/database owner at F06 planning; re-upload must read `baselinePages`.
- **`inferProposal` still present.** It is removable once the S02 tests stop calling it (7 files
  still reference it). Owner: next session leasing `src/import/inference/**`.
- **Optional-on-type fields.** Checkpoint F03 roots and `ValidationContext.referenceTargets` stay
  optional because of the F02 decode KAT (S06). Owner: next M01/M02 lease.
- **Planned file never created.** `src/application/view-models/snapshots.ts` does not exist; the
  snapshot VMs live in `records.ts`. Arch M37 records this.

## Orchestration

**Concurrency:** 3   **Wall clock:** ≈ 5 h 30 min. The planning review commit was at 22:18 on
2026-09-22, first dispatch at 22:20, and the last receive at about 03:50 on 2026-09-23. The time
includes the host crash gap during SESSION-08.
**Sessions run:** 8 Planner sessions, 2 owner corrections and 1 recovery re-dispatch.
**Checkpoints committed by Coder:** 31 planned checkpoint commits plus 2 in-lease correction
commits, counted from `git log`. Owner corrections added 4 code commits.
**Binding:** Native (`mcp__demiurge__spawn_subagent` / `await_subagent_result`).

### Wave plan as executed
| Wave | Sessions | Notes |
|---|---|---|
| 1 | S01 ∥ S03 | 22:20 |
| 2 | S02 ∥ S04 ∥ S05 | Rolling refill after S01, 23:04–23:06 (S03 ended 23:05) |
| 3 | S06 | Serial, 23:56. First narrow journey at CP3 `2c978ca` |
| 4 | S07 ∥ OWNER-IMPORT-F03-SEAMS | 01:11; disjoint write sets |
| 5 | S08 ∥ OWNER-PROMOTION-SEAMS | 02:31. S08 attempt 1 lost with the host after CP3; recovery attempt 2 launched 03:40 |

### Blocked
None open.

### Blocker escalations
| S | Class | Action / human ask | Disposition |
|---|---|---|---|
| 06 | Counterexample + mechanical seam | OWNER-IMPORT-F03-SEAMS: ODS emits declared tables before rows; finish D32 | Cleared (`3a32561`, `87da253`) |
| 06 | Informational | HTML pair has no key-match. Conservative default: accept and list as a known limit | Decided |
| 07 | Counterexample + mechanical seam | OWNER-PROMOTION-SEAMS: 7-sheet promote `integrity` defect (root cause was a single baseline page over the 512 KiB limit, plus quadratic paginate); additive `columnKey` naming | Cleared (`cd4fe9d`, `0634e81`) |
| 08 | Crashed (host died; handle unknown; no handoff) | Recovery worker on unchanged lease r1; CP4 WIP preserved in the tree and as a patch | Cleared (`30396a9`) |
| GATE-F03 | Standing human gate | Human verdict on the demo at `30396a9` in the ROADMAP Gate Log | **Awaiting human** |

No human interruptions were needed during the run.

### Interim Archivist checks
| After wave | Sessions received | Result | Drift found | Actions |
|---|---|---|---|---|
| Pre-wave-1 (planning completeness) | — | done (log `2b16638`) | 2 mechanical findings | Serial-handoff list completed; promotionIssues disposition corrected |

With 8 sessions, no interim drift checks were configured.

### Lease violations
None. Every checkpoint and correction commit was checked with `git show --name-only` against its
lease. The host-written `.gitignore` diff (`/program/sheaf/runs/`, `/program/sheaf/STATE.md`) sits
outside every lease. No Coder committed it. Orchestrator committed it verbatim in its own commit
at run close so the working tree is clean. That change only ignores host run artifacts; it is
not destructive, and it is recorded in decisions.md.

### Checkpoint shortfalls
None at acceptance. SESSION-08 attempt 1 ended at 3/4 because of a host crash, not a sizing
problem, and attempt 2 completed CP4.

### Wave plan corrections
None. Planner's concurrent pairs were verified path by path with no overlap. Two operational
additions were made:
- The shared `dist/` build output was serialized by the `.program/locks/dist` lock.
- Owner corrections ran concurrently only where write sets were disjoint.

### Granularity feedback for Planner
- **No context exhaustion.** No session exhausted its context, and every session committed each
  checkpoint.
- **Wrong premise in S03's plan.** "`listTables` gains row counts" named an RPC that did not exist.
  S03 added `listTables{appId}`.
- **Wrong fixture premise in S08 CP4.** The session expected a merge on Overview, but the demo
  workbook's only merge is on Crew.
- **Planned file not needed.** S08's Files table listed `view-models/snapshots.ts`, which was never
  needed.
- **From the planning review.** Source-directory handoff lines should name their paired
  test-directory handoffs (4 instances).

### Process effectiveness
- **First-dispatch completion: 7/8.** S08 was re-dispatched after an environment failure (host
  crash); that was not a planning defect.
- **Unplanned corrections: 2 separate owner workers.**
  - OWNER-IMPORT-F03-SEAMS (CAP-27 ODS leg; D32 cleanup). Reason: S05's adapter emitted facts in an
    order that violated S02's rule.
  - OWNER-PROMOTION-SEAMS (CAP-21, CAP-22, CAP-23). Reason: a latent 512 KiB baseline-page overflow
    that only the full 7-sheet selection exposed.
  - No same-context lease revisions were needed.
- **Integration rework after acceptance:**
  - The two owner corrections above.
  - In-lease correction commits `a2c4cf0` (S03) and `e062f41` (S07).
  - The ODS fix changed an S06 promotion pin.

### Capability completion
Every capability below was verified against current sources, all at the F03 tier.

| CAP | Status | Proof (latest) |
|---|---|---|
| CAP-19 | verified | S06 worker; S07 `0ac34d3` / `79e2c83` e2e |
| CAP-20 | verified | S01 routes; S07 e2e subset + handoff; F07/F06 legs out of scope |
| CAP-21 | verified | S07 e2e; OWNER-PROMOTION-SEAMS `cd4fe9d` worker full selection; S08 `30396a9` surface full selection |
| CAP-22 | verified | S02 pins; S06 stage; S07 surface |
| CAP-23 | verified | S06 `2c978ca`; S07 e2e; S08 `30396a9` (7-sheet + reload/unlock) |
| CAP-24 | verified | S03 `0dc78a8` worker; S08 `36a33e7` + `30396a9` `relationships.spec.ts` |
| CAP-25 | verified | S03 + S06 worker; S08 `4adfe06` + `30396a9` `snapshots.spec.ts` |
| CAP-26 | verified | S06 `677b947`; S07 `append-import.spec.ts` (`append-too-large` after estimate is unit-only) |
| CAP-27 | verified | Adapters S01/S04/S05; S06 `677b947` workers; `3a32561` ODS; S07 + S08 e2e |

Contract agreements CA-17 through CA-24 and CA-07 amendment 3 are all closed, with their evidence
cited in STATE.md.

**Product completion for F03 still requires the human GATE-F03 verdict.**

### Follow-up closure ledger
| Source | Entry (condensed from receive record) | Disposition |
|---|---|---|
| S01 | Make `binary-unreadable.detail` required and set it in `parse-session.ts` | closed — S06 (`4a6f01a`/`677b947`, failed.detail + refusal detail) |
| S01 | Migrate F02 consumers to M65 and delete `delimited/facts.ts` | closed — `87da253` |
| S01 | Register OOXML reader/adapter; conformance in stage round-trip | closed — S06 CP1 `4287569` |
| S01 | S04/S05 reuse spy/cfb/opc helpers and M65 helpers | closed — S04 `5e92124`, S05 `5df4b01` |
| S01 | Inference rules and demo pins for S02/S06 | closed — S02 `3e99aa1` pins, S06 journey |
| S01 surprises 1–9 | D30 fallback, field renames, grace bytes, filter over-selection, stub reclassification, part-count scope, transient reds | retired — recorded in arch M13–M15/M65; informational |
| S03 | S06 promotion: referenceTargets / resolver / manifests / table.created / snapshot refs / reason-key map / decisionKindOf | closed — S06 `2c978ca`, `677b947` |
| S03 | Append `inference-decision.recorded` vs the rejection-memory query | closed — S06 CP4 `677b947` (projection + tail) |
| S03 | S08 binds RPC names; may tighten optional wire fields | closed — S08 `eba5790`; tightening carried (optional F03 roots → next M01/M02 lease) |
| S03 surprises | Optional-on-type fields; `listTables{appId}` added; resolver target; tail decoders | carried — optional fields to next M01/M02 lease; rest retired (landed) |
| S02 | S06 mapping of keys/labels/joined tables/relationships/broken refs/decisions | closed — S06 `2c978ca` |
| S02 | S04/S05 declared-table facts precede rows | closed — S04 held; ODS fixed `3a32561` |
| S02 | Keep `inferProposal` until migrated | carried — next session leasing `src/import/inference/**` |
| S02 | Relationship rejection memory consumer at F06 re-upload (D44) | carried — F06 planning |
| S02 surprise 5 | Non-equality validation operators become inert `unsupported-validation` | carried — F04 rules owner |
| S04 | CFB ranged read | carried — next `cfb.ts` lease (hardening) |
| S04 | S06 registration of xls/xlsb + expectation shift | closed — S06 `4a6f01a` |
| S04 | CA-17/CAP-27 worker legs; `fieldwork-jobs.xlsb` | closed — S06 `677b947` |
| S04 | M03 refuses `[1]!Name` | carried — F04 formula owner |
| S04 | Real Excel-authored `.xls`/`.xlsb` check (unverified BIFF12 layouts) | carried — GATE-F03 reviewer / F04 planning |
| S04 surprise 10 | No merged/validation counts at inventory | retired — no approved requirement; CA-18 shape unchanged |
| S05 | Register ODS/HTML; flip F02 refusal tests | closed — S06 `4a6f01a` |
| S05 | `identifyZip` template type | closed — decision: templates stay refused (decisions.md) |
| S05 | M65 codes for unconverted formula / unknown entity | closed — decision: no new codes (decisions.md) |
| S05 | ODS dates/booleans for S02 | closed — S06 CP4 journey |
| S06 | S07 review page / flows / progress / failure detail / D43 copy | closed — S07 `2185774`..`e062f41` |
| S06 | S08 demo treatment of the HTML pair | closed — listed as a known limit in the gate package |
| S06 | ODS declared-table before rows (S05 owner) | closed — `3a32561` |
| S06 | Optional F03 roots / `referenceTargets` | carried — next M01/M02 lease |
| S06 | Remove `inferProposal` after the S02 tests migrate | carried — next inference lease |
| S06 surprises | Append writes no `import_lineage`; single `snapshotManifestStorageId`; append name collision shows as suffix | carried — F06 planning (lineage and manifest ids) / F04 (naming) |
| OWNER-IMPORT-F03-SEAMS | ODS reads `content.xml` twice (bounded header pre-pass) | retired — bounded; informational |
| S07 | Deselect Archive 2018 until the integrity defect is fixed | closed — `cd4fe9d`; S08 proves the full selection |
| S07 | `append-too-large` after a passing estimate is unit-only | carried — next import machine/e2e lease (F04 planning) |
| S07 | Human reviewer: `.program/scratch-s07/shots/*.png` | carried — GATE-F03 reviewer |
| S07 surprises 6, 7, 11 | Dialog dismiss false positive; mock departures; unused `SELECT_ALL` | carried — GATE-F03 reviewer (mock departures); rest retired |
| OWNER-PROMOTION-SEAMS | `originalBaselineStorageId` is single-id | carried — M01/database owner at F06 planning |
| OWNER-PROMOTION-SEAMS | `SequenceEntropy` repeats after 256 ids (unit fake) | retired — test fake only |
| S08 | Intentionally-absent list | carried — F04/F06/F07 as listed in the gate package |
| S08 | `snapshots.ts` never created; Overview has no merge; D43 copy decisions | retired — recorded in arch M37/M44; D43 copy carried to the GATE-F03 reviewer |
| S08 | GATE-F03 verdict at `30396a9` | carried — **human** (ROADMAP Gate Log) |

### Archivist's Note

_Final Archivist pass: handle h-XDk0, commit `abfed52` (arch/**, PROGRAM-CONFIG.md, ROSHI-LOG.md). Return appended verbatim._

- **role:** archivist
- **registryUpdated:** true
- **reconciled:**
  - `arch/M01-domain-model.md`
  - `arch/M02-validation.md`
  - `arch/M03-formulas.md`
  - `arch/M07-ports.md`
  - `arch/M12-projection.md`
  - `arch/M13-import-source.md`
  - `arch/M14-preflight.md`
  - `arch/M15-ooxml.md`
  - `arch/M16-xlsb.md`
  - `arch/M17-biff.md`
  - `arch/M18-ods.md`
  - `arch/M19-delimited.md`
  - `arch/M20-html-table.md`
  - `arch/M21-inference.md`
  - `arch/M22-snapshots.md`
  - `arch/M23-staging.md`
  - `arch/M32-worker-protocol.md`
  - `arch/M33-workers.md`
  - `arch/M34-commands.md`
  - `arch/M35-queries.md`
  - `arch/M36-workflows.md`
  - `arch/M37-view-models.md`
  - `arch/M38-ui-primitives.md`
  - `arch/M43-ui-import.md`
  - `arch/M44-ui-records.md`
  - `arch/M51-platform.md`
  - `arch/M53-bootstrap.md`
  - `arch/M54-routes.md`
  - `arch/M58-workbook-fixtures.md`
  - `arch/M61-e2e-tests.md`
  - `arch/M65-workbook-facts.md`
  - `PROGRAM-CONFIG.md`
- **conventionsAdded:**
  - none this pass — every F03-firing pattern was either already promoted and held with zero new instances (closed-union/exhaustive-map, lease-drawn-over-module-map), or stayed below both of Vow 4's axes (sequential-delta supersession: 2 instances, not 3). Reasoned explicitly in the log entry rather than left silent.
- **proposedForFramework:**
  - `PLANNER.md` — a declared serial-lease-handoff line for a source directory should name its paired test-directory handoff (1 cycle, 4 in-plan instances, first seen F03)
  - `PLANNER.md` — a rule a concurrently-dispatched sibling session discovers mid-run has no channel to reach another concurrently-dispatched sibling building against the same shared fact vocabulary (1 cycle, 1 instance, first seen F03; the D35 structural-rule precedent shows the mitigation that works when stated in advance)
  - `ORCHESTRATOR.md` — no interim drift check scheduled below 16 sessions (3 cycles now, 4+10+5=19 in-cycle instances; F03 got *no* mitigation at all, unlike F01/F02's ad-hoc workaround)
  - `ORCHESTRATOR.md` — Archivist's envelope write set still omits the cleanup ledger `ARCHIVIST.md` asks it to own (3 cycles, 1+2+1=4 instances)
- **logEntry:** dated 2026-09-23 entry appended to `ROSHI-LOG.md` (this program's Archivist log) — full verdict, five substantive drift resolutions, cleanup ledger (CL-01 and CL-04 confirmed resolved and retired by fresh grep; CL-02/03/05 carried, two not re-scanned this pass), one recommendation marked **adopted** (`ORCHESTRATOR.md`'s CA/CAP status-invariant receive check, with F03's zero-recurrence as corroborating evidence), and the full 19-row standing-recommendations table backfilled with stable `id`s (minted per the prose formula in `ARCHIVIST.md`, verified via a throwaway Node script, not committed).

### cleanupBriefs

none this pass — thresholds not crossed (CL-01, CL-04 resolved/retired; CL-02/03/05 remain single low/medium-confidence trackers, unchanged in status).

### standingRecommendations

- **pattern:** A dependency must-not ships as a test, not a review note
- **cycles:** 3
- **instances:** 5(F01)+3(F02)+5(F03)
- **firstSeen:** F01
- **status:** promoted

- **pattern:** Encode a must-not as a type or a runtime throw
- **cycles:** 3
- **instances:** 5(F01)+8(F02)+3(F03)
- **firstSeen:** F01
- **status:** promoted

- **pattern:** Test filters take no bare `--`
- **cycles:** 1
- **instances:** 3
- **firstSeen:** F01
- **status:** promoted

- **pattern:** `Owns` authoritative, Files table indicative
- **cycles:** 3
- **instances:** 7(F01)+9(F02)+12+(F03)
- **firstSeen:** F01
- **status:** promoted

- **pattern:** Arch fragment head contract superseded by its own delta
- **cycles:** 3
- **instances:** 4(F01)+6(F02)+6(F03)
- **firstSeen:** F01
- **status:** promoted

- **pattern:** Lease or boundary sweep drawn over the wrong tree
- **cycles:** 2
- **instances:** 3(F02)
- **firstSeen:** F01
- **status:** promoted; held — 0 new instances F03

- **pattern:** Closed union and its exhaustive map split across leases
- **cycles:** 1
- **instances:** 3
- **firstSeen:** F02
- **status:** promoted; held — 0 new instances F03

- **pattern:** A delta describing another module
- **cycles:** 2
- **instances:** 4(F01)+4(F02)
- **firstSeen:** F01
- **status:** promoted; held — 0 new instances F03

- **pattern:** No interim drift check scheduled below 16 sessions
- **cycles:** 3
- **instances:** 4(F01)+10(F02)+5(F03)
- **firstSeen:** F01
- **status:** open

- **pattern:** Archivist envelope write set omits the cleanup ledger it is asked to own
- **cycles:** 3
- **instances:** 1(F01)+2(F02)+1(F03)
- **firstSeen:** F01
- **status:** open

- **pattern:** Landed proof legs left in STATE's `planned:` list at receive
- **cycles:** 1
- **instances:** 13
- **firstSeen:** F02
- **status:** adopted

- **pattern:** STATE table rows that lose a cell go unnoticed
- **cycles:** 1
- **instances:** 6
- **firstSeen:** F02
- **status:** open

- **pattern:** A module no session leased has no route into its own fragment
- **cycles:** 1
- **instances:** 6
- **firstSeen:** F02
- **status:** open

- **pattern:** FORGE-CONFIG Verification Commands has no post-baseline maintainer
- **cycles:** 1
- **instances:** 2
- **firstSeen:** F01
- **status:** adopted (table itself now two cycles stale — reported, not re-opened)

- **pattern:** Checkpoint boundary blur: capability bodies and proofs split across checkpoints
- **cycles:** 2
- **instances:** 2(F01)+0(F02)
- **firstSeen:** F01
- **status:** retired

- **pattern:** Authorized contract change breaks a consumer outside the lease
- **cycles:** 1
- **instances:** 1
- **firstSeen:** F02
- **status:** not proposed

- **pattern:** Files staged in the shared index from outside any lease
- **cycles:** 1
- **instances:** 3
- **firstSeen:** F01
- **status:** retired

- **pattern:** A declared serial-lease-handoff line for a source directory should name its paired test-directory handoff
- **cycles:** 1
- **instances:** 4
- **firstSeen:** F03
- **status:** open

- **pattern:** A rule a concurrently-dispatched sibling session discovers mid-run has no channel to reach another concurrently-dispatched sibling building against the same shared fact vocabulary
- **cycles:** 1
- **instances:** 1
- **firstSeen:** F03
- **status:** open
