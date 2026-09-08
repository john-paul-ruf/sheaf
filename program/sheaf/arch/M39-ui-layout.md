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
