import type { ReactNode } from "react";
import type {
  EmptyLibraryVm,
  LibraryActionReason,
} from "../../application/view-models/library.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import styles from "./empty-library.module.css";

/**
 * SCR-011 — the empty library (library-empty.html, STA-025, decision D5).
 *
 * There is no data here and no pretending there is: STA-025 requires no
 * fictional rows and one truthful next action. In F01 neither next action can
 * complete — import is F02, durable homes are F05/F06 — so both ship
 * **disabled with a stated reason** rather than enabled and dishonest.
 *
 * `Button` refuses a disabled state without a text equivalent (CTL-014's
 * contract), which is why each reason token below has copy: the label is the
 * mock's, and the reason says which release supplies it without promising a
 * date or inventing a capability.
 */

const DISABLED_REASON: Readonly<Record<LibraryActionReason, string>> =
  Object.freeze({
    "import-not-available-in-this-release":
      "Uploading a workbook is not available in this release.",
    "durable-homes-not-available-in-this-release":
      "Connecting a durable home is not available in this release.",
  });

export interface EmptyLibraryScreenProps {
  readonly vm: EmptyLibraryVm;
  readonly nav: SecurityNavigation;
  /** Shell-level actions, e.g. locking this device. */
  readonly topBarActions?: ReactNode;
}

export function EmptyLibraryScreen({
  vm,
  nav,
  topBarActions,
}: EmptyLibraryScreenProps): ReactNode {
  return (
    <UnlockedFrame
      announcement={vm.announcement}
      area="library"
      nav={nav}
      title="Empty library"
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <div className={cx(styles["stack"])} data-screen="SCR-011">
        <div className={cx(styles["intro"])}>
          <span className={cx(styles["eyebrow"])}>Local library</span>
          <h1 className={cx(styles["title"])}>Your apps will live here.</h1>
          <p className={cx(styles["lede"])}>
            Upload the workbook you already use, or connect a durable home to
            adopt an app created on another device.
          </p>
        </div>

        <section className={cx(styles["card"])}>
          <span aria-hidden="true" className={cx(styles["glyph"])}>
            ＋
          </span>
          <h2 className={cx(styles["cardTitle"])}>
            Turn your first workbook into an app.
          </h2>
          <p className={cx(styles["lede"])}>
            The file is parsed on this device. You review every inference before
            the app exists.
          </p>

          <div className={cx(styles["actions"])}>
            {vm.actions.map((action, index) => (
              <Button
                disabledReason={DISABLED_REASON[action.reason]}
                isDisabled
                key={action.id}
                tone={index === 0 ? "primary" : "secondary"}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </UnlockedFrame>
  );
}
