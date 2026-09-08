import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./class-names.js";
import styles from "./recovery-code-field.module.css";
import { TextField } from "./text-field.js";

/**
 * CTL-029 typed confirmation phrase.
 *
 * States: empty, mismatch, match. The component owns only the comparison the
 * mock shows — typed text against the required phrase — and reports it through
 * `onMatchChange` so the destructive action's own control can stay disabled
 * until it matches (design.md §Destructive actions).
 */
export interface ConfirmationPhraseFieldProps {
  /** The phrase the user must type, e.g. `DELETE LOCAL`. */
  readonly phrase: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Overrides the derived "Type DELETE LOCAL" label. */
  readonly label?: string;
  readonly mismatchMessage?: string;
  readonly matchMessage?: string;
  readonly onMatchChange?: (isMatched: boolean) => void;
  readonly autoFocus?: boolean;
}

/** True when `value` is exactly `phrase`, ignoring surrounding whitespace. */
export function isConfirmationPhraseMatched(
  value: string,
  phrase: string,
): boolean {
  return value.trim() === phrase;
}

export function ConfirmationPhraseField({
  phrase,
  value,
  onChange,
  label,
  mismatchMessage = "This does not match yet.",
  matchMessage = "Matched",
  onMatchChange,
  autoFocus = false,
}: ConfirmationPhraseFieldProps): ReactNode {
  const isMatched = isConfirmationPhraseMatched(value, phrase);
  const isEmpty = value.trim() === "";
  const previous = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (previous.current === isMatched) return;
    previous.current = isMatched;
    onMatchChange?.(isMatched);
  }, [isMatched, onMatchChange]);

  return (
    <TextField
      label={label ?? `Type ${phrase}`}
      value={value}
      onChange={onChange}
      isInvalid={!isEmpty && !isMatched}
      autoFocus={autoFocus}
      inputClassName={cx(styles["input"])}
      {...(isEmpty || isMatched ? {} : { errorMessage: mismatchMessage })}
    >
      {isMatched && (
        <p className={cx(styles["status"])} role="status">
          <span aria-hidden="true">✓</span>
          {matchMessage}
        </p>
      )}
    </TextField>
  );
}
