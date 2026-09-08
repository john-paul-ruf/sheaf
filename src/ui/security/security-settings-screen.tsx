import type { ReactNode } from "react";
import type {
  IdleTimeoutOptionVm,
  SecuritySettingsVm,
} from "../../application/view-models/security.js";
import { announceRefusal } from "../../application/view-models/security.js";
import { BusyIndicator } from "../primitives/busy-indicator.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { InlineLink } from "../primitives/inline-link.js";
import { SelectField } from "../primitives/select-field.js";
import { StatusBanner } from "../primitives/status-banner.js";
import { UnlockedFrame, type SecurityNavigation } from "./frames.js";
import styles from "./security.module.css";

/**
 * SCR-005 — security settings (CAP-03, security-settings.html, D13/AD-7).
 *
 * The idle timeout here is a **real durable setting**, not a decoration. What
 * the select shows is `vm.idleTimeoutMinutes` — the value the worker confirmed
 * it stored — and nothing else: the requested value is deliberately absent
 * from the view model, so a write that was refused cannot leave a setting
 * looking applied. FR-22 asks for a configurable timeout, and a control that
 * changed nothing durable would be an untruthful surface.
 *
 * A `revision-conflict` is another writer, not a fault, so it is offered as
 * something to try again rather than as a failure (CA-03/CA-04).
 */

function optionKey(option: IdleTimeoutOptionVm): string {
  return String(option.minutes);
}

export interface SecuritySettingsScreenProps {
  readonly vm: SecuritySettingsVm;
  readonly nav: SecurityNavigation;
  /** Only ever called with a value the view model already offered. */
  readonly onSetIdleTimeout: (option: IdleTimeoutOptionVm) => void;
  readonly onLockNow: () => void;
  readonly onDismissError: () => void;
  readonly topBarActions?: ReactNode;
}

export function SecuritySettingsScreen({
  vm,
  nav,
  onSetIdleTimeout,
  onLockNow,
  onDismissError,
  topBarActions,
}: SecuritySettingsScreenProps): ReactNode {
  const selected = vm.options.find(
    (option) => option.minutes === vm.idleTimeoutMinutes,
  );

  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="security"
      nav={nav}
      title="Security"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-005">
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>This device</span>
          <h1 className={cx(styles["title"])}>Security &amp; local unlock</h1>
          <p className={cx(styles["lede"])}>
            Control when this device locks and revisit the recovery material
            that belongs to it.
          </p>
        </div>

        <section className={cx(styles["card"])}>
          <h2 className={cx(styles["cardTitle"])}>Unlock behavior</h2>

          <div className={cx(styles["settingRow"])}>
            <span className={cx(styles["settingHeading"])}>Lock now</span>
            <p className={cx(styles["linkHint"])}>{vm.lockNowFact}</p>
            <div className={cx(styles["actions"])}>
              <Button onPress={onLockNow}>Lock</Button>
            </div>
          </div>

          <div className={cx(styles["settingRow"])}>
            {vm.persistError !== undefined && (
              <StatusBanner
                action={
                  <Button onPress={onDismissError}>Dismiss</Button>
                }
                title={announceRefusal(vm.persistError)}
                tone={vm.persistError.retryable ? "warning" : "danger"}
              />
            )}

            <SelectField
              description={vm.defaultFact}
              isDisabled={vm.saving}
              label="Idle timeout"
              onChange={(value) => {
                const option = vm.options.find(
                  (candidate) => optionKey(candidate) === value,
                );
                if (option !== undefined) {
                  onSetIdleTimeout(option);
                }
              }}
              options={vm.options.map((option) => ({
                value: optionKey(option),
                label: option.label,
              }))}
              value={selected === undefined ? null : optionKey(selected)}
            />

            {vm.saving && (
              <BusyIndicator
                cancellation="unavailable"
                label="Saving the idle timeout."
              />
            )}
          </div>
        </section>

        <section className={cx(styles["card"])}>
          <div className={cx(styles["linkRow"])}>
            <InlineLink
              target={{ kind: "internal", href: nav.passphraseChange }}
            >
              Change passphrase
            </InlineLink>
            <p className={cx(styles["linkHint"])}>
              Re-wrap keys without losing data.
            </p>
          </div>

          <div className={cx(styles["linkRow"])}>
            <InlineLink target={{ kind: "internal", href: nav.recoveryCodes }}>
              Recovery codes
            </InlineLink>
            <p className={cx(styles["linkHint"])}>
              One local code and one per durable home.
            </p>
          </div>

          <div className={cx(styles["linkRow"])}>
            <InlineLink target={{ kind: "internal", href: nav.resetReadable }}>
              Reset this device
            </InlineLink>
            <p className={cx(styles["linkHint"])}>
              Readable inventory and remedies while unlocked.{" "}
              <span className={cx(styles["tag"])}>Destructive</span>
            </p>
          </div>
        </section>
      </div>
    </UnlockedFrame>
  );
}
