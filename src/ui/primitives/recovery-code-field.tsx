import type { ReactNode } from "react";
import { cx } from "./class-names.js";
import styles from "./recovery-code-field.module.css";
import { TextField } from "./text-field.js";

/**
 * CTL-028 recovery-code input.
 *
 * States: grouped entry, pasted, invalid, accepted. Whether a code is *valid*
 * is a crypto question this layer never asks — the caller passes `isInvalid`
 * and `isAccepted`.
 */
export interface RecoveryCodeFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isInvalid?: boolean;
  /** Caller-decided: the code was recognised. */
  readonly isAccepted?: boolean;
  readonly acceptedMessage?: string;
  readonly autoFocus?: boolean;
  /**
   * Paste/typing normalisation hook. The default only case-folds and drops
   * whitespace; grouping rules belong to whoever owns the code format.
   */
  readonly normalize?: (raw: string) => string;
}

/** Case-folds and removes whitespace. Deliberately format-agnostic. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function RecoveryCodeField({
  label,
  value,
  onChange,
  description,
  errorMessage,
  isInvalid = false,
  isAccepted = false,
  acceptedMessage = "Accepted",
  autoFocus = false,
  normalize = normalizeRecoveryCode,
}: RecoveryCodeFieldProps): ReactNode {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(next) => {
        onChange(normalize(next));
      }}
      isInvalid={isInvalid}
      autoFocus={autoFocus}
      inputClassName={cx(styles["input"])}
      {...(description === undefined ? {} : { description })}
      {...(errorMessage === undefined ? {} : { errorMessage })}
    >
      {isAccepted && !isInvalid && (
        <p className={cx(styles["status"])} role="status">
          <span aria-hidden="true">✓</span>
          {acceptedMessage}
        </p>
      )}
    </TextField>
  );
}
