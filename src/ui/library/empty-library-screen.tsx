import type { ReactNode } from "react";
import type {
  EmptyLibraryVm,
  LibraryActionReason,
} from "../../application/view-models/library.js";
import { Button } from "../primitives/button.js";
import { cx } from "../primitives/class-names.js";
import { UnlockedFrame, type SecurityNavigation } from "../security/frames.js";
import { navigateToUpload } from "./library-screen.js";
import styles from "./empty-library.module.css";

/**
 * SCR-011 — the empty library (library-empty.html, STA-025, decision D5).
 *
 * There is no data here and no pretending there is: STA-025 requires no
 * fictional rows and one truthful next action.
 *
 * **D5's successor (F02).** Import landed, so `choose-workbook` is enabled and
 * goes somewhere; durable homes are still F05/F06, so that action keeps its
 * reason token. `LibraryActionVm` is a union — the enabled variant carries a
 * route `intent` and the disabled one carries a `reason`, and neither has the
 * other's field — so this screen narrows on `action.enabled` and the compiler
 * refuses a disabled control with no explanation (CTL-014, `ButtonProps`).
 */

const DISABLED_REASON: Readonly<Record<LibraryActionReason, string>> =
  Object.freeze({
    "durable-homes-not-available-in-this-release":
      "Connecting a durable home is not available in this release.",
  });

export interface EmptyLibraryScreenProps {
  readonly vm: EmptyLibraryVm;
  readonly nav: SecurityNavigation;
  /**
   * Defaults to {@link navigateToUpload} — the upload destination this module
   * states once, so SCR-010, SCR-011 and SCR-012 cannot disagree about it.
   */
  readonly onChooseWorkbook?: () => void;
  /** Shell-level actions, e.g. locking this device. */
  readonly topBarActions?: ReactNode;
}

export function EmptyLibraryScreen({
  vm,
  nav,
  onChooseWorkbook = navigateToUpload,
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
            {vm.actions.map((action, index) =>
              action.enabled ? (
                <Button
                  key={action.id}
                  onPress={onChooseWorkbook}
                  tone={index === 0 ? "primary" : "secondary"}
                >
                  {action.label}
                </Button>
              ) : (
                <Button
                  disabledReason={DISABLED_REASON[action.reason]}
                  isDisabled
                  key={action.id}
                  tone={index === 0 ? "primary" : "secondary"}
                >
                  {action.label}
                </Button>
              ),
            )}
          </div>
        </section>
      </div>
    </UnlockedFrame>
  );
}
