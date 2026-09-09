import type { CSSProperties, ReactNode } from "react";
import type { AppHomeVm } from "../../application/view-models/records.js";
import { AppShell, type ShellDestination } from "../layout/app-shell.js";
import { cx } from "../primitives/class-names.js";
import visuallyHidden from "../primitives/visually-hidden.module.css";

/**
 * The frame every generated-app surface sits in (M44 over M39).
 *
 * It is a sibling of M41's `UnlockedFrame`, not a variant of it: the shell
 * destinations inside an app are the app's own (home, its tables, its change
 * history) plus the way back out, and design.md § Shell and generated-app
 * boundary is explicit that the two levels are different places. Exactly one
 * navigation is exposed at any width — M39's rail and bottom bar are the same
 * destinations, and only one of them is displayed — so the app area adds no
 * second primary nav to any layout class.
 *
 * **The hrefs arrive as data.** A screen states where it goes; `src/routes/`
 * decides what that spells (the M41 rule, restated).
 *
 * **The app's theme is applied here, from the app's own fact.** Promotion
 * writes `AppThemeV1` into the durable app state (D29), it crosses as
 * `AppSessionViewV1.theme`, and this is where it becomes six custom
 * properties. The six are presentation-only: the system-owned semantics —
 * danger, warning, success, the focus ring, the hit-target floor — are not
 * among them and cannot be reached from here (M40's `SYSTEM_OWNED_PROPERTIES`).
 */

/** The theme as the view model carries it — the wire shape, by alias. */
export type AppThemeVm = AppHomeVm["theme"];

export interface AppTableLink {
  readonly tableId: string;
  readonly displayName: string;
  readonly href: string;
}

/** Where an app-area surface can go. */
export interface AppNavigation {
  /** Back out to the shell's library (design.md: "All apps"). */
  readonly library: string;
  readonly appHome: string;
  readonly appHistory: string;
  readonly tables: readonly AppTableLink[];
}

/** Which destination the current surface belongs to. */
export type AppArea = "home" | "records" | "history";

/**
 * Who the app is. Every app-area surface renders inside one identity, and
 * carrying it as one value keeps a screen from being handed a name and someone
 * else's theme.
 */
export interface AppIdentity {
  readonly appId: string;
  readonly displayName: string;
  readonly theme: AppThemeVm;
}

export interface AppFrameProps {
  readonly nav: AppNavigation;
  readonly area: AppArea;
  /** Which table is current, when the area is `records`. */
  readonly currentTableId?: string;
  readonly app: AppIdentity;
  readonly title: string;
  /** M37's announcement for the state now showing. */
  readonly announcement?: string;
  readonly topBarActions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * `--app-*` only. React's `CSSProperties` does not admit custom properties on
 * its own, and the intersection says exactly which ones this file may set —
 * so a system-owned property cannot be written here even by mistake.
 */
type AppThemeStyle = CSSProperties & Record<`--app-${string}`, string>;

export function appThemeStyle(theme: AppThemeVm): AppThemeStyle {
  return {
    "--app-ink": theme.tokens["app-ink"],
    "--app-canvas": theme.tokens["app-canvas"],
    "--app-surface": theme.tokens["app-surface"],
    "--app-primary": theme.tokens["app-primary"],
    "--app-accent": theme.tokens["app-accent"],
    "--app-muted": theme.tokens["app-muted"],
  };
}

export function AppFrame({
  nav,
  area,
  currentTableId,
  app,
  title,
  announcement,
  topBarActions,
  children,
}: AppFrameProps): ReactNode {
  const destinations: readonly ShellDestination[] = [
    {
      id: "app-home",
      label: "App home",
      href: nav.appHome,
      glyph: "⌂",
      ...(area === "home" ? { isCurrent: true } : {}),
    },
    ...nav.tables.map((table) => ({
      id: `table-${table.tableId}`,
      label: table.displayName,
      href: table.href,
      glyph: "≡",
      ...(area === "records" && currentTableId === table.tableId
        ? { isCurrent: true }
        : {}),
    })),
    {
      id: "app-history",
      label: "Change history",
      href: nav.appHistory,
      glyph: "↺",
      ...(area === "history" ? { isCurrent: true } : {}),
    },
    { id: "library", label: "All apps", href: nav.library, glyph: "⌘" },
  ];

  return (
    <div style={appThemeStyle(app.theme)}>
      <AppShell
        destinations={destinations}
        title={title}
        wordmark={app.displayName}
        {...(topBarActions === undefined ? {} : { topBarActions })}
      >
        {announcement !== undefined && (
          <span className={cx(visuallyHidden["root"])} role="status">
            {announcement}
          </span>
        )}
        {children}
      </AppShell>
    </div>
  );
}
