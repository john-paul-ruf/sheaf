# M44 — UI records (`src/ui/records/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / UI feature modules + `specs/design.md`. Reconciled
> against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

## Contract

- **Owns (approved surfaces):** SCR-024–032; MOD-009–011; SHT-001–010,
  SHT-016.
- **Exports:** Route components and typed user intents.
- **Depends on:** M38 (`Button`, `Dialog`, `TextField`, `Checkbox`,
  `StatusBanner`, `InlineLink`, `cx`, visually-hidden), M39 (`AppShell`), M40
  (tokens; F04 `appThemeVariables`), M37 (`src/application/view-models/
  records.js`).
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

F04 (S04/S05/S06/S08 @ `5bc19fb`): SCR-024's metrics and pinned charts
(closing the F02/F03 "truthful absence" carry), SCR-025's type-aware filter
chips and sort (SHT-004–009), computed-value display, SCR-036's dark/light
per-app chrome on `AppFrame`, and the app nav's Charts/Structure/Settings
destinations.

F05 (S06 @ `2d8ff2d`): SCR-032's change-history screen renders the new
retained-history scope after compaction (see "Retained history", below).

### Files (23)

`app-frame.tsx`, `app-home-screen.tsx`, `records-screen.tsx`,
`record-detail-screen.tsx`, `record-form-screen.tsx`, `enum-picker-sheet.tsx`,
`record-actions-sheet.tsx`, `delete-record-dialog.tsx`,
`restore-record-dialog.tsx`, `change-history-screen.tsx`, `records.module.css`,
`values.ts`, `reference-picker-sheet.tsx` (F03, SHT-002; `ReferencePickerSheet`,
`ReferenceSearchBody`, shared with MOD-011), `repair-reference-dialog.tsx`
(F03, MOD-011), `table-switcher-sheet.tsx` (F03, SHT-003;
`TableSwitcherTrigger`, `TableSwitcherSheet`), `snapshots-screen.tsx` (F03,
SCR-030), `snapshot-viewer-screen.tsx` (F03, SCR-031),
`snapshot-options-sheet.tsx` (F03, SHT-016), and (F04, Custom Rule 7)
`filter-chips.tsx`, `filter-sheets.tsx`, `sort-sheet.tsx`,
`computed-value.tsx`.

Two F02 files were already beyond the plan's Files table (Custom Rule 7):

- `app-frame.tsx` — the app area's shell composition. Every app-area surface
  renders inside one identity + one set of destinations; a screen that built
  its own frame would be free to disagree with the next one. F03 adds
  `"snapshots"` to `AppArea`; **F04** adds `"charts" | "structure" |
  "settings"`, and the frame root now carries `data-app-mode`,
  `data-app-density` and `appThemeVariables(...)` directly (`appThemeStyle`
  was removed as a separate helper). The app nav's six destinations (home,
  table, Charts, Structure, Settings, All apps) are why Sheet snapshots and
  Change history moved off the bar in F04 (reached from SCR-037 and the app
  home instead, so every 320px target stays ≥ 44px) — `appSnapshots`/
  `appHistory` remain in `AppNavigation`.
- `values.ts` — the value/format helpers the screens share: `describeValue`,
  `formatCurrency`, `formatEpochDay`, `epochDayToIsoDate`, `isoDateToEpochDay`,
  `isCanonicalDecimalText`, `monogramFor`, `formatCount`, `describeRecordCount`,
  `isAbsent`, `FieldTypeVm`; F03 adds `describeReference`.

### Exports

`AppHomeScreen`, `RecordsScreen`, `RecordDetailScreen` (+ `mapsHref`,
`describeIssueCounts`), `RecordFormScreen` (+ `AuthoredEntryIntentV1`,
`AuthoredValueIntentV1`, `intentFor`, `initialDraft`), `EnumPickerSheet`,
`RecordActionsSheet`, `DeleteRecordDialog`, `RestoreRecordDialog`,
`ChangeHistoryScreen` (+ `describeEvent`, moved to M37 at F04 — see
`M37-view-models.md`), `AppFrame` (+ `AppIdentity`, `AppNavigation`,
`AppTableLink`, `AppArea`, `AppThemeVm`), `ReferencePickerSheet`,
`ReferenceSearchBody`, `RepairReferenceDialog`, `TableSwitcherTrigger`,
`TableSwitcherSheet`, `SnapshotsScreen`, `SnapshotViewerScreen`,
`SnapshotOptionsSheet` (F03), and (F04) `FilterChips`, `FilterSheet`,
`SortSheet`, `ComputedValue`.

## Decisions worth carrying forward

- **`AppFrame` is a sibling of M41's `UnlockedFrame`, not a variant.** Inside an
  app the destinations are the app's own (home, its tables, Charts, Structure,
  Settings — F04) plus "All apps". M39 still exposes exactly one primary
  navigation per layout class, which `accessibility.spec.ts` asserts inside
  the app area as well as in the shell.
- **The app theme lands here.** `AppSessionViewV1.theme` (D29) becomes the six
  `--app-*` custom properties **and** (F04) the full `appThemeVariables(...)`
  presentation-role remap on the frame's root, typed as `CSSProperties &
  Record<\`--app-${string}\`, string>` so a system-owned property cannot be
  written from a theme even by mistake. F04's SCR-024 `.hero` paints
  `--color-chrome`/`--color-chrome-text` (app-ink chrome with app-surface text
  in light mode, app-surface chrome with app-ink text in dark mode) so it no
  longer goes near-white-on-near-white when an app theme is dark; outside an
  app theme it falls back to ink-950/white as before.
- **One list, densified — never a second copy of the rows.** The same list is
  laid out as cards up to the desktop class and as dense rows above it.
- **A number is a text input with `inputmode="decimal"`, not `type="number"`.**
  What was typed crosses as `{kind:"number"}` when it is a canonical decimal
  and as `{kind:"text"}` when it is not — the one validator refuses it
  (invariant 5, D23). `isCanonicalDecimalText` fails *closed*. **F04:** a
  computed field never reaches this input path at all — it renders through
  `computed-value.tsx`, read-only, with its badge/note/expression and a
  reduced-motion-respecting recalculation underline.
- **The success sentence is a prop the route sets from the receipt**, never
  from a submit — invariant 1 at the surface.
- **The maps handoff href is built here** over M37's `{kind:"maps", query}`
  fact, because choosing a provider is a platform decision M37 must not make.
- **A reference field opens SHT-002 from the record form** (F03); a broken
  reference's original key is read straight from `ReferenceCellVm`'s broken
  variant, never re-derived in the screen. `ReferenceSearchBody` (F04) takes
  an optional `selectedIds` for multi-select.
- **The snapshot viewer never renders workbook markup.** SCR-031 reads only
  M37's normalized cell text, merge ranges and inert anchors (D41); "Find in
  sheet" moves focus via M38's `TextField.inputId`.
- **F04: filters and sort are sheets over a sticky chip row.**
  `filter-chips.tsx` scrolls sideways below 900px and wraps at the desktop
  class; `filter-sheets.tsx` composes SHT-004–008 on `Dialog`; `sort-sheet.tsx`
  is SHT-009. `records-screen.tsx` shows the match count, a "Clear all
  filters" action, the STA-014 partial banner, the STA-026 filtered-empty
  state, and a refusal banner for an invalid filter combination. App home
  shows "At a glance" only when metrics or a pinned chart actually exist —
  closing the F02/F03 truthful-absence carry named below.
  `app-home-screen.tsx` also gains an "Edit structure" link (when `nav.
  structure` is present) and pinned-chart tiles (mark → filtered records,
  "View data table" → SCR-033, "Edit chart").

## Retained history (F05, S06, CA-40, CAP-44)

`change-history-screen.tsx` renders `ChangeHistoryScreen` from
`ChangeHistoryVm` (M37's `selectChangeHistoryVm`) exactly as it did in
F02–F04, but that VM now carries a third scope value for a compacted app:
`scope: "retained-history"`, `emptiness: "no-retained-changes"`, with
announcements "N retained change(s) shown." / "No retained changes yet." The
screen's copy describes **retained history** — every authored event the
compaction candidate proved it preserved, with no "since the last checkpoint"
framing — rather than a cutoff at the newest checkpoint; an app that has
never compacted still reads the unchanged F02 "since last checkpoint" copy.
See `M37-view-models.md`'s "records.ts (F02, extended F03, F04, F05)" section
for the VM value contract this screen switches on; this fragment owns only
the screen's presentation of it.

The per-entry **" · this device"** origin-device line is unchanged by
compaction — S06 CP2's implementation had briefly dropped it without
authorization, and the correction (`fccc345`) restored it before receipt, so
every retained-history entry still names its originating device exactly as a
pre-compaction entry does.

Independent receive at `2d8ff2d`: typecheck/lint exit 0; full unit 229
files/2520 pass/3 inherited skips; CP1+installed gate 39 files/473 pass;
browser J3 2/2 (real UI history/restore through the real entry, at 320/600/
900/1200 with axe checked), sync/compaction+bundle 3/3, J1/append/status/
records/gate-f02/import-journey 18/18 (port 8081, fresh build).

## Known gaps with owners (open at `5bc19fb`)

- **`InlineLink`'s `externalHandoff` still throws** (M38 backlog, unchanged
  since F02) — paging elsewhere (records list) is exercised by unit tests only
  where the demo corpus is smaller than a page.
- **`top: 68px` is a literal** where M39 has no top-bar height token. Owner:
  M39.
- **CTL-044 (SCR-017's destination radio group) has no M38 wrapper** — still
  composed in-place from React Aria's `RadioGroup`/`Radio` (M43, not M44).
  Recorded once here for cross-reference; the owning gap lives in
  `M38-ui-primitives.md`.
- **F04: the chart canvas recolours only on the next render after a live
  scheme flip** (system dark/light toggling mid-session) — carried to the
  next feature leasing `src/ui/charts/**`.
- **F04: no add-plain-field surface in SCR-035.** Every new field in this
  cycle's demo journey is a live calculation; whether an authored, non-
  computed field needs its own add path is a product/requirements question
  carried to the GATE-F04 reviewer, not a UI gap in this module.

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

## Closed in F04 (was open at `30396a9`, resolved here — not re-carried)

- **SCR-024 rendered truthful absence for metrics and charts** because
  neither existed yet. Closed: S04 (metrics) and S05 (pinned charts) both
  land in "At a glance", and the absence card now draws only when both are
  genuinely absent.
- **`AppSessionViewV1` carried no glyph or accent**, so the app home computed
  its monogram the way M23's `glyphForApp` does. Closed: S08 lands
  `accentId`/`glyph` on the view model (see `M37-view-models.md`); this
  module now reads them rather than re-deriving the rule.

## Shared app backup status (F05)

`AppIdentity.durability?` and exported `AppBackupStatus({facts, href, compact?})` render shared detailed/compact receipt facts on app frame/home and in M46 Settings. M37 supplies freshness and remedies; Back up now / Save a fresh bundle reaches the mounted backup route. Safety status uses system tokens independently of app theme. The owned 320px sticky-toolbar interception was fixed at `47a633b` and the original integration assertions retained. S06's retained-history/restore presentation is now landed (see "Retained history", above) — this status work and that presentation share no field.

Source and current proof scope: [F05 boundaries](F05-boundaries.md), production `47a633b`, S06 through `2d8ff2d`.

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
- 2026-09-23 — F04: filters/sort/computed display by SESSION-04
  (`f736fa8`..`27a2667`); the Charts destination and pinned-chart tiles by
  SESSION-05 (`6ee204c`..`3dd1d2d`); the Structure/Settings destinations by
  SESSION-06 (`e7e7fe2`..`7ec391e`); per-app chrome, the logo hero and the
  `.hero` chrome-role repaint by SESSION-08 (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): four SESSION deltas
  folded into Landed scope/Files/Exports/Decisions; the truthful-absence and
  glyph/accent gaps (open since F02/F03) moved to "Closed in F04" with their
  closing sessions, rather than left describing a state the current tree no
  longer has; two new open gaps (chart-recolour timing, no add-plain-field
  surface) recorded from the Final Report's residual-gaps list so this
  module's own fragment states its own open questions.
- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
- 2026-09-25 — S06 compaction (CAP-44): `change-history-screen.tsx`'s
  retained-history copy landed and the unauthorized removal of the
  " · this device" line was corrected before receipt (`084ecf9` through
  `250c9e0`/`fccc345` to `2d8ff2d`), independently verified. Folded into a
  new "Retained history" section rather than left as a delta duplicated
  verbatim into both this file and `M37-view-models.md` (Principle 2); the
  VM-value half of that same delta is reconciled in `M37-view-models.md`
  instead, with a cross-reference here.
