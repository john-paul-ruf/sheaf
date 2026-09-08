import { useState, type ReactNode } from "react";
import type {
  UnlockRouteVm,
  UnlockVm,
} from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { PassphraseField } from "../primitives/passphrase-field.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { LockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";

/**
 * SCR-003 — cold unlock (CAP-02, unlock.html).
 *
 * Three things this screen must not do, all of them FR-22/CA-05 obligations:
 *
 * 1. **Name anything inside the store.** {@link UnlockVm} has no field that
 *    could; the copy states that instead of implying it.
 * 2. **Offer reset before recovery.** The routes render in the machine's
 *    order, which is the requirement as data — this file never picks one.
 * 3. **Compute a delay.** The countdown shows the worker's number. Nothing
 *    here says the wait outlives the app, because it does not (D4).
 */

const ROUTE_LABEL: Readonly<Record<UnlockRouteVm, string>> = Object.freeze({
  "recovery-code": "Use local recovery code",
  reset: "Review reset consequences →",
});

export interface UnlockScreenProps {
  readonly vm: UnlockVm;
  readonly nav: SecurityNavigation;
  readonly onSubmit: (passphrase: string) => void;
}

export function UnlockScreen({
  vm,
  nav,
  onSubmit,
}: UnlockScreenProps): ReactNode {
  const [passphrase, setPassphrase] = useState("");

  if (vm.state === "deriving" || vm.state === "unlocked") {
    return (
      <LockedFrame
        announcement={vm.announcement}
        headerAside="No network needed"
      >
        <div className={cx(styles["stack"])} data-screen="SCR-003">
          {vm.state === "deriving" ? (
            <BusyIndicator
              label="Unlocking this device. This takes a moment."
              cancellation="unavailable"
            />
          ) : (
            <p className={cx(styles["fact"])}>{vm.announcement}</p>
          )}
        </div>
      </LockedFrame>
    );
  }

  const delayed = vm.state === "delayed";
  const delayMessage = delayed
    ? `Too many failed attempts. Try again in ${String(vm.remainingSeconds)} seconds.`
    : undefined;

  return (
    <LockedFrame announcement={vm.announcement} headerAside="No network needed">
      <form
        className={cx(styles["stack"])}
        data-screen="SCR-003"
        data-state={vm.state}
        onSubmit={(event) => {
          event.preventDefault();
          if (!delayed) {
            onSubmit(passphrase);
          }
        }}
      >
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>
            <span aria-hidden="true">⌁</span> Local store locked
          </span>
          <h1 className={cx(styles["title"])}>Unlock Sheaf</h1>
          {vm.state === "locked" && (
            <p className={cx(styles["lede"])}>{vm.encryptedFact}</p>
          )}
        </div>

        {vm.error !== undefined && (
          <StatusBanner tone="danger" title={announceRefusal(vm.error)} />
        )}

        <PassphraseField
          label={vm.passphraseScope}
          value={passphrase}
          onChange={setPassphrase}
          description="Unlock persists for this session. Idle locking is off unless you enable it."
          isInvalid={vm.error !== undefined}
          autoComplete="current-password"
          autoFocus
          {...(delayMessage === undefined ? {} : { delayedMessage: delayMessage })}
        />

        <div className={cx(styles["actions"])}>
          {delayed ? (
            <Button
              tone="primary"
              isDisabled
              disabledReason={`Unlocking is unavailable for ${String(vm.remainingSeconds)} more seconds.`}
            >
              Unlock offline
            </Button>
          ) : (
            <Button tone="primary" type="submit">
              Unlock offline
            </Button>
          )}
        </div>

        <nav aria-label="If you cannot unlock" className={cx(styles["routes"])}>
          {vm.routes.map((route) => (
            <InlineLink
              key={route}
              target={{
                kind: "internal",
                href:
                  route === "recovery-code" ? nav.recover : nav.resetLocked,
              }}
            >
              {ROUTE_LABEL[route]}
            </InlineLink>
          ))}
        </nav>

        <StatusBanner
          tone="warning"
          title="Sheaf cannot recover a forgotten secret"
        >
          <p>
            Reset is destructive. It wipes this encrypted local store;
            durable-home ciphertext remains where you saved it.
          </p>
          <p>{vm.delayFact}</p>
        </StatusBanner>
      </form>
    </LockedFrame>
  );
}
