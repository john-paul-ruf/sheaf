import { useState, type ReactNode } from "react";
import type { RecoveryVm } from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { PassphraseField } from "../primitives/passphrase-field.js";
import { RecoveryCodeField } from "../primitives/recovery-code-field.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { LockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";
import { PassphraseVerdict } from "./verdict.js";

/**
 * SCR-004 — local recovery entry (CAP-05, local-recovery.html).
 *
 * Two facts the copy must keep straight. First, this route is **lossless**:
 * a valid local code opens the store that is already there, and reset is not
 * involved. Second, it is **local**: a vault code recovers a durable home, not
 * this device, and the mock's Drive mention is dropped because Drive is not a
 * durable home at all (FORGE-CONFIG Custom Rule 3).
 *
 * The mock's "Starts with LCL" hint is stale illustration. The shipped code is
 * eight groups of seven Crockford characters with no prefix (AD-10), so this
 * screen promises no prefix and accepts exactly what the parser accepts.
 */

/** local-recovery.html, with Drive removed per Custom Rule 3. */
const VAULT_CODE_FACT =
  "A vault code from Dropbox, OneDrive, or a bundle cannot unlock this local store.";

export interface RecoveryScreenProps {
  readonly vm: RecoveryVm;
  readonly nav: SecurityNavigation;
  readonly onSubmitCode: (recoveryCode: string) => void;
  readonly onSubmitPassphrase: (
    passphrase: string,
    confirmation: string,
  ) => void;
}

export function RecoveryScreen({
  vm,
  nav,
  onSubmitCode,
  onSubmitPassphrase,
}: RecoveryScreenProps): ReactNode {
  return (
    <LockedFrame announcement={vm.announcement} headerAside="This device only">
      <div className={cx(styles["stack"])} data-screen="SCR-004">
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>Lossless recovery</span>
          <h1 className={cx(styles["title"])}>
            Use this device&apos;s local recovery code.
          </h1>
          <p className={cx(styles["lede"])}>{VAULT_CODE_FACT}</p>
        </div>

        {vm.step === "enterCode" && (
          <EnterCode onSubmitCode={onSubmitCode} vm={vm} />
        )}

        {(vm.step === "checkingFormat" ||
          vm.step === "unlocking" ||
          vm.step === "installing") && (
          <BusyIndicator
            cancellation="unavailable"
            label={vm.announcement}
          />
        )}

        {vm.step === "definePassphrase" && (
          <DefineReplacement onSubmitPassphrase={onSubmitPassphrase} vm={vm} />
        )}

        {vm.step === "done" && (
          <p className={cx(styles["fact"])}>{vm.announcement}</p>
        )}

        <InlineLink target={{ kind: "internal", href: nav.unlock }}>
          Cancel
        </InlineLink>
      </div>
    </LockedFrame>
  );
}

function EnterCode({
  vm,
  onSubmitCode,
}: {
  readonly vm: Extract<RecoveryVm, { readonly step: "enterCode" }>;
  readonly onSubmitCode: (recoveryCode: string) => void;
}): ReactNode {
  const [code, setCode] = useState("");

  return (
    <form
      noValidate
      className={cx(styles["form"])}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitCode(code);
      }}
    >
      <StatusBanner tone="info" title="Your data stays in place">
        {vm.losslessFact}
      </StatusBanner>

      {vm.error !== undefined && (
        <StatusBanner tone="danger" title={announceRefusal(vm.error)} />
      )}

      <RecoveryCodeField
        autoFocus
        description={`${vm.codeReach}. Pasting is allowed.`}
        isInvalid={vm.codeMisspelled || vm.error !== undefined}
        label={vm.codeScope}
        onChange={setCode}
        value={code}
        {...(vm.codeMisspelled
          ? {
              errorMessage:
                "That is not a complete local recovery code. Check it and try again.",
            }
          : {})}
      />

      <div className={cx(styles["actions"])}>
        <Button tone="primary" type="submit">
          Recover and unlock
        </Button>
      </div>
    </form>
  );
}

function DefineReplacement({
  vm,
  onSubmitPassphrase,
}: {
  readonly vm: Extract<RecoveryVm, { readonly step: "definePassphrase" }>;
  readonly onSubmitPassphrase: (
    passphrase: string,
    confirmation: string,
  ) => void;
}): ReactNode {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");

  return (
    <form
      noValidate
      className={cx(styles["form"])}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitPassphrase(passphrase, confirmation);
      }}
    >
      <StatusBanner tone="info" title={vm.requirementFact} />

      {vm.error !== undefined && (
        <StatusBanner tone="danger" title={announceRefusal(vm.error)} />
      )}

      <PassphraseField
        autoComplete="new-password"
        autoFocus
        label={vm.passphraseScope}
        onChange={setPassphrase}
        value={passphrase}
      />
      <PassphraseField
        autoComplete="new-password"
        label="Confirm new passphrase"
        onChange={setConfirmation}
        value={confirmation}
      />

      <PassphraseVerdict match={vm.match} strength={vm.strength} />

      <div className={cx(styles["actions"])}>
        <Button tone="primary" type="submit">
          Recover and unlock
        </Button>
      </div>
    </form>
  );
}
