import type { ReactNode } from "react";
import type {
  FilterChipVm,
  RecordsListVm,
} from "../../application/view-models/records.js";
import { cx } from "../primitives/class-names.js";
import { describeFilterChip, describeSort, type FieldTypeVm } from "./values.js";
import styles from "./records.module.css";

/**
 * records.html's chip row (FR-13; SHT-004–009; STA-026): Sort first, then a
 * chip per filterable column. An applied filter reads as what it says —
 * "Status: Scheduled" — with its own clear button; an unapplied column reads
 * as its name and opens its sheet. The row scrolls sideways on a phone rather
 * than wrapping, so the list keeps its height while the tools stay sticky.
 *
 * A filter with no sheet — a text filter a chart handed over (D63), or one on
 * a column the table no longer shows — is still drawn, and still clearable:
 * every active filter is visible (STA-026).
 */

export interface FilterChipsProps {
  readonly vm: RecordsListVm;
  readonly fieldTypes?: ReadonlyMap<string, FieldTypeVm>;
  readonly onOpenSort: () => void;
  readonly onOpenFilter: (fieldId: string) => void;
  readonly onClearFilter: (chip: FilterChipVm) => void;
}

export function FilterChips({ vm, fieldTypes, onOpenSort, onOpenFilter, onClearFilter }: FilterChipsProps): ReactNode {
  const chipFor = new Map(vm.filters.map((chip) => [chip.fieldId, chip]));
  const sheetless = vm.filters.filter((chip) => !vm.filterableFields.some((field) => field.fieldId === chip.fieldId));

  return (
    <ul aria-label="Sort and filters" className={cx(styles["chipRow"])}>
      <li>
        <button
          className={cx(styles["chip"])}
          data-active={vm.sort !== null}
          data-chip="sort"
          onClick={onOpenSort}
          type="button"
        >
          {vm.sort === null ? "Sort" : describeSort(vm.sort)}
          <span aria-hidden="true"> ↕</span>
        </button>
      </li>
      {vm.filterableFields.map((field) => {
        const chip = chipFor.get(field.fieldId);
        return chip === undefined ? (
          <li key={field.fieldId}>
            <button
              className={cx(styles["chip"])}
              data-chip={field.fieldId}
              onClick={() => {
                onOpenFilter(field.fieldId);
              }}
              type="button"
            >
              {field.fieldName}
            </button>
          </li>
        ) : (
          <li key={field.fieldId}>
            <ActiveChip
              chip={chip}
              onClear={onClearFilter}
              onOpen={() => {
                onOpenFilter(field.fieldId);
              }}
              type={fieldTypes?.get(field.fieldId)}
            />
          </li>
        );
      })}
      {sheetless.map((chip, index) => (
        <li key={`${chip.fieldId}-${String(index)}`}>
          <ActiveChip chip={chip} onClear={onClearFilter} type={fieldTypes?.get(chip.fieldId)} />
        </li>
      ))}
    </ul>
  );
}

/** One applied filter: what it says, and × to clear exactly it. */
export function ActiveChip({
  chip,
  type,
  onOpen,
  onClear,
}: {
  readonly chip: FilterChipVm;
  readonly type: FieldTypeVm | undefined;
  readonly onOpen?: () => void;
  readonly onClear: (chip: FilterChipVm) => void;
}): ReactNode {
  const text = describeFilterChip(chip, type);
  return (
    <span className={cx(styles["chipPair"])} data-active="true" data-chip={chip.fieldId}>
      {onOpen === undefined ? (
        <span className={cx(styles["chipText"])}>{text}</span>
      ) : (
        <button className={cx(styles["chip"], styles["chipMain"])} data-active="true" onClick={onOpen} type="button">
          {text}
        </button>
      )}
      <button
        aria-label={`Clear filter ${text}`}
        className={cx(styles["chipClear"])}
        onClick={() => {
          onClear(chip);
        }}
        type="button"
      >
        ×
      </button>
    </span>
  );
}
