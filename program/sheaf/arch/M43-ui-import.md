# M43 — UI import (`src/ui/import/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / UI feature modules + `specs/design.md`. Reconciled
> against the tree at `5ab3b07` (F02 final).

## Contract

- **Owns (approved surfaces):** SCR-016–023, SCR-043–045; MOD-004–008,
  034–035; SHT-013.
- **Exports:** Route components and typed user intents.
- **Depends on:** M38–M40 primitives/layout/theme + `src/application/view-models/`.
- **Must not:** Acknowledge a save before `CommitConfirmed`, hide
  partial/broken/stale states, or import anything but `react` and
  `react-aria-components` as packages (`tests/unit/ui/architecture.test.ts`
  enforces this for all `src/ui/**`). Screens are presentational — VM in,
  callbacks out; actors live in `src/routes/`. **No worker type is named, not
  even in a type position.**

## Landed scope (F02, S07 @ `8a665c1`)

SCR-016 (upload landing), SCR-017 (delimited target; "add to existing app"
disabled with truthful reason, D18), SCR-018 delimited-fits variant, SCR-019
delimited over-budget variant (composed, D20), SCR-020 (progress +
cancellation), SCR-021 (refusals incl. the composed later-release workbook
card, D19), SCR-022 (failed/cancelled + cleanup receipt), SCR-023 (review),
MOD-004 (mismatch), MOD-005/006 (refusal detail where reached in F02), MOD-007
(cancel confirm), MOD-008 (failure detail), SHT-013 (evidence detail).
SCR-043–045 and MOD-034/035 remain F06 (re-upload).

### Exports

- `upload-screen.tsx` → `UploadScreen`, `ChooseAnotherFileButton`,
  `WorkbookPickerProps` (SCR-016).
- `delimited-target-screen.tsx` → `DelimitedTargetScreen`, `formatCount`,
  `describeRowCount`, `describeContradiction` (SCR-017, MOD-004).
- `preflight-screens.tsx` → `PreflightFitsScreen`, `PreflightOverBudgetScreen`,
  `describeBytes`, `describeOverBudget` (SCR-018/019, D20).
- `import-progress-screen.tsx` → `ImportProgressScreen`,
  `ImportProgressRegion`, `ImportPhaseVm`, `CANCELLATION_CONTRACT`
  (SCR-020, MOD-007).
- `import-refused-screen.tsx` → `ImportRefusedScreen`, `refusalCard`,
  `RELEASE_SCOPE` (SCR-021, MOD-005/006, D19).
- `import-failed-screen.tsx` → `ImportFailedScreen`, `describeCleanup`
  (SCR-022, MOD-008).
- `review-screen.tsx` → `ReviewScreen`, `describeStatement`,
  `describeNeedsAttention` (SCR-023).
- `review-evidence.tsx` → `EvidenceSheet`, `evidenceTag`, `describeEvidence`,
  `describeDiagnostic`, `EvidenceVm`, `ImportDiagnosticVm` (SHT-013).
- `review-edit-dialog.tsx` → `ReviewEditDialog`, `ReviewEditDraftV1`,
  `ReviewEditIntentV1`, `FieldTypeVm`, `describeFieldType`,
  `describeFieldTypePhrase`.
- `import-stages.tsx` → `ImportStages`, `IMPORT_STAGES`, `ImportStageIdV1`.
- `import.module.css` — unlayered, per the layer contract.

Files beyond the plan's table (Custom Rule 7), each with its reason:
`import-stages.tsx` (one Size/Import/Review list, so SCR-018/019, SCR-020 and
SCR-023 cannot disagree about where the user is), `review-evidence.tsx` and
`review-edit-dialog.tsx` (SHT-013 and the edit controls are the review screen's
two dense halves; one file would have been unreadable).

## Two type-held facts

- **`src/ui/**` names no worker type.** Every wire shape the review needs is
  aliased off the view model instead: `EvidenceVm =
  ReviewStatementVm["evidence"][number]`, `ImportDiagnosticVm =
  ImportReviewVm["diagnostics"][number]`, `FieldTypeVm = ReviewFieldVm["type"]`,
  `ImportFailureReasonVm = NonNullable<ImportEndedVm["reason"]>`,
  `ImportPhaseVm = ImportProgressVm["phase"]`. A change upstream is still a
  compile error in each total `Record<…>` map; `architecture.test.ts` caught the
  first draft doing it the other way.
- **An edit leaves the surface as `ReviewEditIntentV1`, not as the wire type.**
  It is structurally `ReviewEditWireV1`; the route table's `send` is where
  TypeScript checks that the two still agree.

## Recorded deviations and debts (owners named)

- **CTL-044 has no M38 wrapper.** SCR-017's destination choice is CTL-044 (radio
  choice with a disabled state) and `src/ui/primitives/` was not in S07's lease,
  so the group is composed from React Aria's `RadioGroup`/`Radio` inside M43,
  meeting the control contract (visible label, reason in text, 44px). Same for
  the enum-options editor's `TextArea`. **Both belong in M38** when a session
  holds that lease.
- **SCR-020 shows no percentage.** A streamed parse has no truthful denominator,
  so the progress region states determinate facts instead; a denominator is an
  M37 addition with a producer, not a surface change.
- **The macro-content refusal card is F03's** — the refusal kind exists, its
  producer does not.
- SHT-014 is F04.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — module landed by SESSION-07 (`3861101`, `61ab11a`, `8a665c1`),
  with the cancel-receipt corrections at `b596dac`/`5867b02` proving CAP-11's
  surface tier through two real workers. CAP-09/10/12 surfaces verified at the
  real entry; axe clean on ten surfaces; 320px/44px mechanical.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-07 staple folded
  into the contract; the seeded "F02 scope" list rewritten as landed scope; the
  CTL-044/TextArea debt and the SCR-020 denominator gap recorded here with their
  owners rather than only in the run record.
