import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ReferenceCandidateVm,
  ReferencePickerVm,
} from "../../application/view-models/records.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { TextField } from "../primitives/text-field.js";
import styles from "./records.module.css";

/**
 * SHT-002 — the reference picker (sheet-atlas.html; CTL-039, FR-11/12).
 *
 * Required contents, from the atlas: *search related records, human label,
 * create/open related*. The search is the worker's (`searchReferenceCandidates`,
 * blank browses), every candidate reads as its human label, and the current
 * choice is marked. "Create related" is absent: creating a record in another
 * table from inside this one is a second form this release does not have, and
 * the button would lead nowhere.
 *
 * It composes M38's `Dialog`, the same sheet SHT-001 uses — bottom-anchored on
 * compact, a centred modal above — so focus trap, Escape and focus restore are
 * the shared ones.
 */

/** Asks the worker for candidates matching `query` and returns the sheet's view. */
export type ReferenceSearch = (query: string) => Promise<ReferencePickerVm>;

/**
 * The search box and the candidate list, shared by SHT-002 and MOD-011. A
 * response that arrives after a newer query was typed is dropped, so the list
 * never shows the answer to a question no longer asked.
 */
export function ReferenceSearchBody({
  fieldName,
  search,
  selectedId,
  onSelect,
}: {
  readonly fieldName: string;
  readonly search: ReferenceSearch;
  readonly selectedId: string | null;
  readonly onSelect: (candidate: ReferenceCandidateVm) => void;
}): ReactNode {
  const [query, setQuery] = useState("");
  const [vm, setVm] = useState<ReferencePickerVm | null>(null);
  const asked = useRef(0);
  // The latest search function, without making a caller's fresh closure a
  // reason to ask again: only a new query is.
  const latestSearch = useRef(search);
  useEffect(() => {
    latestSearch.current = search;
  });

  useEffect(() => {
    const ticket = asked.current + 1;
    asked.current = ticket;
    void latestSearch.current(query).then(
      (answer) => {
        if (asked.current === ticket) setVm(answer);
      },
      () => {
        if (asked.current === ticket) setVm(null);
      },
    );
  }, [query]);

  return (
    <>
      <TextField
        autoComplete="off"
        label={`Search ${fieldName} choices`}
        onChange={setQuery}
        value={query}
      />
      {vm === null ? (
        <p className={cx(styles["lede"])} role="status">
          Reading the records you can choose on this device.
        </p>
      ) : vm.emptiness !== null ? (
        <p className={cx(styles["lede"])} role="status">
          {vm.emptiness === "no-results"
            ? `No record matches “${vm.query}”.`
            : vm.emptiness === "no-candidates"
              ? `There are no records to choose for ${fieldName}.`
              : `${fieldName} is not connected to another table, so there is nothing to choose.`}
        </p>
      ) : (
        <ul className={cx(styles["sheetList"])} data-sheet="SHT-002">
          {vm.candidates.map((candidate) => (
            <li key={candidate.recordId}>
              <button
                aria-pressed={selectedId === candidate.recordId}
                className={cx(styles["sheetOption"])}
                data-selected={selectedId === candidate.recordId}
                onClick={() => {
                  onSelect(candidate);
                }}
                type="button"
              >
                <span>{candidate.label}</span>
                {candidate.isCurrent && (
                  <span className={cx(styles["optionState"])}>Current choice</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export interface ReferenceChoice {
  readonly recordId: string;
  readonly label: string;
}

export interface ReferencePickerSheetProps {
  readonly isOpen: boolean;
  readonly fieldName: string;
  /** What the field holds now, in words, so the sheet says it before anything is chosen. */
  readonly currentText: string | null;
  readonly currentRecordId: string | null;
  readonly search: ReferenceSearch;
  /** `null` clears the field. */
  readonly onApply: (choice: ReferenceChoice | null) => void;
  readonly onClose: () => void;
}

export function ReferencePickerSheet(props: ReferencePickerSheetProps): ReactNode {
  // A fresh open is a fresh sheet: an unapplied selection is discarded.
  return props.isOpen ? <OpenPicker key={props.currentRecordId ?? ""} {...props} /> : null;
}

function OpenPicker({
  fieldName,
  currentText,
  currentRecordId,
  search,
  onApply,
  onClose,
}: ReferencePickerSheetProps): ReactNode {
  const [selected, setSelected] = useState<ReferenceChoice | null>(null);
  const selectedId = selected?.recordId ?? currentRecordId;

  return (
    <Dialog
      footer={
        <>
          <Button
            onPress={() => {
              onApply(null);
            }}
          >
            Clear value
          </Button>
          {selected === null ? (
            <Button
              disabledReason="Choose a record first."
              isDisabled
              tone="primary"
            >
              Apply choice
            </Button>
          ) : (
            <Button
              onPress={() => {
                onApply(selected);
              }}
              tone="primary"
            >
              Apply choice
            </Button>
          )}
        </>
      }
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Choose ${fieldName}`}
    >
      <p className={cx(styles["lede"])}>
        {currentText === null ? "Nothing is chosen yet." : `Now: ${currentText}`}
      </p>
      <ReferenceSearchBody
        fieldName={fieldName}
        onSelect={(candidate) => {
          setSelected({ recordId: candidate.recordId, label: candidate.label });
        }}
        search={search}
        selectedId={selectedId}
      />
    </Dialog>
  );
}
