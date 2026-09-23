# M43 — UI import (`src/ui/import/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / UI feature modules + `specs/design.md`. Reconciled
> against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

## Contract

- **Owns (approved surfaces):** SCR-016–023, SCR-043–045; MOD-004–008,
  034–035; SHT-013.
- **Exports:** Route components and typed user intents.
- **Depends on:** M38–M40 primitives/layout/theme + `src/application/view-models/`.
- **Must not:** Acknowledge a save before `CommitConfirmed`, hide
  partial/broken/stale states, or import anything but `react` and
  `react-aria-components` as packages. Screens are presentational — VM in,
  callbacks out; actors live in `src/routes/`. **No worker type is named, not
  even in a type position.**

## Landed scope

F02 (S07 @ `8a665c1`): SCR-016 (upload landing), SCR-017 (delimited target),
SCR-018/019 delimited variants, SCR-020 (progress + cancellation), SCR-021
(refusals), SCR-022 (failed/cancelled + cleanup receipt), SCR-023 (review,
single-table), MOD-004 (mismatch), MOD-005/006 (refusal detail), MOD-007
(cancel confirm), MOD-008 (failure detail), SHT-013 (evidence detail).

F03 (S07 @ `e062f41`): SCR-018/019's **workbook** variants (multi-sheet
pre-flight, selection, handoff), SCR-020's per-sheet progress naming,
SCR-021's macro/unsafe refusal detail, SCR-022's per-sheet failure detail,
SCR-023 rewritten **multi-table** (connections, calculations, sheets &
snapshots). SCR-043–045 and MOD-034/035 remain F06 (re-upload).

F04 (S07 @ `f9a1565`): SCR-023's review copy grows a **live-structure**
article per statement kind, on top of the F03 multi-table shape — no new
screen, no new SCR/MOD id.

### Exports

- `upload-screen.tsx` → `UploadScreen`, `ChooseAnotherFileButton` (F03: a
  CSV/TSV picker for "table targeting" alongside the workbook flows).
- `delimited-target-screen.tsx` → `DelimitedTargetScreen`, `formatCount`,
  `describeRowCount`, `describeContradiction`.
- `workbook-preflight-screen.tsx` (new, F03) → SCR-018/019's workbook
  steps, MOD-004 dialog, the handoff card.
- `preflight-screens.tsx` → `PreflightFitsScreen`, `PreflightOverBudgetScreen`
  (delimited variants only — the workbook variants live in the new file
  above), `describeBytes`, `describeOverBudget`.
- `import-progress-screen.tsx` → `ImportProgressScreen`,
  `ImportProgressRegion`, `ImportPhaseVm`, `CANCELLATION_CONTRACT`.
- `import-refused-screen.tsx` → `ImportRefusedScreen`, `refusalCard`;
  `RELEASE_SCOPE` was **removed in F03** (D19's card is retired — the page now
  accepts workbooks, D42/D48).
- `import-failed-screen.tsx` → `ImportFailedScreen`, `describeCleanup`.
- `review-screen.tsx` → `ReviewScreen`, rewritten multi-table (F03):
  connections with Change connection → reject/restore/retarget, Live
  calculations as preserved-not-live, Sheets & snapshots with STA-012 inert
  items, excluded sheets. **F04 (SESSION-07):** live-structure articles — a
  computed column carries `ReviewCalculationVm`'s reject/restore/why article; a
  rebuilt chart carries `ReviewChartVm` (including whether it lands pinned);
  a converted validation carries `ReviewRuleVm`'s description; the section
  header states "N formulas keep working" from the exact count; a summary
  sheet's dashboard values get their own sentence.
- `review-evidence.tsx` → `EvidenceSheet`, `evidenceTag`, `describeEvidence`,
  `describeDiagnostic`, `EvidenceVm`, `ImportDiagnosticVm`. **F04:** gains the
  formula-outcome evidence copy (why a formula was translated, kept
  unsupported, or frozen).
- `review-edit-dialog.tsx` → `ReviewEditDialog`, `ReviewEditDraftV1`,
  `ReviewEditIntentV1` (F03: now the structural twin of
  `WorkbookReviewEditWireV1`), `FieldTypeVm`, `describeFieldType`,
  `describeFieldTypePhrase`.
- `import-stages.tsx` → `ImportStages`, `IMPORT_STAGES`, `ImportStageIdV1`.
- `import.module.css` — unlayered, per the layer contract.

Files beyond the F02 plan's table (Custom Rule 7): `import-stages.tsx`,
`review-evidence.tsx`, `review-edit-dialog.tsx`. F03 adds one more:
`workbook-preflight-screen.tsx` (SCR-018/019 needed a whole second pre-flight
family for multi-sheet selection that the delimited screens could not share).
F04 adds no new file — the live-structure articles are new copy inside the
existing `review-screen.tsx`/`review-evidence.tsx`.

## Two type-held facts

- **`src/ui/**` names no worker type.** Every wire shape the review needs is
  aliased off the view model instead (`EvidenceVm`, `ImportDiagnosticVm`,
  `FieldTypeVm`, `ImportFailureReasonVm`, `ImportPhaseVm`).
- **An edit leaves the surface as `ReviewEditIntentV1`, not as the wire
  type.** It is structurally `WorkbookReviewEditWireV1` (F03; was
  `ReviewEditWireV1` in F02); the route table's `send` is where TypeScript
  checks that the two still agree.

## Recorded deviations and debts (owners named)

- **CTL-044 has no M38 wrapper.** SCR-017's destination choice is composed
  from React Aria's `RadioGroup`/`Radio` inside M43. Same for the enum-options
  editor's `TextArea`. Both belong in M38 when a session holds that lease.
  Unchanged by F03/F04 (see `M38-ui-primitives.md`).
- **SCR-020 shows no percentage.** A streamed parse has no truthful
  denominator; F03's per-sheet naming ("Sheet k of n · name · rows committed")
  is a richer determinate fact, still not a percentage — D24 class, unchanged.
- SHT-014 belongs to M46 (F04, landed).

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — module landed by SESSION-07 (`3861101`, `61ab11a`, `8a665c1`),
  with the cancel-receipt corrections at `b596dac`/`5867b02`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-07 staple
  folded into the contract; the CTL-044/TextArea debt and the SCR-020
  denominator gap recorded here with their owners.
- 2026-09-23 — F03: mechanical single-table adaptation by SESSION-06
  (`4287569`..`677b947`), replaced by the real multi-table/workbook rewrite —
  including the new `workbook-preflight-screen.tsx` — by SESSION-07
  (`2185774`..`e062f41`); promotion-issue copy by OWNER-PROMOTION-SEAMS
  (`0634e81`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): three staples (two
  describing the same files at two sequential states) folded into one
  description of the module as it now stands, per Principle 2; the copy rule
  from OWNER-PROMOTION-SEAMS ("“<field>” in “<table>”, N values: <sentence>",
  falling back to "One field, …" when the name is unknown) is recorded inside
  `review-screen.tsx`'s description via the Landed-scope paragraph rather than
  as a separate trailing note.
- 2026-09-23 — F04: the live-structure review articles landed by SESSION-07
  (`978bb77`..`f9a1565`) (delta recorded jointly with `M36-workflows.md`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): the SESSION-07 delta
  folded into "Landed scope" and the `review-screen.tsx`/`review-evidence.tsx`
  export descriptions, rather than left only as a cross-reference to
  `M36-workflows.md` — a reader of this fragment alone can now see what F04
  changed in the module it actually owns.
