import type { ReactNode } from "react";
import { Checkbox as AriaCheckbox } from "react-aria-components";
import { cx } from "./class-names.js";
import styles from "./checkbox.module.css";

/**
 * CTL-043 checkbox (control-atlas.html#ctl-043): unchecked, checked, focus,
 * disabled. The whole row is the hit target, so a label that wraps at 320px
 * still meets the 44px floor; the box itself is only the visible mark.
 *
 * A disabled checkbox must say why in text, exactly as `Button` does — the
 * atlas's "Reason remains readable" — so the type asks for the copy.
 */
export type CheckboxProps = {
  readonly isSelected: boolean;
  readonly onChange: (isSelected: boolean) => void;
  /** The accessible name and the visible label: never a placeholder. */
  readonly children: ReactNode;
  readonly className?: string;
} & (
  | { readonly isDisabled?: false; readonly disabledReason?: never }
  | { readonly isDisabled: true; readonly disabledReason: string }
);

export function Checkbox({
  isSelected,
  onChange,
  children,
  className,
  isDisabled = false,
  disabledReason,
}: CheckboxProps): ReactNode {
  return (
    <AriaCheckbox
      className={cx(styles["root"], className)}
      isDisabled={isDisabled}
      isSelected={isSelected}
      onChange={onChange}
    >
      <span aria-hidden="true" className={cx(styles["box"])}>
        {isSelected ? "✓" : ""}
      </span>
      <span className={cx(styles["label"])}>
        {children}
        {isDisabled && <span className={cx(styles["reason"])}>{disabledReason}</span>}
      </span>
    </AriaCheckbox>
  );
}
