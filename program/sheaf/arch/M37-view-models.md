# M37 — View models (`src/application/view-models/`)

Extracted from specs/architecture.md §Module Contracts (View models).
Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** Minimum-data projections for approved surfaces + announcements.
- **Depends on:** M36 (machine snapshot types + the ordering and phrase
  constants), M32 protocol **types only**, M51 `CapabilityReport` **type
  only**. No runtime import from `src/workers/**`; asserted by
  `tests/unit/workflows/module-boundaries.test.ts`.
- **Must not:** include app names/counts/backup times/silhouettes in any
  locked-state VM — the *types* forbid the fields, not just the values; ask for
  "your passphrase" unqualified (exact-secret scope strings live in the VM per
  design.md §Content Patterns).

## Landed exports

### `security.ts` (F01)

`selectWelcomeVm(report)` (SCR-001, incl. the CAP-08 `unsupported` variant),
`selectSetupVm`, `selectUnlockVm`, `selectRecoveryVm`,
`selectSecuritySettingsVm`, `selectPassphraseChangeVm`, `selectRevealCodeVm`,
`selectResetVm` — each taking the corresponding machine snapshot — plus
`ErrorVm` / `toErrorVm` / `announceRefusal`, `IDLE_TIMEOUT_OPTION_VMS`,
`REFUSAL_ANNOUNCEMENT`, and the scope constants `LOCAL_PASSPHRASE_SCOPE`,
`CURRENT_LOCAL_PASSPHRASE_SCOPE`, `NEW_LOCAL_PASSPHRASE_SCOPE`,
`LOCAL_RECOVERY_CODE_SCOPE`, `LOCAL_RECOVERY_CODE_REACH`.

`REFUSAL_ANNOUNCEMENT` is `Readonly<Record<DataWorkerErrorKindV1, string>>` — an
**exhaustive map over M32's closed union**. Any new error kind breaks this file,
so the union and this map are one change, not two, and belong in one lease.

### `library.ts` (F01, reworked F02)

`selectLibraryVm(apps, searchQuery?)` → `LibraryVm = EmptyLibraryVm |
PopulatedLibraryVm`; `LibraryTileVm`, `LibraryTileStatusV1`,
`LibrarySearchScopeV1`, `LibraryActionIntent`; `selectEmptyLibraryVm()` kept.
**`LibraryActionVm` is a union** (D5's successor): the enabled variant carries
`intent`, the disabled one carries `reason`, and neither has the other's field.

### `import.ts` (F02)

`selectImportVm(snapshot)` → `ImportVm` (`UploadLandingVm`,
`DelimitedTargetVm`, `ImportFitsVm`, `ImportOverBudgetVm`, `ImportProgressVm`,
`ImportRefusedVm`, `ImportEndedVm`, `ImportReviewVm`, `ImportDoneVm`), plus
`ImportRowCountVm`, `ImportCleanupVm`, `ReviewSectionVm`, `ReviewFieldVm`,
`ReviewStatementVm`, `ImportPromotionConfirmVm`,
`REVIEW_EDIT_REJECTION_TOKENS`, `toReviewEditRejectionVm`.

### `records.ts` (F02)

`selectAppHomeVm`, `selectRecordsListVm`, `selectRecordDetailVm`,
`selectRecordFormVm`, `selectChangeHistoryVm`, `selectDeleteRecordDialogVm`,
`selectRestoreRecordDialogVm`, `toCommandOutcomeVm`, `toIssueVm`,
`announceRecordCommand`, `inputForField`, `handoffFor`, `MAX_SUPPORTING_FACTS`.

**No `announcements.ts`.** Folding was allowed and taken: each announcement has
exactly one consumer and depends on the fact beside it, so it lives on its VM
(`announcement`) or beside its outcome type (`announceRecordCommand`).

## Contracts worth recording

- **Must-nots enforced by types, not review** (each has a negative control).
  The locked models (`UnlockVm`'s `locked`/`delayed` variants, `LockedResetVm`)
  declare no field for an app name, record count, backup time or inventory, so a
  future writer cannot fill one. No view-model file names a passphrase-bearing
  field. For F02: no fictional library tile state is constructible
  (`LibraryTileStatusV1` has no conflict / listed-only / too-large / backed-up
  member — F05–F07); `ImportOverBudgetVm` has no sheet list and no
  capacity-detail field (D20); `RecordsListVm` has no match-count field;
  `AppHomeVm` has no metrics or chart field (F04); `RecordDetailVm` has no
  relationships field (D25).
- **Truthful enumeration.** `ReadableResetVm.inventory` is
  `"loading" | "none" | rows` — there is deliberately no `"unknown"`.
- **Estimate flags survive in both directions (D24).** Pre-flight's
  `isEstimate: true` becomes `ImportRowCountVm{kind:"estimated"}`; the
  proposal's `isRowCountExact: true` becomes `{kind:"exact"}`. Neither literal
  can be widened, so neither can be rendered as the other.
- **`totalCount` is the table's count even on a search page.** The VM names the
  field `tableRecordCount` and carries `scope` beside it, so the sentence a
  surface writes has to say which was searched.
- **The change log is post-checkpoint only.** `ChangeHistoryVm.scope` is the
  literal `"since-last-checkpoint"` and the empty state is
  `"no-changes-since-checkpoint"` — "the app's history" is a claim this data
  cannot support and a fresh import's empty log is correct.
- **`commitId: null` is a no-op, not a failure.** `RecordCommandOutcomeVm` gives
  it its own `no-op` member so it can never render as an error.
- **A nulled violation count reads "not measured yet", never "none".**
  `ReviewFieldVm.violations` is `{kind:"measured"} | {kind:"not-measured-yet"}`,
  and `isNeedsAttentionExact` goes false whenever any field is unmeasured.
- **Empty is stated, never implied (STA-025).** `ReviewEmptinessV1`
  distinguishes `not-applicable-value-only` (a delimited file has no
  connections, calculations or sheets to find) from `none-found`;
  `RecordsEmptinessV1` distinguishes `empty-table` from `no-results`. A
  zero-field proposal disables "Create app" with a no-fields-found reason rather
  than offering an empty app.
- **The cleanup receipt has three states, and the third says less.**
  `ImportCleanupVm` is `removed | nothing-to-remove | unconfirmed`; the
  unconfirmed variant must **not** claim "no partial app remains".
- **Only unambiguous URI schemes become hrefs.** `tel:`, `mailto:` and
  `http(s)` are built here; a textual address yields `{kind:"maps", query}` with
  **no URL**, because no registered scheme exists for one and choosing a maps
  provider is M51's platform decision, not M37's. Non-http(s) URL values (e.g.
  `javascript:`) yield no handoff at all.
- **The FR-12 input mapping is total and type-held.** `inputForField` is
  exhaustive over `FieldTypeWireV1` with a `never` check; `reference` maps to
  `{kind:"unsupported", control:"read-only"}` rather than a picker (D25).
- **Announcement copy provenance.** Mock-quoted strings carry source comments;
  states with no mock sentence are composed from facts in Content Patterns
  style. These are `aria-live` strings, not visible copy — M41/M43/M44 own
  visible wording but must not remove the scope strings or the D4 delay wording.
- **Mock divergence per Custom Rule 3.** reset.html's survivor line names Google
  Drive; the VM carries "Dropbox, OneDrive, or bundle copies" and a test asserts
  no `/drive|google/i` match. The VMs make no `LCL-` prefix claim (AD-10).
- **The boundary sweep can no longer go stale.**
  `tests/unit/workflows/module-boundaries.test.ts` checks its two file lists
  against the directories themselves, so a new M36/M37 file that is not swept
  fails the suite. Proven by a negative control.

## Known gaps with owners (open at `5ab3b07`)

- **Live-region pluralization.** `records.ts:458` announces "1 values need
  attention" and `:857` "1 changes since this app was last checkpointed" — the
  screen-reader channel only; every visible sentence is correct. Deliberately
  **not** fixed before GATE-F02 so HEAD stays identical to the proven demo
  revision. Owner: a post-verdict owner correction, or F03's first M37-leased
  session.
- **SCR-020 has no progress percentage** because no truthful denominator exists
  during a streamed parse; the surface shows determinate facts instead. A
  denominator, if one is ever wanted, is an M37 addition with a producer.
- **`promotionIssues` carry no `fieldId` mapping**, so a promotion rejection
  cannot yet point at the offending column. Owner: M37/F03.
- **Glyph and accent are not on `AppSessionViewV1`** — per-app identity renders
  from the catalog tile, not from the open session. Promoting them is F04's
  theme work.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 implemented by SESSION-06 (`883f815`); consumed verbatim by
  SESSION-07 (`9174b6d`, re-run at `2c0248a`).
- 2026-09-08 — reconciled by Roshi (F01 final pass): staple merged;
  copy-provenance and Custom Rule 3 facts promoted from the session return.
- 2026-09-08 — F02 families (`import.ts`, `records.ts`, reworked `library.ts`)
  landed by SESSION-06 (`cc60008` / `2c19e4e`, incl. the r2 union narrowing);
  bound verbatim by the surfaces at `8a665c1` and `5ab3b07`. The M37
  exhaustive-error-kind seam was **cleared** here without widening the union:
  M36 gates every mutating stage call and reports `stage-missing`.
- 2026-09-08 — reconciled by Roshi (F02 final pass): two session staples and two
  separate "Contracts worth recording" sections folded into one; the exhaustive
  `REFUSAL_ANNOUNCEMENT` map recorded beside the export it constrains; the four
  open gaps named with owners instead of living only in the run record.

<!-- workbook-fidelity SESSION-06 -->
### workbook-fidelity SESSION-06 (2026-09-23, commits 4287569..677b947)

**M36 / M37 / M43 — mechanical adaptation (S07 replaces)**
- `import-services.ts`: `applyReviewEdit` takes `WorkbookReviewEditWireV1`; new pure `singleTableProposal(wire) → ProposedAppWireV1 | null` (fails closed on >1 table or any workbook-only member; statement ids pass through) and `workbookEditOf(wire, f02Edit)` (addresses the one table by `tableKey`/`columnKey`).
- `import.machine.ts`: `context.proposal: ProposedWorkbookWireV1`; fails closed (`service-error`) when inference/edit returns no one-table view; `workbook-preflight` in `detecting` fails closed (`malformed-request`); edits translated with `workbookEditOf`.
- `view-models/import.ts`: review reads `singleTableProposal(context.proposal)`; `PROMOTION_REJECTION_TOKENS` (pinned ≡ `PROMOTION_REJECTIONS`, incl. `append-too-large`), `toPromotionRejectionVm`, `ImportReviewVm.promotionRejection` (token only; copy is S07's, D43).
- `src/ui/import/**`: unchanged.
