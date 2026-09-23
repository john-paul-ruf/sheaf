import { useState, type ReactNode } from "react";
import type {
  ImportCleanupVm,
  ImportEndedVm,
} from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { StatusBanner, type StatusTone } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { formatCount } from "./delimited-target-screen.js";
import { UNREADABLE_DETAIL_SENTENCE } from "./import-refused-screen.js";
import { describeSheetOrdinal, ImportProgressRegion } from "./import-progress-screen.js";
import {
  ChooseAnotherFileButton,
  type WorkbookPickerProps,
} from "./upload-screen.js";
import styles from "./import.module.css";

/**
 * SCR-022 — the import that ended, and MOD-008's detail (import-failed.html).
 *
 * **"No partial app remains" is a receipt, not a hope (MOD-007).** The three
 * cleanup states are three different claims and the surface makes exactly the
 * one it was given: `removed` carries the count the store actually deleted,
 * `nothing-to-remove` means no stage was ever created, and `unconfirmed` says
 * only that the removal could not be confirmed. The mock's line is printed for
 * the first of those and for nothing else.
 *
 * **A cancel is not a failure.** `reason` is `null` for a cancel by
 * construction, so the cancelled variant cannot acquire a diagnostic and read
 * as though something went wrong; import-failed.html's cancelled variant is
 * the one whose words are used.
 *
 * MOD-008 asks for "named stage/sheet, cleanup fact, retry path". A streamed
 * failure carries its stage, the sheet ordinal and a closed diagnostic
 * (CA-24): import-failed.html shows the raw diagnostic token beside the
 * sentence, so both are shown, and the sheet is named from the selection
 * pre-flight showed. With no detail the stage is the failure reason. The
 * cleanup fact is the receipt, and the retry path is on the page behind it.
 */

type ImportFailureDetailVm = NonNullable<ImportEndedVm["detail"]>;

/** import-failed.html's "Failed stage" names. */
const FAILED_STAGE: Readonly<Record<ImportFailureDetailVm["stage"], string>> =
  Object.freeze({
    container: "Container",
    "sheet-stream": "Cell stream",
    stage: "Staging",
  });

function diagnosticSentence(detail: ImportFailureDetailVm): string {
  return detail.diagnostic === "parse-failed"
    ? "The file could not be read all the way through."
    : UNREADABLE_DETAIL_SENTENCE[detail.diagnostic];
}

/** The mock's lede: what happened, then where ("while parsing sheet 3 of 7"). */
function describeFailure(detail: ImportFailureDetailVm): string {
  return detail.sheet === null
    ? diagnosticSentence(detail)
    : `${diagnosticSentence(detail)} It stopped while reading ${describeSheetOrdinal(
        detail.sheet,
      ).toLowerCase()}.`;
}

/** Stage, sheet and diagnostic as MOD-008 and the page both list them. */
function FailureFacts({ detail }: { readonly detail: ImportFailureDetailVm }): ReactNode {
  return (
    <>
      <dt>Failed stage</dt>
      <dd>{FAILED_STAGE[detail.stage]}</dd>
      {detail.sheet !== null && (
        <>
          <dt>Sheet</dt>
          <dd>{detail.sheet.name}</dd>
        </>
      )}
      <dt>Diagnostic</dt>
      <dd>
        <code>{detail.diagnostic}</code>
      </dd>
    </>
  );
}

/**
 * Why a run ended, taken from the view model itself rather than from the
 * machine module: `src/ui/**` names no state-machine runtime, not even in a
 * type position (M54 must-not), and this way a new reason upstream is a
 * compile error in this map.
 */
type ImportFailureReasonVm = NonNullable<ImportEndedVm["reason"]>;

/** Closed tokens in, sentences out. No message ever crosses the worker (CA-12). */
const FAILURE_REASON: Readonly<Record<ImportFailureReasonVm, string>> =
  Object.freeze({
    "parse-failed": "The file could not be read all the way through.",
    "stage-rejected":
      "The local store refused a batch of rows, so streaming stopped.",
    "malformed-request":
      "The parser was sent a request it could not understand.",
    "stage-missing":
      "The staged import is no longer on this device, so it could not be finished.",
    "cleanup-unconfirmed":
      "Sheaf asked the local store to remove what it had written and did not get an answer.",
    "service-error": "Sheaf could not finish the import.",
  });

const CLEANUP_TONE: Readonly<Record<ImportCleanupVm["kind"], StatusTone>> =
  Object.freeze({
    removed: "success",
    "nothing-to-remove": "info",
    unconfirmed: "warning",
  });

/** import-failed.html's line, and the two states that may not borrow it. */
const CLEANUP_TITLE: Readonly<Record<ImportCleanupVm["kind"], string>> =
  Object.freeze({
    removed: "No partial app remains.",
    "nothing-to-remove": "Nothing had been written.",
    unconfirmed: "Sheaf could not confirm the cleanup.",
  });

export function describeCleanup(cleanup: ImportCleanupVm): string {
  switch (cleanup.kind) {
    case "removed":
      return cleanup.deletedCount === 1
        ? "1 staged item was removed before this message appeared."
        : `${formatCount(
            cleanup.deletedCount,
          )} staged items were removed before this message appeared.`;
    case "nothing-to-remove":
      return "The import ended before anything was staged, so the library is exactly as it was.";
    default:
      // MOD-007: this state must not claim that nothing remains.
      return "The removal was requested and did not answer. Sheaf will finish it the next time this device is unlocked.";
  }
}

export interface ImportFailedScreenProps extends WorkbookPickerProps {
  readonly vm: ImportEndedVm;
  readonly nav: SecurityNavigation;
  readonly onReturnToLibrary: () => void;
  /** Present only while the page still holds the file that was picked. */
  readonly onRetrySameFile?: () => void;
  readonly topBarActions?: ReactNode;
}

export function ImportFailedScreen({
  vm,
  nav,
  acceptedFileTypes,
  onSelectFiles,
  onReturnToLibrary,
  onRetrySameFile,
  topBarActions,
}: ImportFailedScreenProps): ReactNode {
  const [details, setDetails] = useState(false);
  const cancelled = vm.outcome === "cancelled";

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title={cancelled ? "Import cancelled" : "Import did not complete"}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-022">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Import stopped</span>
          <h1 className={cx(styles["title"])}>
            {cancelled
              ? "You cancelled the import."
              : vm.detail !== null && vm.detail.sheet !== null
                ? `${vm.detail.sheet.name} could not be read.`
                : `${vm.fileName} could not be imported.`}
          </h1>
          {vm.detail !== null ? (
            <p className={cx(styles["lede"])}>{describeFailure(vm.detail)}</p>
          ) : (
            vm.reason !== null && (
              <p className={cx(styles["lede"])}>{FAILURE_REASON[vm.reason]}</p>
            )
          )}
        </div>

        {vm.busy ? (
          <section className={cx(styles["card"])}>
            <ImportProgressRegion phase="done">
              <span className={cx(styles["lede"])}>
                Removing everything this import had written. Nothing is claimed
                until that is confirmed.
              </span>
            </ImportProgressRegion>
          </section>
        ) : (
          <>
            <StatusBanner
              title={CLEANUP_TITLE[vm.cleanup.kind]}
              tone={CLEANUP_TONE[vm.cleanup.kind]}
            >
              {describeCleanup(vm.cleanup)}
            </StatusBanner>

            {vm.detail !== null && (
              <dl className={cx(styles["facts"])}>
                <dt>File</dt>
                <dd>{vm.fileName}</dd>
                <FailureFacts detail={vm.detail} />
              </dl>
            )}

            <div className={cx(styles["actions"])}>
              {onRetrySameFile !== undefined && (
                <Button onPress={onRetrySameFile} tone="primary">
                  Retry same file
                </Button>
              )}
              <ChooseAnotherFileButton
                acceptedFileTypes={acceptedFileTypes}
                onSelectFiles={onSelectFiles}
                tone="secondary"
              />
              <Button onPress={onReturnToLibrary}>Return to library</Button>
              <Button
                onPress={() => {
                  setDetails(true);
                }}
              >
                Details
              </Button>
            </div>
          </>
        )}

        <Dialog
          footer={
            <Button
              onPress={() => {
                setDetails(false);
              }}
            >
              Close
            </Button>
          }
          isOpen={details}
          onOpenChange={setDetails}
          title="Import failure details"
        >
          <dl className={cx(styles["facts"])}>
            <dt>File</dt>
            <dd>{vm.fileName}</dd>
            <dt>Outcome</dt>
            <dd>{cancelled ? "Cancelled by you" : "Did not complete"}</dd>
            {vm.detail === null ? (
              <>
                <dt>Stage</dt>
                <dd>
                  {vm.reason === null
                    ? "Stopped at your request"
                    : FAILURE_REASON[vm.reason]}
                </dd>
              </>
            ) : (
              <FailureFacts detail={vm.detail} />
            )}
            <dt>Cleanup</dt>
            <dd>{describeCleanup(vm.cleanup)}</dd>
          </dl>
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}
