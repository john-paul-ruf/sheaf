import { useId, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import styles from "./button.module.css";
import { cx } from "./class-names.js";

/**
 * CTL-014 (primary), CTL-016 (secondary), CTL-018 (danger).
 *
 * F01 builds default / hover / pressed / focus / disabled. The busy state
 * these atlas rows also name is CTL-022's `<BusyIndicator>`, which composes
 * with this button rather than duplicating its geometry.
 */
export type ButtonTone = "primary" | "secondary" | "destructive";

interface ButtonBaseProps {
  readonly children: ReactNode;
  /** Defaults to `"secondary"`: promoting an action is always deliberate. */
  readonly tone?: ButtonTone;
  readonly onPress?: () => void;
  readonly type?: "button" | "submit";
  /** Compact-phone full-width action (CTL-021 single). */
  readonly isFullWidth?: boolean;
  readonly autoFocus?: boolean;
  readonly className?: string;
}

/**
 * A disabled action must say why in text.
 *
 * M38 must-not: "ship a control state without a text equivalent". Encoding it
 * in the type means a screen cannot render a dead-looking control by accident
 * — the compiler asks for the copy.
 */
export type ButtonProps = ButtonBaseProps &
  (
    | { readonly isDisabled?: false; readonly disabledReason?: never }
    | { readonly isDisabled: true; readonly disabledReason: string }
  );

export function Button({
  children,
  tone = "secondary",
  onPress,
  type = "button",
  isFullWidth = false,
  autoFocus = false,
  className,
  isDisabled = false,
  disabledReason,
}: ButtonProps): ReactNode {
  const reasonId = useId();
  const classes = cx(
    styles["root"],
    styles[tone],
    isFullWidth && styles["fullWidth"],
    className,
  );

  const button = (
    <AriaButton
      className={classes}
      type={type}
      isDisabled={isDisabled}
      autoFocus={autoFocus}
      {...(onPress === undefined ? {} : { onPress })}
      {...(isDisabled ? { "aria-describedby": reasonId } : {})}
    >
      {children}
    </AriaButton>
  );

  if (!isDisabled) return button;

  return (
    <span className={cx(styles["wrapper"])}>
      {button}
      <span className={cx(styles["reason"])} id={reasonId}>
        {disabledReason}
      </span>
    </span>
  );
}
