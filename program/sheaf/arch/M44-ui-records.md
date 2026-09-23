# M44 — UI records (`src/ui/records/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / UI feature modules + `specs/design.md`. Reconciled
> against the tree at `425562d` (F03 final; code ≡ `30396a9`).

## Contract

- **Owns (approved surfaces):** SCR-024–032; MOD-009–011; SHT-001–010,
  SHT-016.
- **Exports:** Route components and typed user intents.
- **Depends on:** M38 (`Button`, `Dialog`, `TextField`, `Checkbox`,
  `StatusBanner`, `InlineLink`, `cx`, visually-hidden), M39 (`AppShell`), M40
  (tokens), M37 (`src/application/view-models/records.js`).
- **Must not:** Acknowledge a save before `CommitConfirmed`, calculate merge
  eligibility, hide partial/broken/stale states, hold a state-machine runtime,
  or import anything but `react` and `react-aria-components` as packages
  (`tests/unit/ui/architecture.test.ts`). It imports **no** worker type: every
  wire shape reaches it through M37, and the two structural mirrors it needs
  (`AuthoredEntryIntentV1`, `FieldTypeVm`) are declared here and checked against
  the wire union at the route table.

## Landed scope

F02 (S08 @ `5ab3b07`): SCR-024 (app home — identity, table list, truthful
scratch status; metrics and charts render truthful absence until F04),
SCR-025 (records list + sticky search), SCR-026 (empty + no-result variants),
SCR-027 (record detail), SCR-028/029 (create/edit with typed inputs), SCR-032
(change history + restore), MOD-009 (delete), MOD-010 (restore), SHT-001 (enum
sheet), SHT-010.

F03 (S08 @ `30396a9`): MOD-011 (repair a broken reference), SHT-002 (reference
picker), SHT-003 (table switcher), SCR-030/031 (snapshots list + viewer),
SHT-016 (snapshot options); SCR-027's relationships section
("Belongs to"/"Has many"); the deleted-record read for MOD-010's original
values; multi-table change history.

### Files (17)

`app-frame.tsx`, `app-home-screen.tsx`, `records-screen.tsx`,
`record-detail-screen.tsx`, `record-form-screen.tsx`, `enum-picker-sheet.tsx`,
`record-actions-sheet.tsx`, `delete-record-dialog.tsx`,
`restore-record-dialog.tsx`, `change-history-screen.tsx`, `records.module.css`,
`values.ts` — plus six added by F03 (Custom Rule 7):
`reference-picker-sheet.tsx` (SHT-002; `ReferencePickerSheet`, and
`ReferenceSearchBody`, which MOD-011 shares), `repair-reference-dialog.tsx`
(MOD-011), `table-switcher-sheet.tsx` (SHT-003; `TableSwitcherTrigger`,
`TableSwitcherSheet`), `snapshots-screen.tsx` (SCR-030),
`snapshot-viewer-screen.tsx` (SCR-031), `snapshot-options-sheet.tsx`
(SHT-016).

Two F02 files were already beyond the plan's Files table (Custom Rule 7):

- `app-frame.tsx` — the app area's shell composition. Every app-area surface
  renders inside one identity + one set of destinations; a screen that built
  its own frame would be free to disagree with the next one. F03 adds
  `"snapshots"` to `AppArea`.
- `values.ts` — the value/format helpers the screens share: `describeValue`,
  `formatCurrency`, `formatEpochDay`, `epochDayToIsoDate`, `isoDateToEpochDay`,
  `isCanonicalDecimalText`, `monogramFor`, `formatCount`, `describeRecordCount`,
  `isAbsent`, `FieldTypeVm`; F03 adds `describeReference`.

### Exports

`AppHomeScreen`, `RecordsScreen`, `RecordDetailScreen` (+ `mapsHref`,
`describeIssueCounts`), `RecordFormScreen` (+ `AuthoredEntryIntentV1`,
`AuthoredValueIntentV1`, `intentFor`, `initialDraft`), `EnumPickerSheet`,
`RecordActionsSheet`, `DeleteRecordDialog`, `RestoreRecordDialog`,
`ChangeHistoryScreen` (+ `describeEvent`), `AppFrame` (+ `AppIdentity`,
`AppNavigation`, `AppTableLink`, `AppArea`, `AppThemeVm`, `appThemeStyle`), and
(F03) `ReferencePickerSheet`, `ReferenceSearchBody`, `RepairReferenceDialog`,
`TableSwitcherTrigger`, `TableSwitcherSheet`, `SnapshotsScreen`,
`SnapshotViewerScreen`, `SnapshotOptionsSheet`.

## Decisions worth carrying forward

- **`AppFrame` is a sibling of M41's `UnlockedFrame`, not a variant.** Inside an
  app the destinations are the app's own (home, its tables, its change history,
  and — F03 — its snapshots) plus "All apps". M39 still exposes exactly one
  primary navigation per layout class, which `accessibility.spec.ts` asserts
  inside the app area as well as in the shell.
- **The app theme lands here.** `AppSessionViewV1.theme` (D29) becomes six
  `--app-*` custom properties on the frame's root, typed as
  `CSSProperties & Record<\`--app-${string}\`, string>` so a system-owned
  property cannot be written from a theme even by mistake.
- **One list, densified — never a second copy of the rows.** The same list is
  laid out as cards up to the desktop class and as dense rows above it.
- **A number is a text input with `inputmode="decimal"`, not `type="number"`.**
  What was typed crosses as `{kind:"number"}` when it is a canonical decimal
  and as `{kind:"text"}` when it is not — the one validator refuses it
  (invariant 5, D23). `isCanonicalDecimalText` fails *closed*.
- **The success sentence is a prop the route sets from the receipt**, never
  from a submit — invariant 1 at the surface.
- **The maps handoff href is built here** over M37's `{kind:"maps", query}`
  fact, because choosing a provider is a platform decision M37 must not make.
- **A reference field opens SHT-002 from the record form** (F03); a broken
  reference's original key is read straight from `ReferenceCellVm`'s broken
  variant, never re-derived in the screen.
- **The snapshot viewer never renders workbook markup.** SCR-031 reads only
  M37's normalized cell text, merge ranges and inert anchors (D41); "Find in
  sheet" moves focus via M38's `TextField.inputId`.

## Known gaps with owners (open at `30396a9`)

- **`InlineLink`'s `externalHandoff` still throws** (M38 backlog, unchanged
  since F02) — paging elsewhere (records list) is exercised by unit tests only
  where the demo corpus is smaller than a page.
- **`AppSessionViewV1` carries no glyph or accent**, so the app home computes
  its monogram the way M23's `glyphForApp` does. If per-app identity grows
  (F04's theme editor), promote it into the view model rather than
  duplicating the rule a third time.
- **`top: 68px` is a literal** where M39 has no top-bar height token. Owner:
  M39.
- **CTL-044 (SCR-017's destination radio group) has no M38 wrapper** — still
  composed in-place from React Aria's `RadioGroup`/`Radio` (M43, not M44).
  Recorded once here for cross-reference; the owning gap lives in
  `M38-ui-primitives.md`.

## Closed in F03 (were open at `5ab3b07`, resolved here — not re-carried)

- **MOD-010 showed only what was knowable, with no deleted-record read.**
  Closed: S03 CP3 added the `getDeletedRecord` query/RPC; S08 CP3 consumes it
  in `RestoreRecordDialog`, so the dialog now shows the record's original
  values.
- **`ChangeHistoryScreen` assumed one table.** Closed: every history entry
  carries `tableId` and the screen names the table (S03 wire, S08 surface).
- **Records-list paging was exercised by unit tests only (50 > 40 rows).**
  Closed for the demo corpus: S08 CP4 exercises the Jobs table's paging past
  50 rows through the real entry (`snapshots.spec.ts`/`relationships.spec.ts`
  e2e); the general "demo corpus smaller than a page" caveat is retained above
  only for `InlineLink`'s paragraph, which is a different surface.
- Live-region pluralization ("1 values need attention" / "1 changes since…")
  is M37's gap, and is recorded as closed there (S08 CP1) — not duplicated
  here.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — landed by SESSION-08 (`fe3a8d4`, `db48c4a`, `c46d3cb`, `4c7e1b0`,
  `6362e98`, `5ab3b07`): CAP-15/16/17 surfaces and CAP-13's restart leg verified
  through the real entry; the GATE-F02 demo journey runs at 320px; axe clean.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-08 staple
  folded in; the seeded "F02 scope" paragraph rewritten as landed scope; the
  M54 section that was stapled into this fragment moved to `M54-routes.md`.
- 2026-09-23 — F03: relationships (MOD-011, SHT-002/003, "Belongs to"/"Has
  many"), snapshots (SCR-030/031, SHT-016) and the deleted-record read landed
  by SESSION-08 (`eba5790`..`30396a9`).
- 2026-09-23 — reconciled by Archivist (F03 final pass): the SESSION-08 staple
  folded into Landed scope/Files/Exports; three gaps the F02 final pass had
  recorded as open (MOD-010's missing deleted-record read, single-table change
  history, unit-only paging) are moved to "Closed in F03" with their closing
  evidence, rather than left standing beside the surfaces that closed them.

<!-- formulas-queries-charts SESSION-04 -->
### F04 delta — SESSION-04 (M44 Records UI (`src/ui/records/`))

- New:
  - `filter-chips.tsx`: a sticky chip row that scrolls sideways below 900px and wraps at the desktop class;
  - `filter-sheets.tsx`: SHT-004–008 on `Dialog`;
  - `sort-sheet.tsx`: SHT-009;
  - `computed-value.tsx`: read-only computed value with badge, note and expression, and a recalculation underline that respects reduced motion through the duration tokens.
- `records-screen.tsx`: chips, match count, "Clear all filters", the STA-014 banner, the STA-026 filtered-empty state, and a refusal banner.
- Detail and form render computed columns read-only. App home shows "At a glance" only when metrics exist.
- `ReferenceSearchBody` takes an optional `selectedIds` for multi-select.

<!-- formulas-queries-charts SESSION-05 -->
### F04 delta — SESSION-05 (M44 records UI — `src/ui/records/`)

- `app-frame.tsx`: `AppArea` gains `"charts"`; `AppNavigation.charts?` adds the "Charts" destination (after the table) → SCR-053. `app-home-screen.tsx`: pinned charts (mark → records filtered, "View data table" → SCR-033, "Edit chart"); the F02 absence card is drawn only when there are no metrics and no pinned chart. `records-screen.tsx`: the heading eyebrow names the chart a mark's filter came from.

<!-- formulas-queries-charts SESSION-06 -->
### F04 delta — SESSION-06 (M44 — records UI)

- `app-frame.tsx`: `AppArea` += `"structure" | "settings"`; `AppNavigation` += optional `structure`, `settings`. Destinations are now Home · table · Charts · Structure · Settings · All apps (schema.html / app-settings.html rails); Sheet snapshots and Change history left the bar (six destinations keep each 320px target ≥44px) and are reached from SCR-037 and app home. `appSnapshots`/`appHistory` stay in `AppNavigation` (app home and SCR-037 link them).
- `app-home-screen.tsx`: "Edit structure" link in the "Open a table" section head when `nav.structure` is present (app-home.html).
