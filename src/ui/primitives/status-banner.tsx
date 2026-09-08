import type { ReactNode } from "react";
import { cx } from "./class-names.js";
import styles from "./status-banner.module.css";

/** CTL-081's four tones. */
export type StatusTone = "info" | "warning" | "danger" | "success";

const GLYPH: Readonly<Record<StatusTone, string>> = {
  info: "i",
  warning: "!",
  danger: "!",
  success: "✓",
};

/**
 * CTL-081 persistent banner.
 *
 * States: information, warning, danger, success; with or without an action.
 * Danger interrupts (`role="alert"`); everything else waits its turn
 * (`role="status"`), because design.md keeps success chrome quiet and reserves
 * urgency for risk.
 */
export interface StatusBannerProps {
  readonly tone: StatusTone;
  readonly title: string;
  /** Supporting facts. design.md §Content Patterns: facts, then remedy. */
  readonly children?: ReactNode;
  /** The remedy. */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function StatusBanner({
  tone,
  title,
  children,
  action,
  className,
}: StatusBannerProps): ReactNode {
  return (
    <div
      className={cx(styles["root"], className)}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span aria-hidden="true" className={cx(styles["icon"])}>
        {GLYPH[tone]}
      </span>
      <div className={cx(styles["body"])}>
        <strong className={cx(styles["title"])}>{title}</strong>
        {children !== undefined && (
          <div className={cx(styles["detail"])}>{children}</div>
        )}
        {action !== undefined && (
          <div className={cx(styles["action"])}>{action}</div>
        )}
      </div>
    </div>
  );
}
