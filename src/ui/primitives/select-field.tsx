import type { Key, ReactNode } from "react";
import {
  Button,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Text,
} from "react-aria-components";
import { cx } from "./class-names.js";
import styles from "./select-field.module.css";

/** One choice in an enum picker. Callers own both halves. */
export interface SelectOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

/**
 * CTL-038 enum picker field.
 *
 * States: empty, populated, open, invalid option. A closed set of options with
 * no free-text entry — SCR-005's idle timeout (Off / 5 minutes / 15 minutes /
 * 1 hour) is F01's only instance, and D13 makes that setting a real durable
 * write rather than decoration.
 */
export interface SelectFieldProps<Value extends string> {
  readonly label: string;
  readonly options: readonly SelectOption<Value>[];
  /** `null` is the empty state. */
  readonly value?: Value | null;
  readonly onChange?: (value: Value) => void;
  readonly placeholder?: string;
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isInvalid?: boolean;
  readonly isDisabled?: boolean;
  readonly className?: string;
}

export function SelectField<Value extends string>({
  label,
  options,
  value,
  onChange,
  placeholder = "Choose an option",
  description,
  errorMessage,
  isInvalid = false,
  isDisabled = false,
  className,
}: SelectFieldProps<Value>): ReactNode {
  return (
    <Select
      className={cx(styles["root"], className)}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      placeholder={placeholder}
      {...(value === undefined ? {} : { selectedKey: value })}
      {...(onChange === undefined
        ? {}
        : {
            onSelectionChange: (key: Key | null) => {
              if (key !== null) onChange(String(key) as Value);
            },
          })}
    >
      <Label className={cx(styles["label"])}>{label}</Label>
      <Button className={cx(styles["trigger"])}>
        <SelectValue className={cx(styles["value"])} />
        <span aria-hidden="true">⌄</span>
      </Button>
      {description !== undefined && (
        <Text className={cx(styles["description"])} slot="description">
          {description}
        </Text>
      )}
      {errorMessage !== undefined && (
        <FieldError className={cx(styles["error"])}>{errorMessage}</FieldError>
      )}
      <Popover className={cx(styles["popover"])}>
        <ListBox className={cx(styles["listBox"])} items={options}>
          {(option: SelectOption<Value>) => (
            <ListBoxItem
              className={cx(styles["option"])}
              id={option.value}
              textValue={option.label}
            >
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}
