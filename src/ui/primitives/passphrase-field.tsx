import { useState, type ReactNode } from "react";
import { ToggleButton } from "react-aria-components";
import { cx } from "./class-names.js";
import styles from "./passphrase-field.module.css";
import { TextField } from "./text-field.js";
import visuallyHidden from "./visually-hidden.module.css";

/**
 * CTL-026 passphrase input + CTL-027 show/hide secret control.
 *
 * States: empty, revealed, hidden, invalid, delayed. `delayedMessage` is the
 * delayed state — the caller passes the countdown copy and the field stops
 * accepting the secret until it clears. Per D4 that wait lives in session
 * memory only, so nothing here may suggest the delay survives a restart.
 */
export interface PassphraseFieldProps {
  /**
   * The exact secret being asked for — design.md §Content Patterns forbids
   * "Enter your passphrase" in favour of naming the scope.
   */
  readonly label: string;
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isInvalid?: boolean;
  readonly autoComplete?: "current-password" | "new-password";
  readonly autoFocus?: boolean;
  /** Present ⇒ delayed: entry is disabled and this copy is announced. */
  readonly delayedMessage?: string;
}

export function PassphraseField({
  label,
  value,
  onChange,
  description,
  errorMessage,
  isInvalid = false,
  autoComplete = "current-password",
  autoFocus = false,
  delayedMessage,
}: PassphraseFieldProps): ReactNode {
  const [isRevealed, setIsRevealed] = useState(false);
  const isDelayed = delayedMessage !== undefined;

  // A delayed field must never be left showing the secret.
  const showsSecret = isRevealed && !isDelayed;

  return (
    <TextField
      label={label}
      type={showsSecret ? "text" : "password"}
      isInvalid={isInvalid}
      isDisabled={isDelayed}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      {...(value === undefined ? {} : { value })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(description === undefined ? {} : { description })}
      {...(errorMessage === undefined ? {} : { errorMessage })}
      trailing={
        <ToggleButton
          className={cx(styles["toggle"])}
          isSelected={showsSecret}
          isDisabled={isDelayed}
          onChange={setIsRevealed}
          aria-label={
            showsSecret ? `Hide ${label}` : `Show ${label}`
          }
        >
          {showsSecret ? "Hide" : "Show"}
        </ToggleButton>
      }
    >
      <span className={cx(visuallyHidden["root"])} role="status">
        {showsSecret ? "Passphrase is visible" : "Passphrase is hidden"}
      </span>
      {isDelayed && (
        <p className={cx(styles["delay"])} role="status">
          <span aria-hidden="true">◷</span>
          {delayedMessage}
        </p>
      )}
    </TextField>
  );
}
