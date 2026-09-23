import { useId, useState, type ReactNode } from "react";
import type {
  FilterableFieldVm,
  RecordsFilterV1,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { Checkbox } from "../primitives/checkbox.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { TextField } from "../primitives/text-field.js";
import {
  ReferenceSearchBody,
  type ReferenceSearch,
} from "./reference-picker-sheet.js";
import {
  compareDecimalText,
  epochDayToIsoDate,
  isCanonicalDecimalText,
  isoDateToEpochDay,
} from "./values.js";
import styles from "./records.module.css";

/**
 * SHT-004–008 — the typed filter sheets (sheet-atlas.html; FR-13, CA-29).
 *
 * Each sheet holds exactly its atlas row's required contents:
 *
 * - SHT-004 enum: single or multi selection, search for long sets, and clear;
 * - SHT-005 date range: start, end, either open, and an invalid range named;
 * - SHT-006 number/currency: minimum, maximum, either open, and invalid named;
 * - SHT-007 boolean: either, yes, no;
 * - SHT-008 reference: search and select related records, and the broken item.
 *
 * A sheet edits one field's filter and nothing else. It answers the filter
 * to apply, or `null` to clear that field's filter; the route owns the query.
 * An invalid entry disables Apply *with its reason in text*, so the reason is
 * readable before anything is sent — the worker checks the same rules again.
 *
 * They compose M38's `Dialog` — a bottom sheet on compact, a centred modal
 * above — so focus trap, Escape and focus restore are the shared ones.
 */

export interface FilterSheetProps {
  readonly field: FilterableFieldVm;
  /** The field's current filter, if one is applied. */
  readonly current: RecordsFilterV1 | null;
  /** SHT-008's search over the related table (the worker's candidates). */
  readonly referenceSearch?: ReferenceSearch;
  /** Labels of records the current reference filter names. */
  readonly recordLabels?: ReadonlyMap<string, string>;
  /** `null` clears this field's filter. */
  readonly onApply: (filter: RecordsFilterV1 | null, labels?: ReadonlyMap<string, string>) => void;
  readonly onClose: () => void;
}

export function FilterSheet(props: FilterSheetProps): ReactNode {
  switch (props.field.sheet) {
    case "SHT-004":
      return <EnumSheet {...props} />;
    case "SHT-005":
      return <DateRangeSheet {...props} />;
    case "SHT-006":
      return <NumberRangeSheet {...props} />;
    case "SHT-007":
      return <BooleanSheet {...props} />;
    case "SHT-008":
      return <ReferenceSheet {...props} />;
  }
}

/** The sheet frame every filter shares: its title, Clear, and Apply or its reason. */
function FilterDialog({
  field,
  canClear,
  apply,
  onApply,
  onClose,
  children,
}: {
  readonly field: FilterableFieldVm;
  readonly canClear: boolean;
  /** The filter to apply, or the reason there is none yet. */
  readonly apply: { readonly filter: RecordsFilterV1; readonly labels?: ReadonlyMap<string, string> } | { readonly reason: string };
  readonly onApply: FilterSheetProps["onApply"];
  readonly onClose: () => void;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Dialog
      footer={
        <>
          {canClear && (
            <Button
              onPress={() => {
                onApply(null);
              }}
            >
              Clear filter
            </Button>
          )}
          {"reason" in apply ? (
            <Button disabledReason={apply.reason} isDisabled tone="primary">
              Apply filter
            </Button>
          ) : (
            <Button
              onPress={() => {
                onApply(apply.filter, apply.labels);
              }}
              tone="primary"
            >
              Apply filter
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Filter ${field.fieldName}`}
    >
      <div className={cx(styles["sheetBody"])} data-sheet={field.sheet}>
        {children}
      </div>
    </Dialog>
  );
}

/** Above this many options, the atlas's "search for long sets" applies. */
const SEARCHABLE_FROM = 8;

function EnumSheet({ field, current, onApply, onClose }: FilterSheetProps): ReactNode {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(current?.operand.kind === "enum-in" ? current.operand.optionIds : []),
  );
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? field.enumOptions
      : field.enumOptions.filter((option) => option.label.toLowerCase().includes(needle));

  return (
    <FilterDialog
      apply={
        selected.size === 0
          ? { reason: `Choose at least one ${field.fieldName} choice.` }
          : {
              filter: {
                fieldId: field.fieldId,
                // In the field's own order, whatever order they were ticked in.
                operand: {
                  kind: "enum-in",
                  optionIds: field.enumOptions.filter((option) => selected.has(option.optionId)).map((option) => option.optionId),
                },
              },
            }
      }
      canClear={current !== null}
      field={field}
      onApply={onApply}
      onClose={onClose}
    >
      {field.enumOptions.length >= SEARCHABLE_FROM && (
        <TextField autoComplete="off" label={`Search ${field.fieldName} choices`} onChange={setQuery} value={query} />
      )}
      {shown.length === 0 ? (
        <p className={cx(styles["lede"])}>{`No choice in ${field.fieldName} matches “${query}”.`}</p>
      ) : (
        <ul className={cx(styles["sheetList"])}>
          {shown.map((option) => (
            <li key={option.optionId}>
              <Checkbox
                className={cx(styles["sheetCheck"])}
                isSelected={selected.has(option.optionId)}
                onChange={(isSelected) => {
                  setSelected((before) => {
                    const next = new Set(before);
                    if (isSelected) next.add(option.optionId);
                    else next.delete(option.optionId);
                    return next;
                  });
                }}
              >
                {option.label}
                {!option.isActive && <span className={cx(styles["optionState"])}>No longer offered</span>}
              </Checkbox>
            </li>
          ))}
        </ul>
      )}
    </FilterDialog>
  );
}

/** A labelled native input, the way the record form draws one. */
function SheetInput({
  label,
  value,
  onChange,
  type,
  inputMode,
  isInvalid,
  description,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type: "date" | "text";
  readonly inputMode?: "decimal";
  readonly isInvalid: boolean;
  readonly description: string;
}): ReactNode {
  const inputId = useId();
  const descriptionId = useId();
  return (
    <div className={cx(styles["fieldGroup"])}>
      <label className={cx(styles["label"])} htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={descriptionId}
        aria-invalid={isInvalid}
        className={cx(styles["input"])}
        data-invalid={isInvalid}
        id={inputId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        type={type}
        value={value}
        {...(inputMode === undefined ? {} : { inputMode })}
      />
      <span className={cx(styles["description"])} id={descriptionId}>
        {description}
      </span>
    </div>
  );
}

function DateRangeSheet({ field, current, onApply, onClose }: FilterSheetProps): ReactNode {
  const range = current?.operand.kind === "date-range" ? current.operand : null;
  const [fromText, setFromText] = useState(range?.from == null ? "" : epochDayToIsoDate(range.from));
  const [toText, setToText] = useState(range?.to == null ? "" : epochDayToIsoDate(range.to));
  const from = fromText === "" ? null : isoDateToEpochDay(fromText);
  const to = toText === "" ? null : isoDateToEpochDay(toText);
  const isFromInvalid = fromText !== "" && from === null;
  const isToInvalid = toText !== "" && to === null;
  const isInverted = from !== null && to !== null && from > to;

  return (
    <FilterDialog
      apply={
        isFromInvalid || isToInvalid
          ? { reason: "Enter each date as a full day." }
          : isInverted
            ? { reason: "The start date is after the end date." }
            : from === null && to === null
              ? { reason: "Enter a start date, an end date, or both." }
              : { filter: { fieldId: field.fieldId, operand: { kind: "date-range", from, to } } }
      }
      canClear={current !== null}
      field={field}
      onApply={onApply}
      onClose={onClose}
    >
      <SheetInput
        description="Leave empty for no start."
        isInvalid={isFromInvalid || isInverted}
        label="Start date"
        onChange={setFromText}
        type="date"
        value={fromText}
      />
      <SheetInput
        description="Leave empty for no end. Both days are included."
        isInvalid={isToInvalid || isInverted}
        label="End date"
        onChange={setToText}
        type="date"
        value={toText}
      />
    </FilterDialog>
  );
}

function NumberRangeSheet({ field, current, onApply, onClose }: FilterSheetProps): ReactNode {
  const range = current?.operand.kind === "number-range" ? current.operand : null;
  const [minText, setMinText] = useState(range?.min ?? "");
  const [maxText, setMaxText] = useState(range?.max ?? "");
  const min = minText.trim() === "" ? null : minText.trim();
  const max = maxText.trim() === "" ? null : maxText.trim();
  const isMinInvalid = min !== null && !isCanonicalDecimalText(min);
  const isMaxInvalid = max !== null && !isCanonicalDecimalText(max);
  const isInverted = !isMinInvalid && !isMaxInvalid && min !== null && max !== null && compareDecimalText(min, max) > 0;
  const unit = field.type.kind === "currency" ? ` Amount in ${field.type.currencyCode}.` : "";

  return (
    <FilterDialog
      apply={
        isMinInvalid || isMaxInvalid
          ? { reason: "Enter each amount as digits, with a point for any decimals." }
          : isInverted
            ? { reason: "The minimum is above the maximum." }
            : min === null && max === null
              ? { reason: "Enter a minimum, a maximum, or both." }
              : { filter: { fieldId: field.fieldId, operand: { kind: "number-range", min, max } } }
      }
      canClear={current !== null}
      field={field}
      onApply={onApply}
      onClose={onClose}
    >
      <SheetInput
        description={`Leave empty for no minimum.${unit}`}
        inputMode="decimal"
        isInvalid={isMinInvalid || isInverted}
        label="Minimum"
        onChange={setMinText}
        type="text"
        value={minText}
      />
      <SheetInput
        description={`Leave empty for no maximum. Both ends are included.${unit}`}
        inputMode="decimal"
        isInvalid={isMaxInvalid || isInverted}
        label="Maximum"
        onChange={setMaxText}
        type="text"
        value={maxText}
      />
    </FilterDialog>
  );
}

type BooleanChoice = "either" | "yes" | "no";

function BooleanSheet({ field, current, onApply, onClose }: FilterSheetProps): ReactNode {
  const [choice, setChoice] = useState<BooleanChoice>(
    current?.operand.kind === "boolean-is" ? (current.operand.value ? "yes" : "no") : "either",
  );
  const choices: readonly [BooleanChoice, string][] = [
    ["either", "Either"],
    ["yes", "Yes"],
    ["no", "No"],
  ];

  return (
    <Dialog
      footer={
        <Button
          onPress={() => {
            // "Either" is no filter at all: it clears this field's.
            onApply(choice === "either" ? null : { fieldId: field.fieldId, operand: { kind: "boolean-is", value: choice === "yes" } });
          }}
          tone="primary"
        >
          Apply filter
        </Button>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Filter ${field.fieldName}`}
    >
      <ul className={cx(styles["sheetList"])} data-sheet="SHT-007">
        {choices.map(([value, label]) => (
          <li key={value}>
            <button
              aria-pressed={choice === value}
              className={cx(styles["sheetOption"])}
              data-selected={choice === value}
              onClick={() => {
                setChoice(value);
              }}
              type="button"
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function ReferenceSheet({ field, current, referenceSearch, recordLabels, onApply, onClose }: FilterSheetProps): ReactNode {
  const [isBroken, setIsBroken] = useState(current?.operand.kind === "reference-broken");
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(
    new Map(
      current?.operand.kind === "reference-in"
        ? current.operand.recordIds.map((recordId) => [recordId, recordLabels?.get(recordId) ?? ""])
        : [],
    ),
  );

  return (
    <FilterDialog
      apply={
        isBroken
          ? { filter: { fieldId: field.fieldId, operand: { kind: "reference-broken" } } }
          : chosen.size === 0
            ? { reason: "Choose at least one record, or Missing related record." }
            : {
                filter: { fieldId: field.fieldId, operand: { kind: "reference-in", recordIds: [...chosen.keys()] } },
                labels: chosen,
              }
      }
      canClear={current !== null}
      field={field}
      onApply={onApply}
      onClose={onClose}
    >
      <ul className={cx(styles["sheetList"])}>
        <li>
          <button
            aria-pressed={isBroken}
            className={cx(styles["sheetOption"])}
            data-selected={isBroken}
            onClick={() => {
              setIsBroken((before) => !before);
            }}
            type="button"
          >
            <span>Missing related record</span>
            <span className={cx(styles["optionState"])}>Records whose {field.fieldName} points at nothing</span>
          </button>
        </li>
      </ul>
      {!isBroken && referenceSearch !== undefined && (
        <ReferenceSearchBody
          fieldName={field.fieldName}
          onSelect={(candidate) => {
            setChosen((before) => {
              const next = new Map(before);
              if (next.has(candidate.recordId)) next.delete(candidate.recordId);
              else next.set(candidate.recordId, candidate.label);
              return next;
            });
          }}
          search={referenceSearch}
          selectedId={null}
          selectedIds={new Set(chosen.keys())}
        />
      )}
    </FilterDialog>
  );
}
