# M40 — UI theme (`src/ui/theme/`)

Extracted from specs/architecture.md §Module Contracts + specs/design.md
§Design Language. F01 scope.

- **Owns:** Shell tokens, base/reset cascade layers, contrast enforcement
  hooks, (later) generated-app token mapping.
- **F01 exports:** `base.css` (`@layer reset, tokens, base` — replaces the
  mocks' Tailwind Preflight), `tokens.css` (full shell palette, spacing,
  radii, shadows, focus ring, type scale, motion + reduced-motion),
  `applyShellTheme`, `ThemeVariables`.
- **Depends on:** nothing (CSS + minimal TS).
- **Must not:** load any CDN/webfont file (system font stacks per design, D7);
  expose safety semantics (`--color-danger` etc.) to per-app override —
  system-owned aliases documented in tokens.css; hex literals outside
  tokens.css.

## Change History
- 2026-09-08 — fragment seeded (Forge, F01 planning). Implementation: SESSION-03.
