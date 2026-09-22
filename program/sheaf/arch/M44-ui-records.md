# M44 — UI records (`src/ui/records/`)

> Seeded by Forge for F02 (csv-import-first-app) from `specs/architecture.md`
> § Module Contracts / UI feature modules + `specs/design.md`. Reconciled
> against the tree at `5ab3b07` (F02 final).

## Contract

- **Owns (approved surfaces):** SCR-024–032 (non-chart); MOD-009–011;
  SHT-001–010, SHT-016.
- **Exports:** Route components and typed user intents.
- **Depends on:** M38 (`Button`, `Dialog`, `TextField`, `StatusBanner`,
  `InlineLink`, `cx`, visually-hidden), M39 (`AppShell`), M40 (tokens), M37
  (`src/application/view-models/records.js`).
- **Must not:** Acknowledge a save before `CommitConfirmed`, calculate merge
  eligibility, hide partial/broken/stale states, hold a state-machine runtime,
  or import anything but `react` and `react-aria-components` as packages
  (`tests/unit/ui/architecture.test.ts`). It imports **no** worker type: every
  wire shape reaches it through M37, and the two structural mirrors it needs
  (`AuthoredEntryIntentV1`, `FieldTypeVm`) are declared here and checked against
  the wire union at the route table.

## Landed scope (F02, S08 @ `5ab3b07`)

SCR-024 (app home — identity, table list, truthful scratch status; metrics and
charts render truthful absence until F04), SCR-025 (records list + sticky
search; typed filter chips and sort arrive F04 per FR-13), SCR-026 (empty +
no-result variants), SCR-027 (record detail; no relationships section for
value-only apps, D25), SCR-028/029 (create/edit with typed inputs), SCR-032
(change history + restore), MOD-009 (delete), MOD-010 (restore), SHT-001 (enum
sheet), SHT-010. MOD-011 and SHT-002/008 remain F03+ (references), SHT-003–009
F03/F04, SHT-016 F03.

### Files (11)

`app-frame.tsx`, `app-home-screen.tsx`, `records-screen.tsx`,
`record-detail-screen.tsx`, `record-form-screen.tsx`, `enum-picker-sheet.tsx`,
`record-actions-sheet.tsx`, `delete-record-dialog.tsx`,
`restore-record-dialog.tsx`, `change-history-screen.tsx`, `records.module.css`.
Two are beyond the plan's Files table (Custom Rule 7):

- `app-frame.tsx` — the app area's shell composition. Every app-area surface
  renders inside one identity + one set of destinations; a screen that built its
  own frame would be free to disagree with the next one.
- `values.ts` — the value/format helpers the screens share: `describeValue`,
  `formatCurrency`, `formatEpochDay`, `epochDayToIsoDate`, `isoDateToEpochDay`,
  `isCanonicalDecimalText`, `monogramFor`, `formatCount`, `describeRecordCount`,
  `isAbsent`, `FieldTypeVm`.

### Exports

`AppHomeScreen`, `RecordsScreen`, `RecordDetailScreen` (+ `mapsHref`,
`describeIssueCounts`), `RecordFormScreen` (+ `AuthoredEntryIntentV1`,
`AuthoredValueIntentV1`, `intentFor`, `initialDraft`), `EnumPickerSheet`,
`RecordActionsSheet`, `DeleteRecordDialog`, `RestoreRecordDialog`,
`ChangeHistoryScreen` (+ `describeEvent`), `AppFrame` (+ `AppIdentity`,
`AppNavigation`, `AppTableLink`, `AppArea`, `AppThemeVm`, `appThemeStyle`).

## Decisions worth carrying forward

- **`AppFrame` is a sibling of M41's `UnlockedFrame`, not a variant.** Inside an
  app the destinations are the app's own (home, its tables, its change history)
  plus "All apps". M39 still exposes exactly one primary navigation per layout
  class, which `accessibility.spec.ts` asserts inside the app area as well as in
  the shell.
- **The app theme lands here.** `AppSessionViewV1.theme` (D29) becomes six
  `--app-*` custom properties on the frame's root, typed as
  `CSSProperties & Record<\`--app-${string}\`, string>` so a system-owned
  property cannot be written from a theme even by mistake.
- **One list, densified — never a second copy of the rows.** `records.html`
  draws phone cards and a desktop table separately; the accessibility contract
  forbids the desktop table creating a second keyboard order, so the same list
  is laid out as cards up to the desktop class and as dense rows above it.
- **A number is a text input with `inputmode="decimal"`, not `type="number"`.**
  CTL-030 requires an *invalid* state and `type="number"` cannot hold one (the
  browser empties the field), and a float would round the value. What was typed
  crosses as `{kind:"number"}` when it is a canonical decimal and as
  `{kind:"text"}` when it is not — the one validator is what refuses it
  (invariant 5, D23). `isCanonicalDecimalText` restates the domain's grammar and
  fails *closed*: stricter means "refused visibly", never "written wrong".
- **The success sentence is a prop the route sets from the receipt**, never from
  a submit — invariant 1 at the surface.
- **The maps handoff href is built here** from `record-edit.html`'s own approved
  `href`, over M37's `{kind:"maps", query}` fact, because choosing a provider is
  a platform decision M37 must not make.

## Known gaps with owners (open at `5ab3b07`)

- **MOD-010 shows what is knowable.** A deleted record answers `null` to
  `getRecord` and F02 has no query for a deleted record's payload, so the dialog
  names the record and when it was deleted and states the re-validation — it
  does not invent "the original values" the atlas asks for. Owner: F03, with the
  deleted-record read.
- **`ChangeHistoryScreen` assumes one table** — a `tableId` on the history entry
  is F03's multi-table work.
- **`AppSessionViewV1` carries no glyph or accent**, so the app home computes its
  monogram the way M23's `glyphForApp` does. If per-app identity grows (F04's
  theme editor), promote it into the view model rather than duplicating the rule
  a third time.
- **`InlineLink`'s `externalHandoff` still throws** (M38 backlog), and paging is
  exercised by unit tests only (50 > 40 rows) — the demo corpus is smaller than
  a page.
- **`top: 68px` is a literal** where M39 has no top-bar height token. Owner: M39.
- Live-region pluralization ("1 values need attention") is M37's, deferred past
  the gate with an owner.

## Change History

- 2026-09-08 — fragment seeded (Forge, F02 planning).
- 2026-09-08 — landed by SESSION-08 (`fe3a8d4`, `db48c4a`, `c46d3cb`, `4c7e1b0`,
  `6362e98`, `5ab3b07`): CAP-15/16/17 surfaces and CAP-13's restart leg verified
  through the real entry; the GATE-F02 demo journey runs at 320px; axe clean.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the SESSION-08 staple folded
  in; the seeded "F02 scope" paragraph rewritten as landed scope; the M54
  section that was stapled into this fragment moved to `M54-routes.md`, where
  CA-07's amendment belongs.
