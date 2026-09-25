# M42 — UI library (`src/ui/library/`)

Extracted from specs/architecture.md §Module Structure (UI modules).
Reconciled through production `47a633b` (F05 continuation).

- **Owns surfaces (full target):** SCR-010–015, MOD-003, SHT-011.
- **Landed:** SCR-010 (populated library), SCR-011 (empty state), SCR-012
  (library search).
- **Depends on:** M38/M39/M40 + M37's library VM.
- **Must not:** show fictional data; label a disabled action with invented
  copy; derive anything from decrypted data in a locked state; hold a
  state-machine runtime (`tests/unit/ui/architecture.test.ts` — the actors live
  in `src/routes/`).

## Landed exports

- `library-screen.tsx` → `LibraryScreen`, `LibraryTileList`, `LibraryActions`,
  `describeContents`, `describeAppCount`, `UPLOAD_ROUTE`, `navigateToUpload`.
- `library-search-screen.tsx` → `LibrarySearchScreen`, `describeMatches`.
- `empty-library-screen.tsx` → `EmptyLibraryScreen` (SCR-011,
  `library-empty.html`, STA-025). It states no upload destination of its own —
  it imports `navigateToUpload`, so SCR-010/011/012 cannot disagree about where
  the action goes.
- `library.module.css`.

## D5 as it now stands

The F01 rendering — both actions disabled with a stated reason — is
**superseded** for the primary action. `LibraryActionVm` is a union: the enabled
variant carries `intent`, the disabled one carries `reason`, and neither has the
other's field, so a screen narrows on `action.enabled` at a single JSX site. The
disabled branch is byte-for-byte the F01 Button (`disabledReason` +
`isDisabled`); the enabled branch renders a live Button for `choose-workbook`.

- "Uploading a workbook is not available in this release." is no longer rendered
  anywhere: the `import-not-available-in-this-release` token was removed from
  `LibraryActionReason`, so the copy became dead and was deleted. That is the
  point of the flip.
- The global/empty-library "Connect a durable home" remains disabled with its
  stated reason; per-app bundle backup is mounted. F06 Planner owns the
  remaining global connection/adoption entry and unavailable-copy follow-up.
- `onChooseWorkbook` is an optional prop defaulting to `navigateToUpload`,
  following the landed `recovery-code-card.tsx` idiom: a browser affordance
  called directly, injectable for tests, so no route owner has to pass a handler
  for the control to mean something.

## Per-app identity on the tile (F04, SESSION-08)

A tile's mark is, in priority order: the app's logo (decorative, `alt=""`)
when one is set; else the theme's glyph on the theme's primary colour and
label; else the D29 accent monogram it always fell back to before F04. No
tile state or copy changed — only which mark a themed app now draws.

## Recorded deviations

- **Accessibility, tile monogram.** The mocks draw a tile's monogram chip as a
  solid accent with light text. Marigold 500 under `--color-action-text` is
  ~2.9:1, below the contract's 4.5:1, so the chip uses each hue's existing
  *pale* fill with its *ink* foreground (`--marigold-pale`/`--marigold-ink`, and
  the four siblings). Every value already exists in `tokens.css`; the app's
  identity and the product behaviour are unchanged.
- Per-app freshness and **Back up now** are implemented in F05. Remaining
  unavailable surfaces are `library-search.html`'s **Check durable homes**,
  empty-library adoption (F06 Planner), and MOD-003 install education (F08).

## Residual debt (owners named)

- F06 Planner: global connection/adoption entry and inherited unavailable copy.
  Per-app receipt/count/freshness and its bundle remedy are already accepted.
- F08: restore the MOD-003 install-education note when the PWA manifest exists.

## Per-app backup status (F05)

Library tiles display authenticated receipt time, explicit pending count, freshness badge and a working `/app/:appId/backup` remedy. Warning colours use system safety tokens. `selectBackupStatus` supplies the shared local/bundle status vocabulary. Status remains consistent after reopen; it does not fabricate a provider connection. The separate empty-library/global connection and adoption controls remain unavailable and are carried to F06 Planner; their copy is not evidence of a missing per-app bundle writer.

Source and current proof scope: [F05 boundaries](F05-boundaries.md), production `47a633b`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — F01 empty state implemented by SESSION-07 (`9174b6d`, re-run at
  `2c0248a`).
- 2026-09-08 — a cross-lease a11y gap recorded here (M39's icon-only rail had no
  accessible name at 900–1199px) was **closed at `2c0248a`** by
  OWNER-M39-RAIL-LABEL; the finding now lives in `M39-ui-layout.md` as a
  contract.
- 2026-09-08 — reconciled by Roshi (F01 final pass): the stale open-gap note
  removed; staple merged.
- 2026-09-08 — F02: consumer narrowing for the D5 flip by SESSION-06 under lease
  revision r2 (`2c19e4e`); SCR-010 and SCR-012 landed by SESSION-07 (`8a665c1`),
  CAP-14 verified through the real entry incl. reload+unlock persistence.
- 2026-09-08 — reconciled by Roshi (F02 final pass): two session staples folded;
  the head's "F01 subset: empty state only" and the "F02: enable the upload
  action" debt line are both discharged and removed; the interim `#/upload`
  default recorded as the landed `navigateToUpload` it became.
- 2026-09-23 — F04: the tile's logo/glyph precedence by SESSION-08
  (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): the SESSION-08 delta
  folded into a new "Per-app identity on the tile" section.

- 2026-09-25 — Continuation final reconciliation: folded accepted S02/S03 deltas into current contracts; preserved earlier history.
