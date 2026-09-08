import type { ReactNode } from "react";
import { cx } from "../primitives/class-names.js";
import styles from "./auth-shell.module.css";

const CONTENT_ID = "content";

/**
 * M39 — the pre-unlock frame for SCR-001–004 and SCR-008.
 *
 * A centred single column, safe-area padded, with the wordmark in a slot so
 * the shell never hardcodes brand markup. It carries no navigation: nothing
 * beyond these screens is reachable while the store is locked.
 */
export interface AuthShellProps {
  /** The Sheaf wordmark (CTL-002). */
  readonly wordmark: ReactNode;
  /** Header status beside the wordmark, e.g. "No network needed". */
  readonly headerAside?: ReactNode;
  readonly children: ReactNode;
  readonly skipLinkLabel?: string;
}

export function AuthShell({
  wordmark,
  headerAside,
  children,
  skipLinkLabel = "Skip to content",
}: AuthShellProps): ReactNode {
  return (
    <div className={cx(styles["root"])}>
      <a className={cx(styles["skipLink"])} href={`#${CONTENT_ID}`}>
        {skipLinkLabel}
      </a>
      <header className={cx(styles["header"])}>
        <span className={cx(styles["wordmark"])}>{wordmark}</span>
        {headerAside}
      </header>
      <main className={cx(styles["main"])} id={CONTENT_ID}>
        <div className={cx(styles["column"])}>{children}</div>
      </main>
    </div>
  );
}
