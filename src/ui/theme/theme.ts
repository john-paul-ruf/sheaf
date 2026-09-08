/**
 * M40 — shell theme application.
 *
 * `./tokens.css` declares the shell's custom properties statically; this
 * module is the runtime seam that mounts them on a root element and enforces
 * the one rule an app theme may not break.
 */

/**
 * Colour schemes the shell can render. Light is the only approved scheme in
 * F01; the type exists so adding a dark scheme is a value change, not a
 * refactor of every consumer.
 */
export const SHELL_COLOR_SCHEMES = ["light"] as const;

/** A colour scheme the shell knows how to render. */
export type ShellColorScheme = (typeof SHELL_COLOR_SCHEMES)[number];

/**
 * Custom properties a caller may set on a shell root, e.g. the per-app theming
 * contract in design.md §Per-app theming contract.
 *
 * Members of {@link SYSTEM_OWNED_PROPERTIES} are not assignable through this
 * type at runtime — see {@link applyShellTheme}.
 */
export type ThemeVariables = Readonly<Record<`--${string}`, string>>;

/**
 * Safety semantics and the accessibility floor. Architecture §UI primitives,
 * layout, and theme: "Safety semantics cannot be recolored or renamed by an
 * app theme." Kept in sync with the §System-owned semantics block of
 * `./tokens.css`, which `tests/unit/ui/tokens.test.ts` asserts.
 */
export const SYSTEM_OWNED_PROPERTIES: readonly `--${string}`[] = Object.freeze([
  "--color-danger",
  "--color-warning",
  "--color-info",
  "--color-success",
  "--color-danger-tint",
  "--color-warning-tint",
  "--color-info-tint",
  "--color-success-tint",
  "--color-danger-ink",
  "--color-warning-ink",
  "--color-info-ink",
  "--color-success-ink",
  "--focus-ring",
  "--focus-ring-width",
  "--focus-ring-offset",
  "--focus-ring-color",
  "--focus-ring-color-on-ink",
  "--target-min",
] as const);

const SYSTEM_OWNED = new Set<string>(SYSTEM_OWNED_PROPERTIES);

/** Options for {@link applyShellTheme}. */
export interface ShellThemeOptions {
  /** Defaults to `"light"`, the only scheme approved for F01. */
  readonly colorScheme?: ShellColorScheme;
  /** Presentation-only overrides. System-owned properties are rejected. */
  readonly variables?: ThemeVariables;
}

/**
 * Mounts the shell theme on `root` — normally `document.documentElement`.
 *
 * Throws if `variables` names a system-owned property: a theme that could dim
 * the danger colour or the focus ring is a safety regression, so this fails
 * closed rather than silently dropping the assignment.
 */
export function applyShellTheme(
  root: HTMLElement,
  options: ShellThemeOptions = {},
): void {
  const { colorScheme = "light", variables } = options;

  const forbidden = Object.keys(variables ?? {}).filter((name) =>
    SYSTEM_OWNED.has(name),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Shell theme cannot override system-owned properties: ${forbidden.join(", ")}. ` +
        "Safety semantics and the focus ring are fixed by the Sheaf shell.",
    );
  }

  root.style.colorScheme = colorScheme;
  root.dataset["sheafColorScheme"] = colorScheme;

  for (const [name, value] of Object.entries(variables ?? {})) {
    root.style.setProperty(name, value);
  }
}
