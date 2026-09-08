import type { ReactNode } from "react";
import { cx } from "./class-names.js";
import styles from "./error-state.module.css";

/**
 * CTL-087 error state — **recoverable variant only**.
 *
 * This is CAP-08's surface: architecture §Supported Runtime Baseline requires
 * that "before local setup, SCR-001 renders the approved recoverable-error
 * control state and names the missing browser capability". The caller passes
 * that name as `cause`; this control never guesses it.
 *
 * CTL-087's other required variants — blocked input, provider, storage,
 * unknown local — belong to later features and are deliberately absent. The
 * `variant` prop is a one-member union so adding them is a widening, not a
 * rewrite of every call site.
 */
export interface ErrorStateProps {
  readonly variant: "recoverable";
  readonly heading: string;
  /** The named cause, e.g. the missing capability. Always stated in text. */
  readonly cause: string;
  /** Retry or primary-action slot. */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function ErrorState({
  heading,
  cause,
  action,
  className,
}: ErrorStateProps): ReactNode {
  return (
    <div
      className={cx(styles["root"], className)}
      data-variant="recoverable"
      role="alert"
    >
      <span aria-hidden="true" className={cx(styles["icon"])}>
        !
      </span>
      <div className={cx(styles["body"])}>
        <h2 className={cx(styles["heading"])}>{heading}</h2>
        <p className={cx(styles["cause"])}>{cause}</p>
        {action !== undefined && (
          <div className={cx(styles["action"])}>{action}</div>
        )}
      </div>
    </div>
  );
}
