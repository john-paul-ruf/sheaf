# M40 — UI theme (`src/ui/theme/`)

Extracted from specs/architecture.md §Module Contracts + specs/design.md
§Design Language. Reconciled against the tree at `5bc19fb` (F04 final;
formulas-queries-charts).

- **Owns:** Shell tokens, base/reset cascade layers, contrast enforcement
  hooks, generated-app token mapping (F04).
- **Exports (landed):** `base.css` (`@layer reset, tokens, base` —
  replaces the mocks' Tailwind Preflight), `tokens.css` (full shell palette,
  spacing, radii, shadows, focus ring, type scale, motion + reduced-motion),
  `applyShellTheme(root, options?)`, `ThemeVariables`, `SYSTEM_OWNED_PROPERTIES`,
  `SHELL_COLOR_SCHEMES`, `ShellColorScheme`, and (F04, new file
  `app-theme.ts`) `assertPresentationOnly`, `appThemeVariables`,
  `appThemeTokens`, `useAppRenderMode`, `logoSource`.
- **Depends on:** nothing (CSS + minimal TS).
- **Must not:** load any CDN/webfont file (system font stacks per design, D7);
  expose safety semantics (`--color-danger` etc.) to per-app override; hex
  literals outside `tokens.css`.

## Contracts worth recording

- **The safety-semantics must-not is enforced at runtime, not documented.**
  `assertPresentationOnly(variables)` is the **one** guard for both the shell
  theme and every app theme (F04 unified what was previously
  `applyShellTheme`'s own inline check); it **throws** when `options.variables`
  names a system-owned property. `SYSTEM_OWNED_PROPERTIES` is the
  machine-readable list (danger/warning/info/success + their tint and ink
  variants, the four focus-ring properties, `--target-min`, and — F04 —
  `--color-danger-text`/`-warning-text`/`-info-text`/`-success-text`), and
  `tests/unit/ui/tokens.test.ts` asserts every member exists in `tokens.css`.
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
    six colours is therefore a **durable-data** change, not a restyle. **F04's
    eight DF-1 built-in palettes** are pinned the same way, from M23's
    `BUILT_IN_PALETTES`.
  - The catalog's five accent ids (`leaf | clay | marigold | river | violet`)
    store the **token id**, never a colour, so a palette change cannot leave an
    entry holding a stale literal.

  Per-app tokens are applied by M44's `AppFrame` as `--app-*` custom
  properties; the safety-semantics must-not still holds over them.

## `app-theme.ts` (new, F04, SESSION-08)

`appThemeVariables(theme, drawn)` gives the six `--app-*` tokens plus the
presentation roles remapped onto them (`--color-canvas/surface/text/action/
action-text/accent/chrome/chrome-text`; in dark also `--color-text-muted/
panel/border/border-input/disabled-fill`). Compact density sets `--space-16:
var(--space-12)`. `useAppRenderMode(theme)` follows `prefers-color-scheme`
live when the theme's mode is `system`; a theme with no dark set always draws
light. `logoSource` resolves the app's PNG logo (or `null` for the initials
fallback).

`tokens.css` gains the `--color-chrome` (ink-950) / `--color-chrome-text`
(white) roles, and the system-owned dark-mode rule
`[data-app-mode="dark"] { --focus-ring-color: sprout-300; --focus-ring;
color-scheme: dark }`.

## Dark-mode system semantics (OWNER-THEME-DARK-SEMANTICS, F04)

**New system-owned role set: semantic text on the app background.**
`--color-danger-text`, `--color-warning-text`, `--color-info-text`,
`--color-success-text`. In `:root` each equals its `--color-*-ink`, so light
mode renders exactly as before. Under `[data-app-mode="dark"]` the system
swaps them to the dark-mode text inks from design.md § Built-in app palettes
→ System semantics in dark mode: Clay 300, Marigold 500, River 300, Leaf 300.
One value per role, for every app and palette. Consumers: text drawn directly
on `app-canvas`/`app-surface` (records `.issue`, `.metricNote` error states,
charts `.failure`, schema `.failure`).

**Badge/tint inks unchanged.** `--color-*-ink` and `--color-*-tint` are not
redeclared in dark mode. A pale tint with a `*-ink` stays a self-contained
chip.

**New palette steps:** `--clay-300: #e08a6e`, `--river-300: #6aa3c8`,
`--leaf-300: #62b397`.

**Rule for new code:** semantic text on an app background reads
`--color-*-text`. Text on a semantic tint reads `--color-*-ink`.

**Named gap, carried to the reviewer (REVIEW-DARK-NONTEXT).** Two non-text
contrast failures in dark apps have **no** design.md dark value and none was
invented: the destructive button's text on danger fill (≈3.3:1,
`button.module.css:46`), and semantic borders (danger/info/success = Clay
600/River 600/Leaf 700) under 3:1 on dark app backgrounds
(`records.module.css:502`, `text-field.module.css:39`,
`select-field.module.css:37`, `status-banner.module.css:48/66/75`,
`error-state.module.css:7`). GATE-F04 reviewer → design fill.

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
- 2026-09-23 — F04: `app-theme.ts`, the chrome roles and the dark-mode focus
  ring by SESSION-08 (`42decba`..`7df22fb`); the four semantic-text-on-app-
  background roles, the three new palette steps and the guard by
  OWNER-THEME-DARK-SEMANTICS (`beb094a`, `c92f393`).
- 2026-09-23 — reconciled by Archivist (F04 final pass): two deltas folded
  into "Contracts worth recording" and two new sections (`app-theme.ts`,
  "Dark-mode system semantics"); the durable-token pinning note extended to
  cover F04's eight DF-1 palettes; the REVIEW-DARK-NONTEXT gap recorded here
  (previously only in STATE.md and the Final Report) so the module's own
  fragment states its own open reviewer question.
