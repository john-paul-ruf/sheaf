import type { ReactNode } from "react";
import { ProgressBar } from "react-aria-components";
import styles from "./busy-indicator.module.css";
import { cx } from "./class-names.js";
import visuallyHidden from "./visually-hidden.module.css";

/**
 * CTL-022 loading action / CTL-088 indeterminate progress.
 *
 * F01's only busy step is the 500–800 ms Argon2id derivation in setup, unlock,
 * recovery and passphrase change. That work cannot be interrupted, so
 * `cancellation` accepts `"unavailable"` and nothing else — a cancel button
 * that does nothing is a lie the type system refuses to let a screen tell.
 * Determinate progress and the cancellable variant arrive with the import
 * feature that actually has them.
 */
export interface BusyIndicatorProps {
  /** What is happening, in words — e.g. "Deriving your key…". Required. */
  readonly label: string;
  readonly cancellation: "unavailable";
  readonly className?: string;
}

export function BusyIndicator({
  label,
  className,
}: BusyIndicatorProps): ReactNode {
  return (
    <div aria-busy="true" className={cx(styles["root"], className)}>
      <ProgressBar aria-label={label} isIndeterminate>
        <span aria-hidden="true" className={cx(styles["spinner"])} />
      </ProgressBar>
      <span className={cx(styles["label"])}>{label}</span>
      <span className={cx(visuallyHidden["root"])} role="status">
        {label}
      </span>
    </div>
  );
}
