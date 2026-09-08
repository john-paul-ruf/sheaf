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

<!-- foundation-first-unlock SESSION-03 -->
- 2026-09-08 — SESSION-03 landed (final revision `7c9e2f3`). Delta:

### M40 — UI theme (`src/ui/theme/`)

Landed. Delta against the seeded fragment:

- **Exports:** `base.css`, `tokens.css`, `applyShellTheme(root, options?)`,
  `ThemeVariables`, plus three additions the contract needed:
  `SYSTEM_OWNED_PROPERTIES`, `SHELL_COLOR_SCHEMES`, `ShellColorScheme`.
- `applyShellTheme` **throws** when `options.variables` names a system-owned
  property. The must-not "expose safety semantics to per-app override" is now
  enforced at runtime, not only documented. `SYSTEM_OWNED_PROPERTIES` is the
  machine-readable list (danger/warning/info/success + their tint and ink
  variants, the four focus-ring properties, `--target-min`) and
  `tests/unit/ui/tokens.test.ts` asserts every member exists in `tokens.css`.
- **Layer contract (new, binds every later UI session):** `base.css` declares
  `@layer reset, tokens, base` and `@import`s `tokens.css`. Component
  `*.module.css` files are **unlayered on purpose**, so they win over `base`
  by layer order rather than by specificity or `!important`.
  `tests/unit/ui/architecture.test.ts` fails if a `*.module.css` grows an
  `@layer`.
- Focus ring resolved as **Leaf 700 on paper, Sprout 300 on ink**
  (`--focus-ring-color`, `--focus-ring-color-on-ink`). design.md says
  "Leaf/Sprout"; Sprout on Paper 50 is ~1.2:1 and would be invisible.
- `--target-min: 44px` and the `--z-*` scale are new tokens: the hit-target
  floor and every stacking value now have exactly one home.
