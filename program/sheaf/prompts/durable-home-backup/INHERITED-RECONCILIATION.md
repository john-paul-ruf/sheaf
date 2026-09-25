# F04 → F05 inherited reconciliation

Source: F04 FINAL-REPORT.md at plan HEAD, its Follow-up closure ledger (copied below for exact finding names). This is an inspection/disposition appendix to STATE Scope Summary, not a competing backlog. Existing closed/retired findings retain their historical evidence. A request to plan F05 authorizes planning; it does not prove a demo was run or resolve any review finding.

## Current dispositions

- S06 preserved-after-conversion wording: assigned S03 CP3, records.ts + VM regression; CAP-41/CA-40. Its current literal still claims the value came from import unchanged.
- S07 CheckpointManifestV1 reader tightening: S02 CP2 graph completeness and S06 CP1 old/new checkpoint decoder proofs, CA-35/41. Preserve intentional F02 defaults; no blanket requirement to fill absent old formula roots.
- S05 optional chart workflow/VM file split: intentionally retain charts in the existing records files for F05; no split or destination files are assigned. Original conditional follow-up remains with the next Planner that chooses a chart refactor, which must lease workflows/module-boundaries.test.ts and all affected consumers. No F05 dependent capability is blocked by this optional cleanup. Separately, required exhaustive pins/error maps/projection-port/fakes are assigned S02 CP1–4 and S03 CP1–4; those mechanical adaptations are not a file split.
- F01 carried CAP-05 recoveryMachine countdown (F04 STATE inherited-obligation row; M36 Known gaps): required F05 implementation assigned S02 CP5, including machine/test, security VM/test, RecoveryRoute clock wiring, recovery screen/new paired test and new recovery-countdown e2e lease. CA-40 tracks worker-authoritative delay, exact expiry and real-route proof. No further deferral; PC-F05-02 planning correction does not mark implementation verified.
- S03 relationship labels/fingerprint; F03 referenceTargets/originalBaselineStorageId/lineage/rejection-memory consumer: F06 Planner + Coder own correction when re-upload/adoption is planned. F05 S02/S06 must preserve their bytes/identity, CA-35/41; no F05 rewrite of missing semantics. F06 acceptance remains blocked on that assignment being made in its own plan.
- F03 CFB ranged read: deferred to next cfb.ts owner; resumption when import reader is changed; no F05 dependency.
- S03 formula error offset: deferred to next formulas owner; no F05 dependency.
- S05/S08 chart tree-shaking, live canvas recolor and 320px pointer issue: deferred to next M45 owner; no F05 chart implementation lease. F05 backup preserves chart definitions, not canvas behavior.
- STA-014/015 device-level partial states: F07 capacity owner; retained required proof debt, no F05 backup/status proof may claim capacity acceptance.
- REVIEW-DARK-NONTEXT: Designer design-fill for approved accessibility roles, then next affected UI owner; F05 DF-F05-1 must supply any roles used by its new status surfaces before their acceptance. Original F04 contrast debt is not declared fixed.
- REVIEW-DIALOG-THEME: Designer/human design-change decision retained from F04; use existing shell-themed portals for F05 until approved change. No new theme inheritance claim.
- REVIEW-CONVERT, non-OOXML chart rebuild/D55, real Excel/BIFF12 qualification, no add-plain-field surface, frozen metrics wording, duplicate-key rule, MOD-012 route-block behavior, canvas pointer evidence and prior copy/demo feedback: F04 gate owner retains these product/review decisions. F05 planning authorization neither approves scope reductions nor closes them. No new F05 dependent behavior requires a resolution; source semantics are preserved.
- Stale app-home and gate-f02 wording mentioning future backup: S02/S03 status integration owns updates in its leased app-home/records VM/gate-f02 paths; other chart/schema/format promises remain historical review items.
- Screenshots not viewed at F04 gate: retained inspection limitation. F05 S02/S03/S07 must capture and view their new surfaces, rather than inheriting visual parity.
- All remaining `carried → GATE-F04 reviewer` rows below remain with that existing owner; resumption at F04 review disposition, no F05 success statement settles them. Rows labelled closed/retired below are not reopened without counterevidence.

## Historical source rows

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
