# M42 — UI library (`src/ui/library/`)

Extracted from specs/architecture.md §Module Structure (UI modules).
Reconciled against the tree at `5bc19fb` (F04 final; formulas-queries-charts).

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
- 2026-09-23 — F04: the tile's logo/glyph precedence by SESSION-08
  (`42decba`..`7df22fb`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): the SESSION-08 delta
  folded into a new "Per-app identity on the tile" section.


<!-- durable-home-backup SESSION-02 CP4-6 7ee5ce8 -->
## M41 / M42 / M44 / M47 / M54 — mounted durability and security surfaces

`/app/:appId/backup` mounts SCR-038/SCR-039 with real home services, vault creation/reuse, separate labelled recovery cards, secret-confirmed vault-code review, and the existing operation-bound save flow. App home links to this route. Library and readable reset display the same confirmed timestamp and pending count. Reset offers the app backup route and re-enumerates on return. Recovery codes lists authenticated connected homes and links to scoped review. The countdown disables premature UI submission and clears entered codes.

Receive qualification: implementation committed through7ee5ce8. Independent unit2433pass/3skip, typecheck/lint0; J1 download/native and CAP05 countdown passed. Separate sync/bundle browser gate failed during import with integrity refusal before artifact assertions; trace preserved, S02 recovery owns closure. Full session/capability acceptance remains blocked pending this counterexample; reported prior pass is historical.


<!-- durable-home-backup SESSION-03 r3 -->
## M42 / M44 / M46 / M47 — surfaces

M42 library tiles show receipt time, explicit pending count, freshness badge and the mounted backup remedy; safety warning colors use system tokens. M44 `AppIdentity.durability?` and exported `AppBackupStatus({facts, href, compact?})` provide shared detailed/compact receipt status to frame/home and M46 Settings. M47 backup detail uses the same status selector. No cloud connection or successful backup is synthesized.

M47 adds `ScratchReminderDialog`: first/later approved copy, exact pending count, persistent loss warning, heading focus, two 44px actions, Escape dismissal, inert backdrop, phone sheet with 16px inner gutters. Shared React Aria focus containment/restoration remains the mechanism.


Independent receive at47a633b: typecheck/lint exit0;223files/2461unit pass/3inherited skips; exact combined current-build browser gate11pass/0skip/0retry. Original full e2e81pass is Coder-run, source-identical evidence reviewed; focused composed gates independently rerun. S06/S07 future graph/provider proofs remain owned.
