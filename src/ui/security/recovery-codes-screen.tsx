import { useState, type ReactNode } from "react";
import type { RevealCodeVm } from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { Dialog } from "../primitives/dialog.js";
import { PassphraseField } from "../primitives/passphrase-field.js";
import { RecoveryCodeCard } from "../primitives/recovery-code-card.js";
import { SecretScopeLabel } from "../primitives/secret-scope-label.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";

/**
 * SCR-007 — recovery-code centre, with MOD-022 (CAP-06, recovery-codes.html).
 *
 * MOD-022 is a gate, not a courtesy: an unlocked session is not by itself
 * authority to redisplay the local code, so the current passphrase is required
 * every time.
 *
 * **The vault section is empty and says so.** The mock illustrates it with a
 * Dropbox and a OneDrive vault; F01 has no durable homes at all, so showing
 * those rows would be fictional data (STA-025 forbids it) and dropping the
 * section would hide a scope the screen exists to explain. What is rendered is
 * the fact: no durable home is connected to this device yet.
 *
 * The masked placeholder shows the code's *shape* — eight groups of seven —
 * and no prefix, because the shipped format has none (AD-10).
 */

const MASKED_CODE = Array.from({ length: 8 }, () => "•".repeat(7)).join("-");

export interface RecoveryCodesScreenProps {
  readonly vm: RevealCodeVm;
  readonly nav: SecurityNavigation;
  readonly isRevealOpen: boolean;
  readonly onOpenReveal: () => void;
  readonly onCloseReveal: () => void;
  readonly onSubmitPassphrase: (currentPassphrase: string) => void;
  readonly topBarActions?: ReactNode;
}

export function RecoveryCodesScreen({
  vm,
  nav,
  isRevealOpen,
  onOpenReveal,
  onCloseReveal,
  onSubmitPassphrase,
  topBarActions,
}: RecoveryCodesScreenProps): ReactNode {
  // MOD-022's own acknowledgement. It gates dismissal only: nothing durable
  // turns on it, so it belongs to the dialog rather than to a machine.
  const [isSaved, setIsSaved] = useState(false);

  const close = (): void => {
    setIsSaved(false);
    onCloseReveal();
  };

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="security"
      nav={nav}
      title="Recovery codes"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-007">
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>Security · exact scopes</span>
          <h1 className={cx(styles["title"])}>Recovery codes</h1>
          <p className={cx(styles["lede"])}>
            Each code is labelled by what it can recover. Codes remain separate
            even when the passphrases match.
          </p>
        </div>

        <section className={cx(styles["card"])}>
          <div className={cx(styles["settingHeading"])}>
            <h2 className={cx(styles["cardTitle"])}>
              This device&apos;s store
            </h2>
            <SecretScopeLabel scope={{ kind: "local-device" }} />
          </div>
          <p className={cx(styles["lede"])}>
            Issued at initial setup. It opens this device without data loss and
            does nothing on another device.
          </p>
          <p aria-hidden="true" className={cx(styles["codeMask"])}>
            {MASKED_CODE}
          </p>
          <div className={cx(styles["actions"])}>
            <Button onPress={onOpenReveal} tone="primary">
              Reveal with local passphrase
            </Button>
          </div>
        </section>

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>Vault recovery code</h2>
          <p className={cx(styles["lede"])}>
            A vault recovery code is issued when you create a durable home. No
            durable home is connected to this device yet, so there is no vault
            code to show.
          </p>
        </section>

        <Dialog
          isDismissable
          isOpen={isRevealOpen}
          onOpenChange={(open) => {
            if (!open) {
              close();
            }
          }}
          title="Reveal local recovery code"
          footer={<RevealFooter isSaved={isSaved} onClose={close} vm={vm} />}
        >
          <RevealBody
            isSaved={isSaved}
            onSavedChange={setIsSaved}
            onSubmitPassphrase={onSubmitPassphrase}
            vm={vm}
          />
        </Dialog>
      </div>
    </UnlockedFrame>
  );
}

function RevealFooter({
  vm,
  isSaved,
  onClose,
}: {
  readonly vm: RevealCodeVm;
  readonly isSaved: boolean;
  readonly onClose: () => void;
}): ReactNode {
  if (vm.step !== "revealed") {
    return <Button onPress={onClose}>Cancel</Button>;
  }
  return isSaved ? (
    <Button onPress={onClose} tone="primary">
      Close
    </Button>
  ) : (
    <Button
      disabledReason="Confirm you saved this code before closing."
      isDisabled
      tone="primary"
    >
      Close
    </Button>
  );
}

function RevealBody({
  vm,
  isSaved,
  onSavedChange,
  onSubmitPassphrase,
}: {
  readonly vm: RevealCodeVm;
  readonly isSaved: boolean;
  readonly onSavedChange: (isSaved: boolean) => void;
  readonly onSubmitPassphrase: (currentPassphrase: string) => void;
}): ReactNode {
  const [passphrase, setPassphrase] = useState("");

  if (vm.step === "revealing") {
    return (
      <BusyIndicator cancellation="unavailable" label={vm.announcement} />
    );
  }

  if (vm.step === "revealed") {
    return (
      <RecoveryCodeCard
        code={vm.recoveryCode}
        confirmLabel="I saved this code"
        description={
          <p className={cx(styles["lede"])}>
            {vm.codeReach}. It opens this device without data loss.
          </p>
        }
        isConfirmedSaved={isSaved}
        onConfirmedSavedChange={onSavedChange}
        scope={{ kind: "local-device" }}
        title={vm.codeScope}
      />
    );
  }

  if (vm.step === "dismissed") {
    return <p className={cx(styles["fact"])}>{vm.announcement}</p>;
  }

  return (
    <form
      noValidate
      className={cx(styles["form"])}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitPassphrase(passphrase);
      }}
    >
      {vm.error !== undefined && (
        <StatusBanner tone="danger" title={announceRefusal(vm.error)} />
      )}
      <PassphraseField
        autoComplete="current-password"
        autoFocus
        isInvalid={vm.error !== undefined}
        label={vm.passphraseScope}
        onChange={setPassphrase}
        value={passphrase}
      />
      <div className={cx(styles["actions"])}>
        <Button tone="primary" type="submit">
          Reveal
        </Button>
      </div>
    </form>
  );
}
