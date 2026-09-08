import type { ReactNode } from "react";
import type {
  MissingCapabilityVm,
  WelcomeVm,
} from "../../application/view-models/security.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { ErrorState } from "../primitives/error-state.js";
import { LockedFrame } from "./frames.js";
import styles from "./security.module.css";

/**
 * SCR-001 — welcome, and CAP-08's capability gate.
 *
 * Two variants, one screen. The `unsupported` variant is not a new surface: it
 * is CTL-087's recoverable error state standing where the call to action would
 * be, naming the capability the probe found missing (architecture §Supported
 * Runtime Baseline). Nothing on it can start setup, because setup would fail.
 *
 * Every string in that branch is either the probe's own `reason` or a fact
 * about what the probe found. There is no mock for this state, and inventing
 * one would be the failure mode rather than the fix.
 */

/** welcome.html, verbatim. */
const STEPS: readonly { readonly title: string; readonly detail: string }[] =
  Object.freeze([
    {
      title: "Protect this device",
      detail: "Create an offline unlock and local recovery code",
    },
    { title: "Choose a workbook", detail: "Nothing is sent to Sheaf" },
    {
      title: "Review plain-language findings",
      detail: "Nothing stands until you confirm",
    },
  ]);

export interface WelcomeScreenProps {
  readonly vm: WelcomeVm;
  /** Starts SCR-002. Absent from the `unsupported` variant by construction. */
  readonly onProtect: () => void;
}

export function WelcomeScreen({ vm, onProtect }: WelcomeScreenProps): ReactNode {
  return (
    <LockedFrame
      announcement={vm.announcement}
      headerAside="Works without an account"
    >
      <div className={cx(styles["stack"])} data-screen="SCR-001">
        <div className={cx(styles["tight"])}>
          <span className={cx(styles["eyebrow"])}>
            First run · about one minute
          </span>
          <h1 className={cx(styles["title"])}>Start local. Stay yours.</h1>
          <p className={cx(styles["lede"])}>
            First, protect this device. Then choose a workbook. A cloud sign-in
            is never required to launch or try Sheaf.
          </p>
        </div>

        <p className={cx(styles["fact"])}>
          A field-ready app from the workbook you already trust. Typed forms,
          relationships, live formulas, charts, offline use, and encrypted
          durability—with no Sheaf server.
        </p>

        <ol className={cx(styles["list"])}>
          {STEPS.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong> — {step.detail}
            </li>
          ))}
        </ol>

        {vm.kind === "ready" ? (
          <div className={cx(styles["stack"])}>
            <div className={cx(styles["actions"])}>
              <Button tone="primary" onPress={onProtect}>
                Protect this device
              </Button>
            </div>
            <p className={cx(styles["lede"])}>
              No account · no subscription · no network needed
            </p>
          </div>
        ) : (
          <UnsupportedRuntime missing={vm.missing} />
        )}
      </div>
    </LockedFrame>
  );
}

function UnsupportedRuntime({
  missing,
}: {
  readonly missing: readonly MissingCapabilityVm[];
}): ReactNode {
  return (
    <div className={cx(styles["stack"])} data-variant="unsupported">
      <ErrorState
        variant="recoverable"
        heading="Sheaf cannot protect this device in this browser."
        cause={missing.map((entry) => `${entry.id}: ${entry.reason}`).join(" ")}
      />
      <p className={cx(styles["fact"])}>
        Sheaf needs {missing.map((entry) => entry.id).join(", ")} on this
        device. Opening Sheaf in a browser that provides{" "}
        {missing.length === 1 ? "it" : "them"} is the whole remedy. Nothing was
        written here.
      </p>
    </div>
  );
}
