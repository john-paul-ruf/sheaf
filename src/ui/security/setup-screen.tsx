import { useState, type ReactNode } from "react";
import type { SetupVm } from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { EncryptionCallout } from "../primitives/encryption-callout.js";
import { PassphraseField } from "../primitives/passphrase-field.js";
import { RecoveryCodeCard } from "../primitives/recovery-code-card.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { LockedFrame } from "./frames.js";
import styles from "./security.module.css";
import { PassphraseVerdict } from "./verdict.js";

/**
 * SCR-002 — protect this device (CAP-01, setup.html).
 *
 * The screen renders; the machine decides. It never advances a step on its own
 * and never treats a typed acknowledgement as a saved one: "I saved the local
 * recovery code" is a gate the machine holds, so `canFinish` is the only thing
 * that can enable the finish action.
 *
 * The recovery code is issued once and is on screen only while the machine
 * says so (M37's `recoveryCode` is absent from every other step). Nothing here
 * claims a prefix or a shape for it: the code that arrives is rendered as it
 * arrives (AD-10).
 */

/** setup.html's three-step header. */
const STEPS = Object.freeze(["Welcome", "Protect", "Ready"] as const);

/** setup.html, verbatim — the consequence of losing both secrets. */
const CODE_WARNING =
  "If I lose both this passphrase and this code, nobody—including Sheaf—can recover this device.";

/** setup.html, verbatim — what the local code reaches. */
const CODE_REACH = "This device only";

type StepState = "done" | "current" | "todo";

function stepStates(vm: SetupVm): readonly StepState[] {
  const active =
    vm.step === "welcome" ? 0 : vm.step === "unlocked" ? 2 : 1;
  return STEPS.map((_, index) =>
    index < active ? "done" : index === active ? "current" : "todo",
  );
}

export interface SetupScreenProps {
  readonly vm: SetupVm;
  readonly onEvaluate: (passphrase: string, confirmation: string) => void;
  readonly onSubmit: (passphrase: string, confirmation: string) => void;
  /** Records the saved acknowledgement; the machine owns whether it counts. */
  readonly onAcknowledgeSaved: (acknowledged: boolean) => void;
  readonly onFinish: () => void;
  readonly onRetry: () => void;
}

export function SetupScreen({
  vm,
  onEvaluate,
  onSubmit,
  onAcknowledgeSaved,
  onFinish,
  onRetry,
}: SetupScreenProps): ReactNode {
  const states = stepStates(vm);

  return (
    <LockedFrame announcement={vm.announcement} headerAside="Works offline">
      <div className={cx(styles["stack"])} data-screen="SCR-002">
        <ol className={cx(styles["steps"])}>
          {STEPS.map((label, index) => (
            <li
              className={cx(styles["step"])}
              data-state={states[index]}
              key={label}
            >
              <span aria-hidden="true">
                {states[index] === "done" ? "✓" : index + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        {vm.step === "welcome" && <Introduction />}

        {vm.step === "definePassphrase" && (
          <DefinePassphrase
            vm={vm}
            onEvaluate={onEvaluate}
            onSubmit={onSubmit}
          />
        )}

        {vm.step === "deriving" && (
          <BusyIndicator
            label="Protecting this device. This takes a moment."
            cancellation="unavailable"
          />
        )}

        {(vm.step === "codeIssued" || vm.step === "codeConfirm") && (
          <IssuedCode
            vm={vm}
            onAcknowledgeSaved={onAcknowledgeSaved}
            onFinish={onFinish}
          />
        )}

        {vm.step === "failed" && (
          <StatusBanner
            tone="danger"
            title={announceRefusal(vm.error)}
            action={
              vm.error.retryable ? (
                <Button tone="primary" onPress={onRetry}>
                  Try again
                </Button>
              ) : undefined
            }
          />
        )}
      </div>
    </LockedFrame>
  );
}

function Introduction(): ReactNode {
  return (
    <div className={cx(styles["tight"])}>
      <span className={cx(styles["eyebrow"])}>Private by construction</span>
      <h1 className={cx(styles["title"])}>Choose an unlock passphrase</h1>
      <p className={cx(styles["lede"])}>
        Your records stay yours—even on this device. Sheaf encrypts the local
        store before the first workbook arrives. There is no account to create
        and no network needed to unlock it.
      </p>
    </div>
  );
}

function DefinePassphrase({
  vm,
  onEvaluate,
  onSubmit,
}: {
  readonly vm: Extract<SetupVm, { readonly step: "definePassphrase" }>;
  readonly onEvaluate: (passphrase: string, confirmation: string) => void;
  readonly onSubmit: (passphrase: string, confirmation: string) => void;
}): ReactNode {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const change = (next: string, nextConfirmation: string): void => {
    setPassphrase(next);
    setConfirmation(nextConfirmation);
    onEvaluate(next, nextConfirmation);
  };

  return (
    <form
      noValidate
      className={cx(styles["form"])}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(passphrase, confirmation);
      }}
    >
      <div className={cx(styles["tight"])}>
        <span className={cx(styles["eyebrow"])}>This device</span>
        <h1 className={cx(styles["title"])}>Choose an unlock passphrase</h1>
        <p className={cx(styles["lede"])}>
          You will enter it after a cold launch. Unlocking never needs a signal
          or a storage provider.
        </p>
      </div>

      <PassphraseField
        label={vm.passphraseScope}
        value={passphrase}
        onChange={(next) => {
          change(next, confirmation);
        }}
        description={vm.guidance}
        autoComplete="new-password"
        autoFocus
      />
      <PassphraseField
        label={`Confirm ${vm.passphraseScope.toLocaleLowerCase()}`}
        value={confirmation}
        onChange={(next) => {
          change(passphrase, next);
        }}
        autoComplete="new-password"
      />

      <PassphraseVerdict strength={vm.strength} match={vm.match} />

      <EncryptionCallout
        scope="local"
        title="Stored only as the material needed to unlock your encrypted local store."
      />

      <div className={cx(styles["actions"])}>
        <Button tone="primary" type="submit">
          Protect this device
        </Button>
      </div>
    </form>
  );
}

function IssuedCode({
  vm,
  onAcknowledgeSaved,
  onFinish,
}: {
  readonly vm: Extract<
    SetupVm,
    { readonly step: "codeIssued" | "codeConfirm" }
  >;
  readonly onAcknowledgeSaved: (acknowledged: boolean) => void;
  readonly onFinish: () => void;
}): ReactNode {
  const acknowledged = vm.step === "codeConfirm" && vm.acknowledged;
  const canFinish = vm.step === "codeConfirm" && vm.canFinish;

  return (
    <div className={cx(styles["stack"])}>
      <RecoveryCodeCard
        code={vm.recoveryCode}
        scope={{ kind: "local-device" }}
        title="Write this down once"
        description={
          <p className={cx(styles["lede"])}>
            {CODE_REACH}. This code opens this device&apos;s store without data
            loss. It cannot open a durable home on another device.
          </p>
        }
        isConfirmedSaved={acknowledged}
        onConfirmedSavedChange={onAcknowledgeSaved}
        confirmLabel="I saved the local recovery code"
        confirmDetail={CODE_WARNING}
      />

      <StatusBanner
        tone="info"
        title="A durable home gets a different code"
      >
        When you create a Dropbox, OneDrive, or bundle vault, Sheaf issues a
        separately labelled vault recovery code. The two codes recover
        different things.
      </StatusBanner>

      <div className={cx(styles["actions"])}>
        {canFinish ? (
          <Button tone="primary" onPress={onFinish}>
            Finish secure setup
          </Button>
        ) : (
          <Button
            tone="primary"
            isDisabled
            disabledReason="Confirm you saved the local recovery code to finish."
          >
            Finish secure setup
          </Button>
        )}
      </div>
    </div>
  );
}
