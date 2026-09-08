import { useState, type ReactNode } from "react";
import type { LockedResetVm } from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { ConfirmationPhraseField } from "../primitives/confirmation-phrase-field.js";
import { ConsequencesList } from "../primitives/consequences-list.js";
import { Dialog } from "../primitives/dialog.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { LockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";

/**
 * SCR-008 — locked reset, with MOD-033 (CAP-07, reset.html).
 *
 * The screen enumerates nothing, and says why. FR-23 and design.md
 * §Destructive actions both require that a locked reset never names, counts,
 * or hints at an encrypted app, and that its inability to do so is stated as
 * the encryption working rather than as a shortcoming. {@link LockedResetVm}
 * has no inventory field to leak, and CTL-100's "encrypted unknowns" section
 * carries the explanation.
 *
 * Three gates, none skippable and none of them this screen's to open: reading
 * the loss, acknowledging it, and typing the exact phrase are all the
 * machine's states, and the destructive command is reachable from the third
 * alone.
 */

const STAGES = Object.freeze([
  "Read loss",
  "Acknowledge",
  "Type phrase",
] as const);

const ACKNOWLEDGEMENT =
  "I understand Sheaf cannot show what this locked reset destroys.";

export interface ResetLockedScreenProps {
  readonly vm: LockedResetVm;
  readonly nav: SecurityNavigation;
  /** The purge is running; nothing on screen can be answered meanwhile. */
  readonly busy: boolean;
  readonly onContinue: () => void;
  readonly onAcknowledge: (acknowledged: boolean) => void;
  readonly onTypePhrase: (text: string) => void;
  readonly onConfirm: () => void;
  readonly onRetry: () => void;
  /** Leaves the destructive path without destroying anything. */
  readonly onCancel: () => void;
}

export function ResetLockedScreen({
  vm,
  nav,
  busy,
  onContinue,
  onAcknowledge,
  onTypePhrase,
  onConfirm,
  onRetry,
  onCancel,
}: ResetLockedScreenProps): ReactNode {
  const [typed, setTyped] = useState("");

  return (
    <LockedFrame announcement={vm.announcement} headerAside="Destructive path">
      <div
        className={cx(styles["stack"])}
        data-screen="SCR-008"
        data-stage={vm.stage}
      >
        <ol className={cx(styles["steps"])}>
          {STAGES.map((label, index) => (
            <li
              className={cx(styles["step"])}
              data-state={
                index + 1 < vm.stage
                  ? "done"
                  : index + 1 === vm.stage
                    ? "current"
                    : "todo"
              }
              key={label}
            >
              <span aria-hidden="true">
                {index + 1 < vm.stage ? "✓" : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>
            Locked · local store unreadable
          </span>
          <h1 className={cx(styles["title"])}>Reset this device?</h1>
          <p className={cx(styles["lede"])}>{vm.cannotEnumerateFact}</p>
        </div>

        {vm.error !== undefined && (
          <StatusBanner
            action={<Button onPress={onRetry}>Try again</Button>}
            title={announceRefusal(vm.error)}
            tone="danger"
          />
        )}

        <StatusBanner tone="warning" title={vm.unknowns.heading}>
          {vm.noPlaintextInventoryFact}
        </StatusBanner>

        <ConsequencesList
          known={vm.known}
          survives={vm.survives}
          unknownWhileLocked={vm.unknowns}
        />

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>
            There may still be a lossless way in
          </h2>
          <p className={cx(styles["lede"])}>{vm.losslessRoute}</p>
          <InlineLink target={{ kind: "internal", href: nav.recover }}>
            Use local recovery code
          </InlineLink>
        </section>

        {busy && (
          <BusyIndicator
            cancellation="unavailable"
            label="Destroying this device's encrypted local store."
          />
        )}

        {!busy && vm.stage === 1 && vm.error === undefined && (
          <div className={cx(styles["actions"])}>
            <Button onPress={onContinue} tone="destructive">
              Continue to 3 confirmations
            </Button>
            <InlineLink target={{ kind: "internal", href: nav.unlock }}>
              Cancel and return to unlock
            </InlineLink>
          </div>
        )}

        {!busy && vm.stage === 2 && (
          <fieldset className={cx(styles["card"])}>
            <legend className={cx(styles["cardTitle"])}>
              Second confirmation
            </legend>
            <label className={cx(styles["checkbox"])}>
              <input
                checked={vm.acknowledged}
                onChange={(event) => {
                  onAcknowledge(event.target.checked);
                }}
                type="checkbox"
              />
              <span>{ACKNOWLEDGEMENT}</span>
            </label>
            <p className={cx(styles["linkHint"])}>
              The final step will require typing {vm.confirmationPhrase}.
            </p>
            <div className={cx(styles["actions"])}>
              {vm.acknowledged ? (
                <Button onPress={onContinue} tone="destructive">
                  Continue to typed confirmation
                </Button>
              ) : (
                <Button
                  disabledReason="Acknowledge what cannot be shown before the typed confirmation."
                  isDisabled
                  tone="destructive"
                >
                  Continue to typed confirmation
                </Button>
              )}
              <InlineLink target={{ kind: "internal", href: nav.unlock }}>
                Cancel and return to unlock
              </InlineLink>
            </div>
          </fieldset>
        )}

        <Dialog
          isDismissable
          isOpen={vm.stage === 3 && !busy}
          kind="destructive"
          onOpenChange={(open) => {
            if (!open) {
              onCancel();
            }
          }}
          title="Locked typed reset"
          footer={
            <>
              <Button onPress={onCancel}>Cancel safely</Button>
              {vm.canConfirm ? (
                <Button onPress={onConfirm} tone="destructive">
                  Confirm consequence
                </Button>
              ) : (
                <Button
                  disabledReason={`Type ${vm.confirmationPhrase} exactly to enable this.`}
                  isDisabled
                  tone="destructive"
                >
                  Confirm consequence
                </Button>
              )}
            </>
          }
        >
          <div className={cx(styles["form"])}>
            <p className={cx(styles["fact"])}>{vm.cannotEnumerateFact}</p>
            <ConfirmationPhraseField
              autoFocus
              onChange={(value) => {
                setTyped(value);
                onTypePhrase(value);
              }}
              phrase={vm.confirmationPhrase}
              value={typed}
            />
          </div>
        </Dialog>
      </div>
    </LockedFrame>
  );
}
