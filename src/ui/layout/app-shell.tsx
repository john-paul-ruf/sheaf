import type { ReactNode } from "react";
import { cx } from "../primitives/class-names.js";
import styles from "./app-shell.module.css";

const CONTENT_ID = "content";

/** One shell destination. F01 ships two: the library and security settings. */
export interface ShellDestination {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Decorative glyph; the label always carries the meaning. */
  readonly glyph: string;
  readonly isCurrent?: boolean;
}

/**
 * M39 — the post-unlock frame for SCR-005 and SCR-010.
 *
 * The rail (≥900px) and the bottom bar (<900px) render the same destinations
 * in the same order, so the keyboard path does not change with width and no
 * destination is reachable at one class only.
 */
export interface AppShellProps {
  readonly destinations: readonly ShellDestination[];
  /** The Sheaf wordmark (CTL-002). */
  readonly wordmark: ReactNode;
  /** Screen title, shown beside the rail once there is room for it. */
  readonly title?: string;
  readonly topBarActions?: ReactNode;
  readonly children: ReactNode;
  readonly skipLinkLabel?: string;
  readonly primaryNavLabel?: string;
}

export function AppShell({
  destinations,
  wordmark,
  title,
  topBarActions,
  children,
  skipLinkLabel = "Skip to content",
  primaryNavLabel = "Primary",
}: AppShellProps): ReactNode {
  return (
    <div className={cx(styles["root"])}>
      <a className={cx(styles["skipLink"])} href={`#${CONTENT_ID}`}>
        {skipLinkLabel}
      </a>

      <aside className={cx(styles["rail"])}>
        <span className={cx(styles["railBrand"])}>{wordmark}</span>
        <nav aria-label={primaryNavLabel} className={cx(styles["railNav"])}>
          {destinations.map((destination) => (
            <a
              className={cx(styles["railLink"])}
              href={destination.href}
              key={destination.id}
              {...(destination.isCurrent === true
                ? { "aria-current": "page" as const }
                : {})}
            >
              <span aria-hidden="true" className={cx(styles["glyph"])}>
                {destination.glyph}
              </span>
              <span className={cx(styles["railLabel"])}>
                {destination.label}
              </span>
            </a>
          ))}
        </nav>
      </aside>

      <div className={cx(styles["main"])}>
        <header className={cx(styles["topBar"])}>
          <span className={cx(styles["wordmark"])}>{wordmark}</span>
          {title !== undefined && (
            <strong className={cx(styles["title"])}>{title}</strong>
          )}
          <div className={cx(styles["topBarActions"])}>{topBarActions}</div>
        </header>
        <main className={cx(styles["page"])} id={CONTENT_ID}>
          {children}
        </main>
      </div>

      <nav
        aria-label={primaryNavLabel}
        className={cx(styles["bottomBar"])}
      >
        {destinations.map((destination) => (
          <a
            className={cx(styles["bottomLink"])}
            href={destination.href}
            key={destination.id}
            {...(destination.isCurrent === true
              ? { "aria-current": "page" as const }
              : {})}
          >
            <span aria-hidden="true" className={cx(styles["glyph"])}>
              {destination.glyph}
            </span>
            <span>{destination.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
