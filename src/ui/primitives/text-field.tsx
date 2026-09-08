import type { ReactNode } from "react";
import {
  FieldError,
  Input,
  Label,
  Text,
  TextField as AriaTextField,
} from "react-aria-components";
import { cx } from "./class-names.js";
import styles from "./text-field.module.css";

/**
 * CTL-023 — the labelled field every secret-entry control in F01 composes.
 *
 * `label` is a required string, not a slot: design.md §Accessibility Contract
 * requires a visible label on every control and forbids placeholder-as-label,
 * so the type refuses to build a field without one.
 */
export interface TextFieldProps {
  readonly label: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isInvalid?: boolean;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  readonly isRequired?: boolean;
  readonly type?: "text" | "password";
  readonly autoComplete?: string;
  readonly autoFocus?: boolean;
  readonly inputClassName?: string;
  readonly className?: string;
  /** Rendered beside the input — CTL-027's show/hide control, for example. */
  readonly trailing?: ReactNode;
  /** Rendered under the description — status text a caller owns. */
  readonly children?: ReactNode;
}

export function TextField({
  label,
  value,
  defaultValue,
  onChange,
  description,
  errorMessage,
  isInvalid = false,
  isDisabled = false,
  isReadOnly = false,
  isRequired = false,
  type = "text",
  autoComplete,
  autoFocus = false,
  inputClassName,
  className,
  trailing,
  children,
}: TextFieldProps): ReactNode {
  return (
    <AriaTextField
      className={cx(styles["root"], className)}
      type={type}
      isInvalid={isInvalid}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
    >
      <Label className={cx(styles["label"])}>{label}</Label>
      <div className={cx(styles["inputRow"])}>
        <Input
          className={cx(styles["input"], inputClassName)}
          autoFocus={autoFocus}
          {...(autoComplete === undefined ? {} : { autoComplete })}
        />
        {trailing}
      </div>
      {description !== undefined && (
        <Text className={cx(styles["description"])} slot="description">
          {description}
        </Text>
      )}
      {errorMessage !== undefined && (
        <FieldError className={cx(styles["error"])}>
          <span aria-hidden="true">!</span>
          {errorMessage}
        </FieldError>
      )}
      {children}
    </AriaTextField>
  );
}
