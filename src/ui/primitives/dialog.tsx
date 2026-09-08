import type { ReactNode } from "react";
import {
  Dialog as AriaDialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { cx } from "./class-names.js";
import styles from "./dialog.module.css";

/**
 * `destructive` renders CTL-110's alert dialog: it announces assertively and
 * can never be dismissed by clicking away, because losing a confirmation by
 * accident is how data disappears.
 */
export type DialogKind = "standard" | "destructive";

/**
 * CTL-109 modal container / CTL-110 alert-dialog container.
 *
 * design.md §Accessibility Contract: dialogs "trap focus, restore it to the
 * invoking control, close with Escape where cancellation is safe, and do not
 * close on outside click during destructive confirmation". React Aria owns the
 * trap and the restore; the two dismissal rules are wired here.
 */
export interface DialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
  /** Confirmation and cancellation controls. */
  readonly footer?: ReactNode;
  readonly kind?: DialogKind;
  /**
   * Whether cancelling is safe. `false` makes the dialog non-dismissible:
   * Escape does nothing and the only way out is an explicit choice.
   */
  readonly isDismissable?: boolean;
}

export function Dialog({
  isOpen,
  onOpenChange,
  title,
  children,
  footer,
  kind = "standard",
  isDismissable = true,
}: DialogProps): ReactNode {
  const closesOnOutsideClick = isDismissable && kind !== "destructive";

  return (
    <ModalOverlay
      className={cx(styles["overlay"])}
      isDismissable={closesOnOutsideClick}
      isKeyboardDismissDisabled={!isDismissable}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <Modal className={cx(styles["modal"])}>
        <AriaDialog
          className={cx(styles["dialog"])}
          data-kind={kind}
          role={kind === "destructive" ? "alertdialog" : "dialog"}
        >
          <Heading className={cx(styles["title"])} slot="title">
            {title}
          </Heading>
          <div className={cx(styles["content"])}>{children}</div>
          {footer !== undefined && (
            <div className={cx(styles["footer"])}>{footer}</div>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
