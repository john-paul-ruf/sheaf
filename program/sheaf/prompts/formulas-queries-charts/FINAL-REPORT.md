# Final Report — Sheaf / formulas-queries-charts (F04)

## Summary

F04 made Sheaf apps live, and all eight planned sessions are done. Nine of the eleven in-scope capabilities are verified through the real entry, and the other two have partial real-entry proof (see the table below). What landed:

- **Formulas:** live computed columns, table metrics and dashboard values, recalculated in the data worker. TODAY/NOW stay live and are never stored, RAND is frozen at import, and unsupported functions keep their imported value, marked truthfully.
- **Records:** type-aware filters, sort on any column, and truthful partial results.
- **Charts:** a Chart.js 4.5.1 view with bar, line, pie, scatter and stacked types. A tapped mark filters the records list. There is a builder, pinning, drafts, a charts index, and OOXML charts and pivots rebuilt at import.
- **Schema:** permanently editable with counted impact (SCR-035, MOD-014), including Text → Choice list with choices the user names.
- **Rules:** record rules across fields are authored and enforced; imported comparison validations become warnings.
- **Themes:** each app has its own theme (4 built-in palettes, custom accent, light/dark/follow-device mode, density, logo) under a contrast gate that keeps safety semantics system-owned.

The run halts at **GATE-F04** for the human verdict.

- **Sessions:** 8 / 8 done (S01–S08).
- **Extra work:** 2 owner corrections landed; 1 owner correction closed as not needed (its premise was disproved); 2 design fills; 1 planning-completeness Archivist pass.
- **Base → final:** `237732e` → `5bc19fb`. Demo package at `3cdf1e7`, which is S08's CP4 `7df22fb` plus the design.md-only commit `3cdf1e7`.

## Sessions

| S | Title | Status | Checkpoints (commits) | Lease revisions |
|---|---|---|---|---|
| S01 | Formula engine, rule IR v2, chart/filter vocabulary, schema impact | done | 4/4 (50d1c51, 67021bf, 3d69c73, 488f49e) | r1 |
| S02 | OOXML chart & pivot definitions, chart-bearing corpus | done | 3/3 (1f77153, dceb69e, 15b4d5b) | r1 |
| S03 | Live-schema spine in the data worker (first narrow journey) | done | 4/4 (a69e6e0, 85967e8, 5b9fd27, db79991 corr., 2235cce) | r1 (+schema-impact.ts for S01-KEY) |
| S04 | Records query: filters, sort, partial scope, computed values, metrics | done | 4/4 (f736fa8, fb0dd3a, 229cb9a, 27a2667) | r1 → r2 → r3 |
| S05 | Charts: events, datasets, detail, builder, pinning, index | done | 5/5 (6ee204c, cb07059, f601d9a, 2bcc061, 3dd1d2d) | r1 (+projection-port.test.ts) |
| S06 | Structure: schema, rule and formula editors + app settings | done | 4/4 (e7e7fe2, 753590a, 25c1bdb, 8410b5b corr., 3b7ecfa 4a, 7ec391e) | r1 → r2 |
| S07 | Imported structure made live | done | 4/4 (978bb77, 0e63ac9, 6480b4a, f9a1565) | r1 → r2 |
| S08 | Per-app identity + GATE-F04 journey | done | 4/4 (42decba, af6144b, c70bb5e, 7df22fb) | r1 → r2 → r3 |
| OWNER-M02-RULE-IDENTITY | Rule field ids compared by value (CA-27 counterexample) | done | c6ed8dd | — |
| OWNER-THEME-DARK-SEMANTICS | Dark-mode semantic text inks | done | beb094a, c92f393 | — |
| OWNER-THEME-FIELD-ERRORS | Field error lines in dark mode | closed — premise disproved, no commit | — | — |
| DESIGN-F04-THEME-CHARTS | DF-1 palettes + DF-2 charts index (SCR-053) | done | 3a4317d | — |
| DESIGN-F04-DARK-SEMANTICS | System semantic text inks in dark app mode | done | 3cdf1e7 | — |

## Files created / modified

`src/` and `tests/`, `237732e..5bc19fb`: 288 files changed, 45,769 insertions, 1,157 deletions. That is 141 files added and 147 modified.

- **Root manifests:** `package.json` and `pnpm-lock.yaml`, with `chart.js` pinned to exactly 4.5.1 and `@kurkle/color` 0.3.4 as a transitive dependency.
- **Author sources:** `specs/design.md` gained the "Built-in app palettes" and "System semantics in dark mode" sections, a SCR-053 inventory row and an FR-16 row. `mocks/charts.html` is new, and one swatch value changed in `mocks/theme.html`.

## Architecture impact

- **New modules:** M45 UI charts (`src/ui/charts/`) and M46 UI schema (`src/ui/schema/`, which also hosts SCR-036, the theme editor). M03 grew from the F03 parser into the full engine: IR, the closed D49 catalog (68 functions), translate, render, the dependency graph and the evaluator.
- **Durable changes are all payload evolution inside encrypted envelopes.** No migration was needed. The additions:
  - F04 schema/chart/theme event kinds;
  - checkpoint roots for `formulas` and `charts`, plus theme v2;
  - rule IR v2;
  - `change-field-type.optionLabels`.
- **Deviations from the plan, accepted:**
  - The contrast gate lives in M01 `events.ts`, because both the page and the worker must reach it, and M40 depends on nothing.
  - The chart services and view models are folded into `records-services.ts` and `records.ts`, because `tests/unit/workflows/module-boundaries.test.ts` lists every file in those directories.
  - A chart's `filterIntent` is a `FilterV1[]`, not a single filter.
- Arch deltas are integrated under `<!-- formulas-queries-charts … -->` markers (commits 2611136, 4ce7f54, cee1355, 7274a69/5543517, 6284312, 38bf944/a58b2a0, 08ad01a/a505c52, fe3724d, 5bc19fb).

## Verification (Orchestrator-run, final @ `5bc19fb`)

| Gate | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | 197 files / 2339 passed / 3 skipped (baseline 155 / 1728) |
| `pnpm test:e2e` (full, webServer build, port 8083, dist lock) | **71 passed** (baseline 57) |
| `pnpm test:browser` (full) | **141 passed** |

Orchestrator also re-ran each capability proof at its receive:

- the first narrow journey `live-formulas` at 2235cce;
- full e2e at 27a2667 (60 passed), 3dd1d2d (62), f9a1565 (64, plus 2 expected reds while S06 was paused), 7ec391e (66, browser 141) and 5bc19fb (71).

## Capability completion

| CAP | Status | Proof |
|---|---|---|
| CAP-28 live computed columns | **verified** | S03 worker journey; S06 CP4 real entry (1,000 → 1,300, announced, reload identical) |
| CAP-29 metrics / dashboard values | **verified** | S03, S04 CP3, S07 CP4 (imported Overview values) |
| CAP-30 TODAY/NOW, RAND frozen, unsupported kept | **verified** | S03 CP4, S07 CP4. MOD-015 on "Rate" is in the GATE-F04 journey |
| CAP-31 query surface | **verified** | S04 CP4 `records-query.spec.ts`. Device-level partial result → F07 |
| CAP-32 chart view, mark → filtered records | **verified** | S05 CP4 `charts.spec.ts` (keyboard mark list; a canvas click is covered in jsdom only) |
| CAP-33 builder, pin, drafts, index | **verified** | S05 CP4/CP5. Bar end to end; all five types at the browser-projection tier |
| CAP-34 imported OOXML charts/pivots | **verified** | S07 CP4. Non-OOXML formats are a named gap (D55) |
| CAP-35 editable schema | **verified** | S06 CP4, all 8 steps, including Text → Choice list |
| CAP-36 record rules | **verified** | M02 fix c6ed8dd; authored blocking refusal S06 CP4; imported rules warn, as designed (FR-4) |
| CAP-37 per-app identity | **verified** | S08 CP4 `theme.spec.ts` + GATE-F04 journey; dark semantic text inks (beb094a) |
| CAP-38 live structure at import | **verified** | S07 CP4 `workbook-import.spec.ts` |

No required capability is still planned, blocked or stale.

## Residual gaps (named, with owners)

- **Non-OOXML chart rebuild.** XLSB, XLS, ODS and HTML-table charts stay `chart-not-rebuilt` (D55). No roadmap feature owns this. **GATE-F04 human** to route.
- **Real-Excel verification.** The chart/pivot XML (S02 CP0 premise) and the F03 BIFF12 layouts are unverified against Excel-authored files. **GATE-F04 reviewer.**
- **Dark mode, non-text contrast (REVIEW-DARK-NONTEXT).**
  - The destructive button's text on danger fill is ≈3.3:1.
  - Semantic borders (Clay 600, River 600, Leaf 700) are under 3:1 on dark app backgrounds: `records.module.css:502`, `text-field.module.css:39`, `select-field.module.css:37`, `status-banner.module.css:48/66/75`, `error-state.module.css:7`.
  - design.md has no values for these, and none were invented. **GATE-F04 reviewer → design fill.**
- **Dialogs in dark apps (REVIEW-DIALOG-THEME).** Dialogs render into `document.body` in the light shell theme. Should they follow the app's mode? **GATE-F04 reviewer → Designer.**
- **Conversion policy (REVIEW-CONVERT).** A schema conversion is refused while any record it rewrites already fails a blocking rule, not only failures the conversion introduces. **GATE-F04 reviewer.**
- **Device-level partial states.** STA-014 and STA-015 are proven only at the browser-projection tier, with injected budgets. **F07.**

## Follow-up

See *Follow-up closure ledger* below.

## GATE-F04 demo package

- **Revision:** `3cdf1e78855297ec3869b74ddd407d09278562a1`. That is S08 CP4 `7df22fb` plus the design.md-only commit `3cdf1e7`. Final verification is at `5bc19fb`, which adds only the dark-semantics CSS/tests and arch notes.
- **Command:** `until mkdir .program/locks/dist 2>/dev/null; do sleep 10; done; pnpm build && (pnpm preview --port 8080 --strictPort &)`, then a curl and Chromium probe of `window.__sheafBuildId`, then kill the preview and `rmdir` the lock.
- **Result (S08):** BUILD_EXIT=0, HTTP 200, served build id = HEAD = `3cdf1e7`. The server was killed and the lock released.
- **The journey** (`tests/e2e/gate-f04-demo.spec.ts`, 320px, offline):
  1. Import `formulas-live.xlsx`.
  2. The app home shows live recalculated metrics and two charts.
  3. A live calculation column ("Deposit") is added in SCR-035. There is no add-plain-field surface.
  4. The rule "Paid is at most Quoted amount" refuses a violating save.
  5. MOD-015 rewrites the unsupported "Rate" (OFFSET) formula.
  6. The theme changes to Indigo · dark · compact with a logo; it persists and shows on the library tile.
  7. axe passes in light and dark.
- **Intentionally absent:**
  - adaptive budgets and the capacity door (F07);
  - durable homes and the backup reminder on edits (F05);
  - chart export (F07);
  - re-upload (F06);
  - non-OOXML chart rebuild (D55, named gap);
  - F03-era apps' formulas stay preserved (D50);
  - real-Excel chart and BIFF12 verification (reviewer).
- **For the reviewer:**
  - **Screenshots were never viewed.** No worker had an image viewer; axe, clipping and 44px-target probes stand in. Captures: `test-results/theme/*`, gate `gate-*.png`, and the schema/chart/records captures.
  - **Composed copy to check (D62):** MOD-012/013 bodies; chart axis and bucket labels; rule sentences ("Finish by must be on or after Start."); Choice-list conversion copy; theme verdict, refusal and legacy-palette copy ("Choose a palette first.").
  - **Colour decisions:** the Cedar citrus `#D7F28A` has no token slot. Three new scale steps were added for dark semantics (Clay 300, River 300, Leaf 300).
  - **Behaviours to confirm:**
    - imported rules warn rather than refuse;
    - a two-series chart is not rebuilt;
    - a frozen dashboard value becomes `unsupported`/`value-not-kept`;
    - a key change onto a field with duplicate values is counted but not refused;
    - the gate-f02 "at-a-glance totals" / "arrive in a later release" card is stale but still asserted by `gate-f02-demo.spec.ts`, which no feature owns;
    - at 320px the chart builder's Measure list does not open to a pointer click (M45 owner).

---

## Orchestration

**Concurrency:** 3 (Native binding: `mcp__demiurge__spawn_subagent` / `await_subagent_result`)
**Wall clock:** ≈ 7 h 30 m (run r-xl8A started 08:00; last commit 15:29 on 2026-09-23)
**Sessions run:** 8 planned. Also 3 owner corrections, 2 design fills and 1 planning-review Archivist. There were 5 same-context resumes for lease revisions.
**Checkpoints committed by Coder:** 35 session checkpoint/correction commits, plus 3 owner-correction commits, plus 2 design-fill commits.

### Wave plan as executed
| Wave | Sessions | Notes |
|---|---|---|
| 0 | ARCHIVIST planning-completeness ∥ DESIGN-F04-THEME-CHARTS | The review moved to the quiet boundary before wave 1, not before wave 2 as planned: waiting would have held S03 behind S02. DF-1 and DF-2 were merged into one worker because both write design.md. |
| 1 | S01 ∥ S02 | Disjoint. S03 was launched by rolling refill the moment S01 was received. |
| 2 | S03 | First narrow journey passed; Orchestrator re-ran it. |
| 3 | S04 (r1 → r2 → r3) | Two mechanical lease revisions, resumed in the same context. |
| 4 | S05 | Clean; the lease path was pre-granted. |
| 5 | S06 ∥ S07, then OWNER-M02-RULE-IDENTITY in the freed slot | S06 blocked (M02 counterexample, Text→Choice gap); S07 went to r2; S06 resumed on r2 after S07 released `messages.ts`. |
| 6 | S08 (r1 → r2 → r3) ∥ DESIGN-F04-DARK-SEMANTICS, then OWNER-THEME-DARK-SEMANTICS, then OWNER-THEME-FIELD-ERRORS | Closed at 5bc19fb. |

### Blocked
None open. Every blocked return was cleared inside the run.

### Blocker escalations
| S | Class | Action / human ask | Disposition |
|---|---|---|---|
| PLAN-REVIEW | process | Archivist pass; 3 plan-text fixes (S03 CP4 seed, wave-5 shared read, S07 D65) | cleared |
| DF-1 / DF-2 | design-fill | DESIGN-F04-THEME-CHARTS | cleared 3a4317d |
| S01-KEY | contract gap | `set-table-key` added to S03 lease r1 | cleared 5b9fd27 |
| S04 | mechanical seam ×2 | r2 (+projection-port.test.ts, commands/fakes.ts); r3 (+tests/e2e/fixtures/a11y.ts probe fix, with negative controls) | cleared 27a2667 |
| S06-RULES | counterexample (M02 id identity) | OWNER-M02-RULE-IDENTITY | cleared c6ed8dd |
| S06-ENUM | contract gap | Folded into S06 r2 (user-named optionLabels) | cleared 3b7ecfa |
| S07 | mechanical seam | r2 (+4 pre-live test setups; additions only) | cleared f9a1565 |
| S08 | counterexample (projection theme codec) + seams | r2 (+cbor-values.ts etc.); r3 (+`.hero` colours) | cleared 7df22fb |
| DARK-SEMANTICS | design-fill + owner correction | DESIGN-F04-DARK-SEMANTICS; OWNER-THEME-DARK-SEMANTICS | cleared 3cdf1e7, beb094a/c92f393 |
| GATE-F04 | standing human gate | Human verdict in the ROADMAP Gate Log | **awaiting human** |

No message to the human was needed during the run: nothing passed the Human Interruption Gate.

### Interim Archivist checks
| After wave | Sessions received | Result | Drift found | Actions |
|---|---|---|---|---|
| 0 (planning-completeness) | — | done (h-wdL6) | 3 (b) plan-text gaps, 7 (d) | S03 CP4 seed corrected; S07 cites D65; wave-5 shared read listed |

The 8-session run was below the 16-session threshold, so no interim drift checks ran.

### Lease violations
None. Every commit's `git show --name-only` was checked against its lease revision. The Orchestrator itself once left `.ts` recovery copies under `.program/recovery/`. `eslint .` picked them up and lint went red at the S04 receive; they were renamed to `.txt`. This was not a Coder violation.

### Checkpoint shortfalls
None. S04, S06, S07 and S08 each returned `blocked` with uncommitted, in-lease work that was green apart from out-of-lease seams. The work was preserved in `.program/recovery/` and landed after a same-context resume.

### Wave plan corrections
None needed on disjointness: S01∥S02 and S06∥S07 were verified path by path. There were three scheduling changes:

- DF-1 and DF-2 were merged, because both write `specs/design.md`.
- The planning review moved before wave 1.
- OWNER-M02-RULE-IDENTITY ran beside S07; their write sets were disjoint.

### Granularity feedback for Planner
- **Exhaustive-list test pins recur as lease seams:** `projection-port.test.ts`, `commands/fakes.ts`, `workflows/module-boundaries.test.ts`, `record-event-payloads.test.ts` TAIL list, `workers/module-boundaries.test.ts`. Any session adding a query kind, event kind or workflow/VM/worker file needs the matching pin file in its lease. They cost S04 one resume and S08 part of one. After S05's disclosure they were pre-granted to S05, S06 and S08.
- **Shared fixtures must follow the contract.** A live-import contract change must also lease the older test setups that import the demo workbook (S07 r2).
- **Weak worker assertions hide defects.** S03's `≥` assertion masked the M02 identity defect until S06's real-entry run. Require exact counts at the first proving checkpoint.
- **Name the exact seed function, not just the file** (Archivist proposal, S03 CP4).
- **The projection keeps its own copies of M23 codecs** (`cbor-values.ts`). A payload evolution must lease both.
- **Dark-mode design completeness.** A dark mode needs dark values for system semantics, and a rule for which surfaces dialogs inherit. Plan a design fill before the theme session.

### Process effectiveness
- **First-dispatch completion.** Accepted without redispatch or unplanned correction: S01, S02, S03, S05 (4 of 8 sessions). S04, S06, S07 and S08 needed same-context resumes: 7 resumes across 4 sessions.
- **Unplanned corrections: 5.** Each is a same-context lease revision or a separate owner.

  | Correction | CAP IDs | Reason | How |
  |---|---|---|---|
  | S01-KEY | CAP-35 | contract gap | folded into S03's lease |
  | S06-RULES | CAP-36, CA-27 | counterexample in S01 code | separate owner |
  | S06-ENUM | CAP-35 | contract gap | same-context S06 r2 |
  | S08 theme codec | CAP-37, CA-32 | counterexample | same-context S08 r2 |
  | DARK-SEMANTICS | CAP-37 | design gap | design fill + separate owner |

- **Integration rework.** CA-27 evidence was stale from 13:40 to 15:30. Corrective commits after an earlier acceptance: c6ed8dd (CAP-36) and beb094a/c92f393 (CAP-37).
- **Environment.** The MCP await timed out after 300 s on long collects. Each time the handle was re-awaited with no loss. Two workers stranded the dist lock after a tool timeout; each cleaned it up and moved to `trap`-guarded runs.
- **Product decisions.** None were required mid-run. Five items are listed for the gate.
- **Timing caveat.** Times in `.program/ledger.md` and the transcript were approximate; commit timestamps above are authoritative.

### Capability completion
All of CAP-28 to CAP-38 are verified against current sources at `5bc19fb`; see the table above. The named gaps are listed under Residual gaps, each with an owner.

### Follow-up closure ledger
| Source | Item | Disposition |
|---|---|---|
| DESIGN-F04-THEME-CHARTS | Cedar citrus `#D7F28A` has no token slot | **carried** → GATE-F04 reviewer (decision 08:25: D56 six tokens only) |
| DESIGN-F04-THEME-CHARTS | Older mocks link Charts to the builder | **retired** — D63 route law; S05 routes to the index |
| DESIGN-F04-THEME-CHARTS | `theme.html` `--focus` undefined | **retired** — the product uses system focus tokens |
| DESIGN-F04-THEME-CHARTS | Palettes for S08 CP1 / index for S05 CP5 | **closed** 42decba / 3dd1d2d |
| S01 | D59 had no key-change kind | **closed** 5b9fd27 (`set-table-key`) |
| S01 | Excel deviations (fractional power, epoch-day dates, NOW decimal, …) | **carried** → GATE-F04 reviewer (documented in arch M03) |
| S01 | Follow-ups to S03, S04, S05, S06, S07 | **closed** by those sessions' checkpoints |
| S02 | No stream diagnostic for refused chart/pivot parts | **retired** — decision 09:00: `chart-not-rebuilt` covers it |
| S02 | Unverified against real Excel (CP0 premise) | **carried** → GATE-F04 reviewer |
| S02 | Unlocked `pnpm verify` build | **retired** — no clobber; lock restated |
| S02 | Browser `containers` run not done | **closed** — full browser 141 passed @ 5bc19fb |
| S02 | CA-31 recheck before S07 | **closed** 09:00 (recheck) + f9a1565 |
| S03 | Formula error position is a best guess (no M03 offset) | **carried** → next feature leasing `src/domain/formulas/**` (UX refinement) |
| S03 | Duplicate keys under `set-table-key` counted, not refused | **carried** → GATE-F04 reviewer (decision 10:05) |
| S03 | Second field encoder `staging/events.ts` drops `formulaId` | **closed** f9a1565/0e63ac9 (S07 uses `encodeFieldDef`) |
| S03 | Frozen metrics report `unsupported` | **carried** → GATE-F04 reviewer (S07 confirmed: `value-not-kept`) |
| S03 | `relationship.changed` has no direction labels; the fingerprint uses current names | **carried** → F06 planning (re-upload / rejection memory) |
| S04 | Text filters exact-case | **closed** f736fa8 (case-insensitive NFC, decision 10:15) |
| S04 | Horizontal chip scroller vs the `clipped()` probe | **closed** 27a2667 (probe fix with negative controls) |
| S04 | gate-f02 "at-a-glance totals" card text | **carried** → GATE-F04 reviewer (gate-f02 spec unowned) |
| S04 | Device-level STA-014 partial | **carried** → F07 |
| S04 | Human look at 320px sheets | **carried** → GATE-F04 demo package |
| S05 | Chart services/VMs folded into records files | **carried** → Planner: a split needs `workflows/module-boundaries.test.ts` in the lease |
| S05 | Tree-shaking partial (dead timeseries/log classes) | **carried** → next feature leasing `src/ui/charts/**` (bundle hardening) |
| S05 | No canvas-coordinate click in e2e | **carried** → GATE-F04 reviewer (covered by jsdom + keyboard) |
| S05 | MOD-012 guards only Cancel/Close (no router blocker) | **carried** → GATE-F04 reviewer |
| S05 | "From workbook" without a source location | **retired** — no durable fact carries it (CA-31 evidence has the part location) |
| S05 | Stale app-home "arrive in a later release" card | **carried** → GATE-F04 reviewer (gate-f02 spec unowned) |
| S05 | Device-level STA-015 | **carried** → F07 |
| S05 | Composed copy + unviewed screenshots | **carried** → GATE-F04 reviewer |
| S06 | M02 id-identity defect | **closed** c6ed8dd |
| S06 | Text → Choice list | **closed** 3b7ecfa |
| S06 | Rule refusal copy | **closed** 3b7ecfa |
| S06 | Conversion refused on pre-existing blocking failures | **carried** → GATE-F04 reviewer (REVIEW-CONVERT) |
| S06 | Kept-after-conversion wording "came in from the import unchanged" | **carried** → next feature leasing `src/application/view-models/records.ts` copy (F05 planning) |
| S06 | Nav: snapshots/history left the bar | **closed** — accepted (per mocks, 44px at 320px) |
| S06 | Theme & logo row; MOD-015 real entry | **closed** c70bb5e / 7df22fb |
| S06 | One unidentified non-recurring unit failure | **retired** — never reproduced; Orchestrator runs green ×5 |
| S07 | Imported rules are warnings, not refusals | **carried** → GATE-F04 reviewer (FR-4, by design) |
| S07 | Two-series chart not rebuilt | **carried** → GATE-F04 reviewer (D54) |
| S07 | `CheckpointManifestV1` reader tightening | **carried** → next owner of `src/workers/data/event-store.ts` (optional hardening) |
| S07 | Inherited: `inferProposal` removal, required roots, validation ops, append-too-large e2e | **closed** 978bb77 / 0e63ac9 / 6480b4a / f9a1565 |
| OWNER-M02-RULE-IDENTITY | S03 vacuous rule test (`Paid ≤ Quoted`) | **closed** c6ed8dd (flipped, with a > 0 guard) |
| S08 | Projection theme codec counterexample | **closed** 42decba |
| S08 | Hero dark colours | **closed** 7df22fb |
| S08 | Dark semantic text inks | **closed** 3cdf1e7 + beb094a/c92f393 |
| S08 | Chart canvas recolours only on the next render after a live scheme flip | **carried** → next feature leasing `src/ui/charts/**` |
| S08 | 320px Measure list pointer click | **carried** → next feature leasing `src/ui/charts/**` + GATE-F04 reviewer |
| S08 | No add-plain-field surface | **carried** → GATE-F04 reviewer (design/requirements question) |
| S08 | Copy deviations ("Remove logo"; preview sample data) | **carried** → GATE-F04 reviewer |
| OWNER-THEME-DARK-SEMANTICS | Destructive button ≈3.3:1; semantic borders < 3:1 in dark mode | **carried** → GATE-F04 reviewer → design fill (REVIEW-DARK-NONTEXT) |
| OWNER-THEME-FIELD-ERRORS | Premise disproved; dialogs render in the light theme | **carried** → GATE-F04 reviewer → Designer (REVIEW-DIALOG-THEME) |
| Inherited (F03) | CFB ranged read; `referenceTargets` optional; `originalBaselineStorageId`; lineage ids; rejection-memory consumer | **carried** as planned (see STATE Inherited obligations): next `cfb.ts` owner / F06 |

### Archivist's Note
(appended below once the final Archivist returns)
