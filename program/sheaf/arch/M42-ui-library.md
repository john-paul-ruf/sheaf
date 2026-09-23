# M42 — UI library (`src/ui/library/`)

Extracted from specs/architecture.md §Module Structure (UI modules).
Reconciled against the tree at `5ab3b07` (F02 final).

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
- "Connect a durable home" is still disabled with its stated reason (F05/F06).
- `onChooseWorkbook` is an optional prop defaulting to `navigateToUpload`,
  following the landed `recovery-code-card.tsx` idiom: a browser affordance
  called directly, injectable for tests, so no route owner has to pass a handler
  for the control to mean something.

## Recorded deviations

- **Accessibility, tile monogram.** The mocks draw a tile's monogram chip as a
  solid accent with light text. Marigold 500 under `--color-action-text` is
  ~2.9:1, below the contract's 4.5:1, so the chip uses each hue's existing
  *pale* fill with its *ink* foreground (`--marigold-pale`/`--marigold-ink`, and
  the four siblings). Every value already exists in `tokens.css`; the app's
  identity and the product behaviour are unchanged.
- **Absent by decision, not by omission:** `library.html`'s freshness banner and
  its **Back up now** remedy (F02 writes no durable home and counts no
  device-only changes); `library-search.html`'s **Check durable homes**
  (F05/F06); `library-empty.html`'s "Open it by hand" (adopt.html, F05) and its
  "Install is optional" MOD-003 note (PWA is F08).

## Residual debt (owners named)

- F05/F06: enable "Connect a durable home"; restore "Open it by hand"; restore
  the freshness banner once a durable home and a device-only count exist.
- F08: restore the MOD-003 install-education note when the PWA manifest exists.

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

<!-- formulas-queries-charts SESSION-08 -->
### F04 delta — SESSION-08 (M42 library — `src/ui/library/library-screen.tsx`)

- The tile mark is the logo (decorative, alt ""), or the glyph on the theme's primary and label, or the D29 accent.
