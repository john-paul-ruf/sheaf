import { useState, type ReactNode } from "react";
import type { ReadableResetVm } from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { ConfirmationPhraseField } from "../primitives/confirmation-phrase-field.js";
import { ConsequencesList } from "../primitives/consequences-list.js";
import { Dialog } from "../primitives/dialog.js";
import { InlineLink } from "../primitives/inline-link.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";

/**
 * SCR-009 — readable reset, with MOD-032 (CAP-07, reset-unlocked.html).
 *
 * Unlocked, so the facts are nameable — and in F01 the honest name for what
 * would be destroyed is **none**. That is a different claim from the locked
 * variant's "cannot say", and the difference is the whole point: an
 * enumeration that found nothing is a fact, an unreadable store is not.
 * Nothing here is ever labelled "unknown".
 *
 * **Check 7 has a surface half.** The confirmation carries a token bound to
 * the enumeration that produced it. If storage moved underneath it, the worker
 * refuses, nothing is purged, and the only way forward is a fresh
 * enumeration — which reopens all three gates. That refusal is rendered as
 * recoverable, because it is.
 */

const ACKNOWLEDGEMENT =
  "I understand this reset destroys this device's local store.";

export interface ResetReadableScreenProps {
  readonly vm: ReadableResetVm;
  readonly nav: SecurityNavigation;
  /** The purge is running. */
  readonly busy: boolean;
  readonly onContinue: () => void;
  readonly onAcknowledge: (acknowledged: boolean) => void;
  readonly onTypePhrase: (text: string) => void;
  readonly onConfirm: () => void;
  /** Re-enumerates after a stale confirmation, reopening every gate. */
  readonly onRetry: () => void;
  readonly onCancel: () => void;
  readonly topBarActions?: ReactNode;
}

export function ResetReadableScreen({
  vm,
  nav,
  busy,
  onContinue,
  onAcknowledge,
  onTypePhrase,
  onConfirm,
  onRetry,
  onCancel,
  topBarActions,
}: ResetReadableScreenProps): ReactNode {
  const [typed, setTyped] = useState("");
  const loading = vm.inventory === "loading";

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="security"
      nav={nav}
      title="Readable reset"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div
        className={cx(styles["stack"])}
        data-screen="SCR-009"
        data-stage={vm.stage}
      >
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>
            Unlocked · readable inventory
          </span>
          <h1 className={cx(styles["title"])}>
            Reset this device with the facts visible.
          </h1>
          <p className={cx(styles["lede"])}>
            Because the store is unlocked, Sheaf can name every local app, its
            last successful backup, and changes that exist nowhere else.
          </p>
        </div>

        <StatusBanner tone="danger" title="Reset destroys the local store">
          Durable-home ciphertext stays where it is. Re-adoption restores only
          the last confirmed backup.
        </StatusBanner>

        {vm.staleConfirmation && (
          <StatusBanner
            action={<Button onPress={onRetry}>Review the new list</Button>}
            title={
              vm.error === undefined
                ? "This device changed after the list was made. Nothing was destroyed."
                : announceRefusal(vm.error)
            }
            tone="warning"
          />
        )}

        {!vm.staleConfirmation && vm.error !== undefined && (
          <StatusBanner
            action={<Button onPress={onRetry}>Try again</Button>}
            title={announceRefusal(vm.error)}
            tone="danger"
          />
        )}

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>What would be destroyed</h2>

          {loading && (
            <BusyIndicator
              cancellation="unavailable"
              label="Listing what this reset would destroy."
            />
          )}

          {!loading && (
            <>
              <p className={cx(styles["settingHeading"])}>
                {vm.appCount} local apps · {vm.homeCount} durable homes
              </p>
              {vm.inventory === "none" ? (
                <p className={cx(styles["fact"])}>
                  No apps are on this device, so none would be destroyed.
                </p>
              ) : (
                <ul className={cx(styles["list"])}>
                  {vm.inventory.map((row) => (
                    <li key={row.appId}>
                      {row.displayName} — {row.deviceOnlyChangeCount} changes
                      only on this device
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <ConsequencesList survives={vm.survives} />

        {busy && (
          <BusyIndicator
            cancellation="unavailable"
            label="Destroying this device's encrypted local store."
          />
        )}

        {!busy && !loading && vm.stage === 1 && vm.error === undefined && (
          <div className={cx(styles["actions"])}>
            <Button onPress={onContinue} tone="destructive">
              Continue to 3 confirmations
            </Button>
            <InlineLink
              target={{ kind: "internal", href: nav.securitySettings }}
            >
              Cancel
            </InlineLink>
          </div>
        )}

        <Dialog
          isDismissable
          isOpen={!busy && vm.stage > 1}
          kind="destructive"
          onOpenChange={(open) => {
            if (!open) {
              onCancel();
            }
          }}
          title="Readable reset inventory"
          footer={
            <Footer
              onCancel={onCancel}
              onConfirm={onConfirm}
              onContinue={onContinue}
              vm={vm}
            />
          }
        >
          {vm.stage === 2 ? (
            <div className={cx(styles["form"])}>
              <p className={cx(styles["fact"])}>
                {vm.inventory === "none"
                  ? "No apps are on this device, so none would be destroyed."
                  : `${String(vm.appCount)} local apps would be destroyed.`}
              </p>
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
            </div>
          ) : (
            <div className={cx(styles["form"])}>
              <p className={cx(styles["fact"])}>
                This destroys this device&apos;s encrypted local store.
                Durable-home ciphertext stays where it is.
              </p>
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
          )}
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}

function Footer({
  vm,
  onConfirm,
  onContinue,
  onCancel,
}: {
  readonly vm: ReadableResetVm;
  readonly onConfirm: () => void;
  readonly onContinue: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  if (vm.stage === 2) {
    return (
      <>
        <Button onPress={onCancel}>Cancel safely</Button>
        {vm.acknowledged ? (
          <Button onPress={onContinue} tone="destructive">
            Continue to typed confirmation
          </Button>
        ) : (
          <Button
            disabledReason="Acknowledge what this reset destroys before the typed confirmation."
            isDisabled
            tone="destructive"
          >
            Continue to typed confirmation
          </Button>
        )}
      </>
    );
  }

  return (
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
  );
}
