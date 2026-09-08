# M42 — UI library (`src/ui/library/`)

Extracted from specs/architecture.md §Module Structure (UI modules). F01 scope.
Reconciled against the tree at `2c0248a`.

- **Owns surfaces (full target):** SCR-010–015, MOD-003, SHT-011.
- **F01 subset (landed):** `EmptyLibraryScreen` — SCR-011 empty state only
  (`library-empty.html`, STA-025) as the post-unlock destination.
- **Depends on:** M38/M39/M40 + M37 library VM.
- **Must not:** show fictional data; label a disabled action with invented
  copy; derive anything from decrypted data in a locked state.

## D5 as rendered

Both actions render **disabled with a stated reason** — "Choose a workbook"
(primary) and "Connect a durable home" (secondary), each followed in text by
"…is not available in this release." — because `ButtonProps` refuses a disabled
state without a text equivalent. The F02/F06 routes are **absent, not stubbed**.

Dropped rather than linked to nothing, each from a recorded decision and none
invented: `library-empty.html`'s "Open it by hand" (adopt.html, F05) and its
"Install is optional" MOD-003 note (PWA is F08).

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-07 (`9174b6d`, re-run at `2c0248a`),
  empty state only.
- 2026-09-08 — SESSION-07 recorded a cross-lease a11y gap here (M39's icon-only
  rail had no accessible name at 900–1199px). **Closed at `2c0248a`** by
  OWNER-M39-RAIL-LABEL; the finding now lives in `M39-ui-layout.md` as a
  contract, and the `test.fail()` block that recorded it has been deleted.
- 2026-09-08 — reconciled by Roshi (final pass): the stale open-gap note
  removed (it described a defect fixed two commits before this pass);
  session-delta staple merged.

## Residual F01 debt (owners named, not gaps in this fragment)

- F02: enable the upload action and its route.
- F05/F06: enable "Connect a durable home"; restore "Open it by hand".
- F08: restore the MOD-003 install-education note when the PWA manifest exists.
