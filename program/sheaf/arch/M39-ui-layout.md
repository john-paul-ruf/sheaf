# M39 — UI layout (`src/ui/layout/`)

Extracted from specs/architecture.md §Module Contracts + specs/design.md
§Layout Classes. F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Responsive composition, safe areas, sticky regions, focus order.
- **F01 exports (landed):** `AuthShell` (centered pre-unlock column, 16px
  compact gutter, wordmark slot), `AppShell` (compact bottom bar / ≥900px rail;
  library + settings destinations only), and the `ShellDestination` type
  (`id`, `label`, `href`, `glyph`, `isCurrent?`) that `AppShell` consumes.
- **Depends on:** M38, M40 tokens.
- **Must not:** let sticky regions cover focused inputs; diverge DOM order
  from visual order across layout classes; change capability by breakpoint
  (density changes, capability does not); **change a destination's accessible
  name by breakpoint** — see the rail contract below.

## Shell contracts

- `AppShell` renders the rail and the bottom bar from **one** destination
  list, so both carry the same links in the same order; exactly one is
  displayed at any width. This is how "diverge DOM order from visual order"
  and "change capability by breakpoint" are held.
- **The rail's accessible name is width-independent.** Between 900px and
  1199px the rail is icon-only and `.railLabel` is `display: none`, which
  removes the label from the accessibility tree as well as the page. Each rail
  anchor therefore carries `aria-label={destination.label}` so its accessible
  name is identical at every width (axe `link-name`, WCAG 2.0 A). The visible
  `.railLabel` span remains for ≥1200px.
- Both shells own their skip link and the single `main` landmark.
- Breakpoints live in the shells' own module CSS at 600/900/1200px, matching
  design.md §Layout Classes.
- `AppShell` reserves 96px + safe-area at the bottom on compact; keep that
  assertion alive as real screens land.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-03 via Enso (`7c9e2f3`). jsdom cannot
  evaluate media queries, so the four layout classes were declared and
  structurally asserted only.
- 2026-09-08 — **a11y defect found by SESSION-07 and corrected in this lease.**
  At 900–1199px every rail link had no accessible name; SESSION-07 could not
  fix it (`src/ui/layout/**` is SESSION-03's M39 lease) and recorded it as a
  self-correcting `test.fail()` in `tests/e2e/accessibility.spec.ts`. Closed by
  the owner-correction worker OWNER-M39-RAIL-LABEL at **`2c0248a`**:
  `aria-label` added to the rail anchor in `app-shell.tsx`, the `test.fail()`
  block deleted, and a unit assertion added in `tests/unit/ui/shells.test.tsx`.
  axe is now clean at all four declared layout classes.
- 2026-09-08 — reconciled by Roshi (final pass): rail accessible-name contract
  promoted into the must-not list and the correction recorded here (M42 had
  been carrying the finding as an open cross-lease gap); session-delta staple
  merged.
