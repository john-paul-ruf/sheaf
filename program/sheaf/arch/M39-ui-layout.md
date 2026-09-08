# M39 — UI layout (`src/ui/layout/`)

Extracted from specs/architecture.md §Module Contracts + specs/design.md
§Layout Classes. F01 scope.

- **Owns:** Responsive composition, safe areas, sticky regions, focus order.
- **F01 exports:** `auth-shell` (centered pre-unlock column, 16px compact
  gutter, wordmark slot), `app-shell` (compact bottom bar / ≥900px rail;
  library + settings destinations only).
- **Depends on:** M38, M40 tokens.
- **Must not:** let sticky regions cover focused inputs; diverge DOM order
  from visual order across layout classes; change capability by breakpoint
  (density changes, capability does not).

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-03.

<!-- foundation-first-unlock SESSION-03 -->
- 2026-09-08 — SESSION-03 landed (final revision `7c9e2f3`). Delta:

### M39 — UI layout (`src/ui/layout/`)

Landed. Delta against the seeded fragment:

- **Exports:** `AuthShell`, `AppShell`, and the new `ShellDestination` type
  (`id`, `label`, `href`, `glyph`, `isCurrent?`) that `AppShell` consumes.
- `AppShell` renders the rail and the bottom bar from **one** destination
  list, so both carry the same links in the same order; exactly one is
  displayed at any width. This is how the must-not "diverge DOM order from
  visual order across layout classes" and "change capability by breakpoint"
  are held.
- Both shells own their skip link and the single `main` landmark.
- Breakpoints live in the shells' own module CSS at 600/900/1200px, matching
  design.md §Layout Classes.
