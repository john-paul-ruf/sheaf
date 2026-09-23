# M40 — UI theme (`src/ui/theme/`)

Extracted from specs/architecture.md §Module Contracts + specs/design.md
§Design Language. Reconciled against the tree at `5ab3b07` (F02 final).

- **Owns:** Shell tokens, base/reset cascade layers, contrast enforcement
  hooks, (later) generated-app token mapping.
- **Exports (landed):** `base.css` (`@layer reset, tokens, base` —
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
- **`tokens.css` is a source of durable data, not only of styling (F02, D29).**
  Two different couplings, and they are not the same shape:
  - M23's `theme.ts` composes `DEFAULT_APP_THEME` as six **colour values copied
    from this file** (`--ink-950`, `--paper-50`, `--white`, `--leaf-700`,
    `--leaf-500`, `--paper-200`), because the theme is written into an
    encrypted app root and must survive without the stylesheet.
    `tests/unit/staging/theme.test.ts` reads `tokens.css` **as text** and never
    imports `src/ui/**`, asserting each stored value still equals the token it
    was taken from — so editing a palette value fails a non-UI test rather than
    silently diverging from every app already promoted. Changing one of those
    six colours is therefore a **durable-data** change, not a restyle.
  - The catalog's five accent ids (`leaf | clay | marigold | river | violet`)
    store the **token id**, never a colour, so a palette change cannot leave an
    entry holding a stale literal.

  Per-app tokens are applied by M44's `AppFrame` as `--app-*` custom
  properties; the safety-semantics must-not still holds over them.

## Change History

- 2026-09-08 — fragment seeded (Forge, F01 planning).
- 2026-09-08 — implemented by SESSION-03 via Enso (`7c9e2f3`). Mock/spec
  divergences resolved toward design.md, none requiring design-fill: radius
  10px over the mocks' 11/12px; disabled as Paper 200 fill + text equivalent
  over `opacity:.5`; weights 450/600/700 over 750/800/850; inline links carry
  colour **and** underline (WCAG 1.4.1) against the mocks' `color:inherit`.
- 2026-09-08 — consumed by SESSION-07 (`9174b6d`, re-run at `2c0248a`); axe
  clean on every F01 surface at all four layout classes after `2c0248a`.
- 2026-09-08 — reconciled by Roshi (F01 final pass): staple merged.
- 2026-09-08 — F02: consumed as the app-theme source by SESSION-04's promotion
  (`82c38fc`) and rendered by SESSION-08's app frame (`5ab3b07`); the file itself
  is unchanged.
- 2026-09-08 — reconciled by Roshi (F02 final pass): the durable-token coupling
  above recorded here, where a future editor of `tokens.css` will read it. F02
  wrote no delta into this fragment.

<!-- formulas-queries-charts SESSION-08 -->
### F04 delta — SESSION-08 (M40 UI theme — `src/ui/theme/{app-theme.ts (new), theme.ts, tokens.css}`)

- `assertPresentationOnly(variables)`: the one guard for shell and app themes; `applyShellTheme` calls it.
- `appThemeVariables(theme, drawn)` gives the six `--app-*` plus the presentation roles remapped onto them (`--color-canvas/surface/text/action/action-text/accent/chrome/chrome-text`; in dark also `--color-text-muted/panel/border/border-input/disabled-fill`). Compact density sets `--space-16: var(--space-12)`. `appThemeTokens`, `useAppRenderMode(theme)` (system follows `prefers-color-scheme` live; a theme with no dark set draws light), `logoSource`.
- `tokens.css`: new roles `--color-chrome` (ink-950), `--color-chrome-text` (white); system-owned `[data-app-mode="dark"] { --focus-ring-color: sprout-300; --focus-ring; color-scheme: dark }`.
