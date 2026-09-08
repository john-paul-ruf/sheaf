import { useState, type ReactNode } from "react";
import type { PassphraseChangeVm } from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { InlineLink } from "../primitives/inline-link.js";
import { PassphraseField } from "../primitives/passphrase-field.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";
import { PassphraseVerdict } from "./verdict.js";

/**
 * SCR-006 — change this device's passphrase, with MOD-037 (CAP-04).
 *
 * The claim this screen makes is the one MOD-037 exists to put in front of the
 * user *before* anything runs: the current passphrase authorizes a **key
 * re-wrap**, so no envelope is rewritten and nothing is lost. The worker is
 * what makes that true (S04/S05 proved it); this screen's job is to have said
 * it, and to say it again in the confirmation.
 */

export interface PassphraseChangeScreenProps {
  readonly vm: PassphraseChangeVm;
  readonly nav: SecurityNavigation;
  readonly onEvaluate: (nextPassphrase: string, confirmation: string) => void;
  readonly onSubmit: (
    currentPassphrase: string,
    nextPassphrase: string,
    confirmation: string,
  ) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly topBarActions?: ReactNode;
}

export function PassphraseChangeScreen({
  vm,
  nav,
  onEvaluate,
  onSubmit,
  onConfirm,
  onCancel,
  topBarActions,
}: PassphraseChangeScreenProps): ReactNode {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="security"
      nav={nav}
      title="Change passphrase"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-006">
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>Security · no data loss</span>
          <h1 className={cx(styles["title"])}>
            Change this device&apos;s passphrase.
          </h1>
          {(vm.step === "form" || vm.step === "confirm") && (
            <p className={cx(styles["lede"])}>{vm.noDataLossFact}</p>
          )}
        </div>

        {vm.step === "rewrapping" && (
          <BusyIndicator cancellation="unavailable" label={vm.announcement} />
        )}

        {vm.step === "done" && (
          <StatusBanner tone="success" title={vm.announcement} />
        )}

        {(vm.step === "form" || vm.step === "confirm") && (
          <form
            noValidate
            className={cx(styles["form"])}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(current, next, confirmation);
            }}
          >
            {vm.step === "form" && vm.error !== undefined && (
              <StatusBanner tone="danger" title={announceRefusal(vm.error)} />
            )}

            <PassphraseField
              autoComplete="current-password"
              autoFocus
              label={vm.currentScope}
              onChange={setCurrent}
              value={current}
            />
            <PassphraseField
              autoComplete="new-password"
              label={vm.step === "form" ? vm.nextScope : "New passphrase"}
              onChange={(value) => {
                setNext(value);
                onEvaluate(value, confirmation);
              }}
              value={next}
            />
            <PassphraseField
              autoComplete="new-password"
              label="Confirm new passphrase"
              onChange={(value) => {
                setConfirmation(value);
                onEvaluate(next, value);
              }}
              value={confirmation}
            />

            {vm.step === "form" && (
              <PassphraseVerdict match={vm.match} strength={vm.strength} />
            )}

            <div className={cx(styles["actions"])}>
              <Button tone="primary" type="submit">
                Change without data loss
              </Button>
              <InlineLink
                target={{ kind: "internal", href: nav.securitySettings }}
              >
                Cancel
              </InlineLink>
            </div>
          </form>
        )}

        <Dialog
          isDismissable
          isOpen={vm.step === "confirm"}
          onOpenChange={(open) => {
            if (!open) {
              onCancel();
            }
          }}
          title="Change-passphrase confirmation"
          footer={
            <>
              <Button onPress={onCancel}>Cancel</Button>
              <Button tone="primary" onPress={onConfirm}>
                Continue
              </Button>
            </>
          }
        >
          {vm.step === "confirm" && (
            <div className={cx(styles["tight"])}>
              <p className={cx(styles["fact"])}>{vm.noDataLossFact}</p>
              <p className={cx(styles["fact"])}>{vm.localOnlyFact}</p>
              <p className={cx(styles["linkHint"])}>
                Authorized by: {vm.currentScope}.
              </p>
            </div>
          )}
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}
