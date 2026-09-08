import { useState, type ReactNode } from "react";
import { ProgressBar } from "react-aria-components";
import type { ImportProgressVm } from "../../application/view-models/import.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { formatCount } from "./delimited-target-screen.js";
import { ImportStages } from "./import-stages.js";
import styles from "./import.module.css";

/**
 * SCR-020 — streaming import, and MOD-007's cancel (import-progress.html).
 *
 * **There is no percentage, because there is no denominator.** Pre-flight's
 * row count is an estimate and stays flagged as one (D24), and
 * {@link ImportProgressVm} deliberately carries no total — so the mock's "42%"
 * has nothing truthful to compute from. What this screen shows instead is the
 * number the machine actually knows: rows whose batch has been acknowledged,
 * which is the same as rows that are durable (CA-10's commit-before-ack).
 * `role="progressbar"` still carries the stage to assistive technology, which
 * is what the accessibility contract asks for; the row count is text, so no
 * row is announced individually.
 *
 * **MOD-007 asks before it promises.** The dialog states the cancellation
 * contract — import-progress.html's own words — and the *claim* that nothing
 * remains is not made here at all: it is made on SCR-022, and only when the
 * cleanup receipt has arrived.
 */

/**
 * The parser's phases, in user language. The type is read off the view model
 * rather than off the machine, because `src/ui/**` names no state-machine
 * runtime even in a type position (M54 must-not) — and a new phase upstream is
 * then a compile error in this map.
 */
export type ImportPhaseVm = ImportProgressVm["phase"];

/** Tokens in, sentences out. */
const PHASE_ACTION: Readonly<Record<ImportPhaseVm, string>> = Object.freeze({
  sniffing: "Reading the first bytes to decide the format",
  sizing: "Measuring the file from a bounded sample",
  "waiting-for-stage": "Preparing the encrypted staging area",
  parsing: "Reading rows and committing them in batches",
  done: "Finishing the last batch",
});

export interface ImportProgressRegionProps {
  readonly phase: ImportPhaseVm;
  readonly children?: ReactNode;
}

/** The one progress region SCR-016's detection and SCR-020 both render. */
export function ImportProgressRegion({
  phase,
  children,
}: ImportProgressRegionProps): ReactNode {
  return (
    <ProgressBar
      aria-label={PHASE_ACTION[phase]}
      className={cx(styles["progressRow"])}
      isIndeterminate
    >
      <span className={cx(styles["lede"])}>{PHASE_ACTION[phase]}</span>
      {children}
    </ProgressBar>
  );
}

/** import-progress.html, verbatim: what cancelling promises (MOD-007). */
export const CANCELLATION_CONTRACT =
  "Cancel removes every committed batch for this in-progress app. It cannot leave a partial app tile.";

export interface ImportProgressScreenProps {
  readonly vm: ImportProgressVm;
  readonly nav: SecurityNavigation;
  readonly onCancel: () => void;
  readonly topBarActions?: ReactNode;
}

export function ImportProgressScreen({
  vm,
  nav,
  onCancel,
  topBarActions,
}: ImportProgressScreenProps): ReactNode {
  const [confirming, setConfirming] = useState(false);

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Import in progress"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-020">
        <ImportStages current="import" />

        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>
            Streaming import · local only
          </span>
          <h1 className={cx(styles["title"])}>Reading {vm.fileName}.</h1>
          <p className={cx(styles["lede"])}>
            Rows commit in bounded batches. The source file is never edited or
            uploaded to Sheaf.
          </p>
        </div>

        <section className={cx(styles["card"])}>
          <ImportProgressRegion phase={vm.phase}>
            <span className={cx(styles["progressCount"])}>
              {vm.rowsSoFar === 1
                ? "1 row is durable"
                : `${formatCount(vm.rowsSoFar)} rows are durable`}
            </span>
          </ImportProgressRegion>
          <dl className={cx(styles["facts"])}>
            <dt>Batches committed</dt>
            <dd>{formatCount(vm.batchesCommitted)}</dd>
          </dl>
          <p className={cx(styles["note"])}>
            Keep this tab open. Screen sleep is safe; closing cancels.
          </p>
          <div className={cx(styles["actions"])}>
            {vm.cancellable ? (
              <Button
                onPress={() => {
                  setConfirming(true);
                }}
              >
                Cancel import…
              </Button>
            ) : (
              <Button
                disabledReason="This step cannot be cancelled; it finishes on its own."
                isDisabled
              >
                Cancel import…
              </Button>
            )}
          </div>
        </section>

        <StatusBanner title="Cancellation contract" tone="info">
          {CANCELLATION_CONTRACT}
        </StatusBanner>

        <Dialog
          footer={
            <>
              <Button
                onPress={() => {
                  setConfirming(false);
                }}
              >
                Keep importing
              </Button>
              <Button
                onPress={() => {
                  setConfirming(false);
                  onCancel();
                }}
                tone="destructive"
              >
                Cancel import
              </Button>
            </>
          }
          isOpen={confirming}
          kind="destructive"
          onOpenChange={setConfirming}
          title="Cancel this import?"
        >
          <p>{CANCELLATION_CONTRACT}</p>
          <p>
            Sheaf waits for the removal to be confirmed before it says what was
            left behind.
          </p>
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}
