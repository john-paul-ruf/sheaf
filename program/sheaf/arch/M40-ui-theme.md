# M40 — UI theme (`src/ui/theme/`)

Extracted from specs/architecture.md §Module Contracts + specs/design.md
§Design Language. F01 scope. Reconciled against the tree at `2c0248a`.

- **Owns:** Shell tokens, base/reset cascade layers, contrast enforcement
  hooks, (later) generated-app token mapping.
- **F01 exports (landed):** `base.css` (`@layer reset, tokens, base` —
  replaces the mocks' Tailwind Preflight), `tokens.css` (full shell palette,
  spacing, radii, shadows, focus ring, type scale, motion + reduced-motion),
  `applyShellTheme(root, options?)`, `ThemeVariables`, plus three additions the
  contract needed: `SYSTEM_OWNED_PROPERTIES`, `SHELL_COLOR_SCHEMES`,
  `ShellColorScheme`.
- **Depends on:** nothing (CSS + minimal TS).
- **Must not:** load any CDN/webfont file (system font stacks per design, D7);
  expose safety semantics (`--color-danger` etc.) to per-app override; hex
  literals outside `tokens.css`.

## Contracts worth recording

- **The safety-semantics must-not is enforced at runtime, not documented.**
  `applyShellTheme` **throws** when `options.variables` names a system-owned
  property. `SYSTEM_OWNED_PROPERTIES` is the machine-readable list
  (danger/warning/info/success + their tint and ink variants, the four
  focus-ring properties, `--target-min`), and `tests/unit/ui/tokens.test.ts`
  asserts every member exists in `tokens.css`.
- **Layer contract (binds every later UI session).** `base.css` declares
  `@layer reset, tokens, base` and `@import`s `tokens.css`. Component
  `*.module.css` files are **unlayered on purpose**, so they win over `base` by
  layer order rather than by specificity or `!important`.
  `tests/unit/ui/architecture.test.ts` fails if a `*.module.css` grows an
  `@layer`.
- **Focus ring resolved as Leaf 700 on paper, Sprout 300 on ink**
  (`--focus-ring-color`, `--focus-ring-color-on-ink`). design.md says
  "Leaf/Sprout"; Sprout on Paper 50 is ~1.2:1 and would be invisible.
- `--target-min: 44px` and the `--z-*` scale are new tokens: the hit-target
  floor and every stacking value now have exactly one home.
- `base.css` is imported **exactly once in the program**, by `src/main.tsx`.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-03 via Enso (`7c9e2f3`). Mock/spec
  divergences resolved toward design.md, none requiring design-fill: radius
  10px over the mocks' 11/12px; disabled as Paper 200 fill + text equivalent
  over `opacity:.5`; weights 450/600/700 over 750/800/850; inline links carry
  colour **and** underline (WCAG 1.4.1) against the mocks' `color:inherit`.
- 2026-09-08 — consumed by SESSION-07 (`9174b6d`, re-run at `2c0248a`); axe
  clean on every F01 surface at all four layout classes after `2c0248a`.
- 2026-09-08 — reconciled by Roshi (final pass): session-delta staple merged.
